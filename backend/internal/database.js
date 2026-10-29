import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { connectionFileOf, publicConnection, sealWith } from "../lib/database/connection-file.js";
import { BATCH_SIZE, copyTable, countRows, resetSequences, VERIFY_ROWS, verifyTable } from "../lib/database/copy.js";
import { databaseSize, engineOf, listTables, serverVersion } from "../lib/database/engine.js";
import { knexConfigOf } from "../lib/database/knex-config.js";
import { MOVE_PAUSE_MS, pauseWriters, resumeWriters } from "../lib/database/pause.js";
import {
	compareSchemas,
	dataTables,
	foreignKeys,
	keyColumns,
	MIGRATIONS,
	runMigrations,
	tableOrder,
} from "../lib/database/schema.js";
import { scrub, testTarget, validateTarget } from "../lib/database/target.js";
import { columnKinds } from "../lib/database/values.js";
import errs from "../lib/error.js";

// The Database settings section and the move between databases (spec 2026-10-29-database-move-design). Everything
// outside is injected (createDatabaseService); internal/database-service.js wires the instance.
//
// A move: refused while the connection comes from env, a move runs or a backup or restore holds the lock; the target is
// checked again (it must be empty) before anything changes. Then maintenance on, the running writes finish, the
// background writers pause, a safety backup, the migrations on the target, the copy (parents first), the id counters,
// the verification, and the switch: the held logouts and the "moved" audit entry go into the new database, then
// database.json is written and the process exits for dinit to start it on the new database. Until database.json is
// written the database in use stays in use: any failure ends maintenance, writes the held logouts and a "move-failed"
// audit entry into it, resumes the writers and frees the lock; the target is left as it is to be looked at.

const REVOCATION_CHUNK = 200;

const pad = (value) => String(value).padStart(2, "0");
const stamp = (date) =>
	`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

const labelOf = (connection) =>
	connection.engine === "sqlite"
		? `sqlite ${connection.file}`
		: `${connection.engine} ${connection.host}:${connection.port}/${connection.name}`;

const movedFromOf = (connection) =>
	connection.engine === "sqlite"
		? { engine: "sqlite", name: connection.file }
		: { engine: connection.engine, host: connection.host, name: connection.name };

const envLocked = () =>
	new errs.DatabaseMoveError("env-locked", "The connection comes from the DB_* environment variables", {
		status: 409,
	});
const moveRunning = () => new errs.DatabaseMoveError("move-running", "A database move is running", { status: 409 });
const fileExists = (file) =>
	new errs.DatabaseMoveError("not-empty", "The new database file exists already, try again", {
		status: 409,
		details: file,
	});

const view = (move) => ({
	...move,
	tables: move.tables.map((table) => ({ ...table })),
	error: move.error ? { ...move.error } : null,
});

// resolves after ms at the latest (a promise that never settles is not waited for beyond that)
const within = (promise, ms) => {
	let timer;
	const limit = new Promise((resolve) => {
		timer = setTimeout(resolve, ms);
	});
	return Promise.race([Promise.resolve(promise).catch(() => {}), limit]).finally(() => clearTimeout(timer));
};

// "now" as the audit model writes it (models/now_helper.js): SQLite local time text, the server's NOW() elsewhere
const nowOf = (knex) => {
	switch (engineOf(knex)) {
		case "sqlite":
			return knex.raw("datetime('now','localtime')");
		default:
			return knex.raw("NOW()");
	}
};

/**
 * @param   {Object}    deps
 * @param   {Object}    deps.knex                 the database in use
 * @param   {Function}  deps.current              () => { source, connection, moved_at, moved_from } (lib/config.js)
 * @param   {Function}  deps.createKnex           (config) => knex
 * @param   {Object}    deps.box                  the secret box (seals the password in database.json)
 * @param   {string}    deps.dataDir              /data/npmpro: database.json and new SQLite files
 * @param   {Object}    [deps.migrations]         { tableName, directory }
 * @param   {Object}    deps.backup               { lockForMove(userId) => { safetyBackup(), release() } }, throws busy
 * @param   {Function}  deps.writers              () => [{ name, pause({ timeoutMs }), resume() }]: background writers
 * @param   {Object}    deps.maintenance          createMaintenance()
 * @param   {Object}    deps.revocations          { held() => rows (kept), write(knex) => Promise (takes them),
 *                                                close(): no logout is taken any more (right before the exit) }
 * @param   {Function}  deps.audit                (access, data) => Promise, into the database in use
 * @param   {Function}  deps.writeFile            (file, content) => Promise (writeConnectionFile)
 * @param   {Function}  deps.exit                 () => void, ends the process (dinit starts it again)
 * @param   {Function}  [deps.later]              (fn, ms) => void
 * @param   {Object}    [deps.clock]              { now() } in ms
 * @param   {Object}    [deps.log]
 * @param   {number}    [deps.batchSize]
 * @param   {number}    [deps.verifyRows]
 * @param   {number}    [deps.restartDelayMs]     the time the move window has to see "restarting"
 * @param   {number}    [deps.sentTimeoutMs]      the longest wait for the answer to the move request
 * @param   {number}    [deps.timeoutMs]          the target test timeout
 * @param   {number}    [deps.writesTimeoutMs]    the longest wait for the writes that started before the move
 * @param   {number}    [deps.pauseTimeoutMs]     the longest wait for one background writer
 * @param   {number}    [deps.closeTimeoutMs]     the longest wait for the target connection to close after a failure
 */
const createDatabaseService = ({
	knex,
	current,
	createKnex,
	box,
	dataDir,
	migrations = MIGRATIONS,
	backup,
	writers,
	maintenance,
	revocations,
	audit,
	writeFile,
	exit,
	later = (fn, ms) => setTimeout(fn, ms),
	clock = Date,
	log = console,
	batchSize = BATCH_SIZE,
	verifyRows = VERIFY_ROWS,
	restartDelayMs = 2000,
	sentTimeoutMs = 30_000,
	timeoutMs = 10_000,
	writesTimeoutMs = MOVE_PAUSE_MS,
	pauseTimeoutMs = MOVE_PAUSE_MS,
	closeTimeoutMs = 10_000,
}) => {
	let lastMove = null;
	let running = Promise.resolve();
	// a move is between its first check and maintenance.start (a target test must not run then)
	let starting = false;
	// target tests that are running: a move waits for them, so a probe table of theirs cannot block it
	const tests = new Set();

	// a log line that can never throw (after database.json is written nothing may reach the failure path)
	const note = (level, line) => {
		try {
			log[level](line);
		} catch {
			// nothing to do
		}
	};

	const insertRevocations = async (target, rows) => {
		for (let i = 0; i < rows.length; i += REVOCATION_CHUNK) {
			await target("session_revocation")
				.insert(rows.slice(i, i + REVOCATION_CHUNK))
				.onConflict("sid")
				.ignore();
		}
	};

	// a new SQLite file, never one that exists, readable by NPMpro only before any data is in it
	const createSqliteFile = async (file) => {
		let handle;
		try {
			handle = await open(file, "wx", 0o600);
		} catch (error) {
			if (error?.code === "EEXIST") throw fileExists(file);
			throw error;
		}
		await handle.close();
	};

	const errorOf = (error, { step, target, leftNote }) => {
		const password = target.password;
		const known = typeof error?.code === "string" && typeof error?.message_i18n === "string";
		// a known error has its driver message in details; an unknown one only its message
		let cause = scrub(error, password);
		if (known) cause = typeof error.details === "string" ? scrub(error.details, password) : null;
		const details = [cause, leftNote].filter(Boolean);
		return {
			step,
			code: known ? error.code : "failed",
			message: known ? scrub(error, password) : "The database move failed",
			message_i18n: known ? error.message_i18n : "database.error.failed",
			details: details.length > 0 ? details.join(". ") : null,
		};
	};

	const leftNoteOf = (target, { created, touched }) => {
		if (target.engine === "sqlite") {
			return created ? `The new database file ${target.file} was left as it is and can be deleted` : null;
		}
		return touched
			? `The target database ${target.name} on ${target.host} was left as it is, empty it before the next move`
			: null;
	};

	// everything back as it was before the move, the database in use stays in use
	const fail = async (error, { move, target, access, lock, paused, targetKnex, created, touched }) => {
		const failure = errorOf(error, {
			step: move.step,
			target,
			leftNote: leftNoteOf(target, { created, touched }),
		});
		note(
			"error",
			`The database move to ${labelOf(target)} failed at the ${failure.step} step: ${failure.message}${failure.details ? ` (${failure.details})` : ""}`,
		);
		if (targetKnex) await within(targetKnex.destroy(), closeTimeoutMs);
		// later logouts go straight to the database in use again
		maintenance.end();
		try {
			await revocations.write(knex);
		} catch (revokeError) {
			// they stay held in memory (still revoked) until a later write
			note(
				"error",
				`Logouts during the database move could not be saved, they stay revoked in memory and are written with the next logout: ${revokeError?.message}`,
			);
		}
		try {
			await audit(access, {
				action: "move-failed",
				object_type: "database",
				object_id: 0,
				meta: {
					name: labelOf(target),
					step: failure.step,
					error: failure.message,
					...(failure.details ? { details: failure.details } : {}),
				},
			});
		} catch (auditError) {
			note("error", `The failed database move could not be logged: ${auditError?.message}`);
		}
		await resumeWriters(paused, { log });
		lock.release();
		move.error = failure;
		move.finished_at = new Date(clock.now()).toISOString();
		move.state = "failed";
	};

	// database.json is written: the new database is the one that stays; the process ends after the move window saw it
	const restart = async ({ targetKnex, sent }) => {
		try {
			await within(sent, sentTimeoutMs);
			await new Promise((resolve) => {
				later(resolve, restartDelayMs);
			});
			try {
				// logouts held since the copy, the last await before the exit
				await revocations.write(targetKnex);
			} catch (error) {
				// they stay held in this process only and are lost with it: say how many
				let count = "some";
				try {
					count = String(revocations.held().length);
				} catch {
					// the count stays unknown
				}
				note(
					"error",
					`${count} logouts during the database move could not be saved in the new database and are lost with the restart, those sessions stay valid: ${error?.message}`,
				);
			}
		} finally {
			// right after the last write (no await between): from here on a logout is refused (the client retries
			// after the restart), so none is taken and lost
			try {
				revocations.close();
			} catch (error) {
				note("error", `Logouts could not be closed before the restart: ${error?.message}`);
			}
			// this process does not use the new database any more
			await within(
				Promise.resolve().then(() => targetKnex.destroy()),
				closeTimeoutMs,
			);
			exit();
		}
	};

	const run = async ({ move, target, source, access, userId, lock, sent }) => {
		const state = { paused: [], targetKnex: null, created: false, touched: false };
		try {
			await maintenance.idle({ timeoutMs: writesTimeoutMs });
			state.paused = await pauseWriters(writers(), { timeoutMs: pauseTimeoutMs, log });

			move.step = "backup";
			move.backup = await lock.safetyBackup();

			move.step = "schema";
			if (target.engine === "sqlite") {
				await createSqliteFile(target.file);
				state.created = true;
			}
			state.targetKnex = createKnex(knexConfigOf(target));
			const targetKnex = state.targetKnex;
			// the test before the move found it empty; the migrations may only run on an empty database
			const existing = await listTables(targetKnex, { views: true });
			if (existing.length > 0) {
				throw new errs.DatabaseMoveError("not-empty", "The target database is not empty", {
					details: existing.slice(0, 20).join(", "),
				});
			}
			state.touched = true;
			await runMigrations(targetKnex, migrations);
			const { tables, info } = await compareSchemas(knex, targetKnex);
			const plan = [];
			for (const table of tableOrder(tables, await foreignKeys(knex))) {
				plan.push({
					table,
					key: await keyColumns(knex, table),
					kinds: columnKinds(info[table].source, info[table].target, table),
				});
			}

			move.step = "copy";
			const counts = [];
			for (const { table } of plan) counts.push({ name: table, rows: await countRows(knex, table), copied: 0 });
			move.tables = counts;
			for (const [index, { table, key, kinds }] of plan.entries()) {
				const entry = move.tables[index];
				await copyTable({
					source: knex,
					target: targetKnex,
					table,
					key,
					kinds,
					batchSize,
					onRows: (copied) => {
						entry.copied = copied;
					},
				});
			}
			await resetSequences(
				knex,
				targetKnex,
				plan.map(({ table }) => table),
			);

			move.step = "verify";
			for (const { table, key, kinds } of plan) {
				await verifyTable({ source: knex, target: targetKnex, table, key, kinds, rows: verifyRows });
			}

			move.step = "switch";
			// a copy: they stay held (and revoked) until the exit writes them for good, or the old database gets them
			await insertRevocations(targetKnex, revocations.held());
			// without an id: the next id after the copy proves the id counter moved on
			await targetKnex("audit_log").insert({
				created_on: nowOf(targetKnex),
				modified_on: nowOf(targetKnex),
				user_id: userId,
				object_type: "database",
				object_id: 0,
				action: "moved",
				meta: JSON.stringify({
					name: labelOf(target),
					from: labelOf(source),
					tables: move.tables.length,
					rows: move.tables.reduce((sum, table) => sum + table.rows, 0),
					automatic_backup: move.backup,
				}),
			});
			state.movedAt = new Date(clock.now()).toISOString();
			// the last statement of the try: once database.json is written nothing can undo the move
			await writeFile(
				path.join(dataDir, "database.json"),
				connectionFileOf(target, {
					seal: sealWith(box),
					movedAt: state.movedAt,
					movedFrom: movedFromOf(source),
				}),
			);
		} catch (error) {
			await fail(error, { move, target, access, lock, ...state });
			return;
		}
		move.state = "restarting";
		move.finished_at = state.movedAt;
		note("info", `Database moved to ${labelOf(target)}, restarting on it`);
		// maintenance and the backup lock stay until the process ends, the writers stay paused
		await restart({ targetKnex: state.targetKnex, sent });
	};

	// the checks and the start of a move (one at a time: starting is set)
	const begin = async ({ access, body, sent, userId, info }) => {
		// a target test that runs now finishes first: its probe table is gone (or named by the check) before ours
		await Promise.all([...tests]);
		const now = new Date(clock.now());
		const valid = validateTarget(body);
		const target =
			valid.engine === "sqlite"
				? { engine: "sqlite", file: path.join(dataDir, `database-${stamp(now)}.sqlite`) }
				: valid;
		if (target.engine === "sqlite" && existsSync(target.file)) throw fileExists(target.file);
		await testTarget({ target: valid, current: info.connection, createKnex, timeoutMs });
		if (maintenance.active()) throw moveRunning();
		// throws busy while a backup or restore runs; a scheduled backup that comes later waits for the lock
		const lock = backup.lockForMove(userId);
		const id = randomBytes(8).toString("hex");
		try {
			maintenance.start(id);
		} catch (error) {
			lock.release();
			throw error;
		}
		lastMove = {
			id,
			state: "running",
			step: "maintenance",
			started_at: now.toISOString(),
			finished_at: null,
			target: publicConnection(target),
			tables: [],
			backup: null,
			error: null,
		};
		running = run({ move: lastMove, target, source: info.connection, access, userId, lock, sent }).catch(
			(error) => {
				note("error", `The database move stopped unexpectedly: ${scrub(error, target.password)}`);
			},
		);
		return { id };
	};

	return {
		status: async (access) => {
			access.canAdmin();
			const info = current();
			const tables = [];
			for (const name of await dataTables(knex)) tables.push({ name, rows: await countRows(knex, name) });
			return {
				...publicConnection(info.connection),
				version: await serverVersion(knex),
				source: info.source,
				size: await databaseSize(knex, { file: info.connection.file }),
				moved_at: info.moved_at,
				moved_from: info.moved_from,
				tables,
				move: lastMove ? view(lastMove) : null,
			};
		},

		test: async (access, body) => {
			access.canAdmin();
			const info = current();
			if (info.source === "env") throw envLocked();
			// the move tests its target itself; a test during the move would put a probe table on it
			if (starting || maintenance.active()) throw moveRunning();
			const tested = testTarget({
				target: validateTarget(body),
				current: info.connection,
				createKnex,
				timeoutMs,
			});
			const done = tested.then(
				() => {},
				() => {},
			);
			tests.add(done);
			try {
				return await tested;
			} finally {
				tests.delete(done);
			}
		},

		/**
		 * Starts a move; answers once the target passed its test and the backup lock is held, the steps run in the
		 * background (progress()).
		 *
		 * @param   {Access}   access
		 * @param   {Object}   body
		 * @param   {Object}   [options]
		 * @param   {Promise}  [options.sent]  settles once the answer to the move request went out (finish or close of
		 *                                     the response): the process does not exit before it
		 * @returns {Promise<{ id: string }>}
		 */
		move: async (access, body, { sent = Promise.resolve() } = {}) => {
			access.canAdmin();
			const userId = access.token.getUserId(0);
			const info = current();
			if (info.source === "env") throw envLocked();
			if (starting || maintenance.active()) throw moveRunning();
			starting = true;
			try {
				return await begin({ access, body, sent, userId, info });
			} finally {
				starting = false;
			}
		},

		progress: (access) => {
			access.canAdmin();
			return { move: lastMove ? view(lastMove) : null };
		},

		settled: () => running,
	};
};

export { createDatabaseService };
