import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile as writeRaw } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import knexFactory from "knex";
import { createDatabaseService } from "../internal/database.js";
import { parseConnectionFile, writeConnectionFile } from "../lib/database/connection-file.js";
import { countRows } from "../lib/database/copy.js";
import { knexConfigOf } from "../lib/database/knex-config.js";
import { createMaintenance } from "../lib/database/maintenance.js";
import { MIGRATIONS } from "../lib/database/schema.js";
import { migratedSqlite, pgConnection, pgSkip, resetPg, seedSource, tempSqlite } from "./support/database.js";

const access = { canAdmin: () => {}, token: { getUserId: () => 1 } };
const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (text) => JSON.parse(text.slice(3)) };
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const SQLITE_NAME = /^database-\d{8}-\d{6}\.sqlite$/u;
const MOVE_ID = /^[0-9a-f]{16}$/u;
const LEFT_FILE = /The new database file .*database-\d{8}-\d{6}\.sqlite was left as it is/u;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;
const SQLITE_VERSION = /^3\./u;
const SEALED = /^v1:/u;
const LOST_LOGOUTS = /^2 logouts during the database move could not be saved in the new database/u;
const CLOSE_FAILED = /^Logouts could not be closed before the restart: cannot close$/u;
const LEFT_TARGET = /The target database npmpro_test_unit on .* was left as it is/u;

// no password key and no text holding the password; the test password may be part of the user or database name, so
// those are taken out first
const hideNames = (text) => text.split(pgConnection.name).join("").split(pgConnection.user).join("");
const leaksPassword = (value) => {
	const text = JSON.stringify(value);
	return text.includes('"password"') || hideNames(text).includes(pgConnection.password);
};

// the source knex with injected failures: select (the copy) or the second count of a table (the verification)
const failing = (knex, { select, count } = {}) => {
	let counts = 0;
	return new Proxy(knex, {
		apply: (target, thisArg, [table]) => {
			const query = Reflect.apply(target, thisArg, [table]);
			if (table === select) {
				query.select = () => {
					throw new Error(`cannot read ${table}`);
				};
			}
			if (table === count) {
				const original = query.count.bind(query);
				query.count = (...args) => {
					counts += 1;
					const result = original(...args);
					return counts >= 2 ? result.then(([row]) => [{ count: Number(row.count) + 1 }]) : result;
				};
			}
			return query;
		},
	});
};

const make = async ({
	source,
	sourceKnex,
	env = false,
	busy = false,
	failPause = false,
	failBackup = false,
	migrations,
	writeFile,
	later,
	log = silent,
	maintenance = createMaintenance(),
	writeRevocations,
	close,
} = {}) => {
	const target = await tempSqlite("unused");
	const calls = [];
	// the logouts held during the move (lib/session.js): held() keeps them, write() takes them
	const held = [{ sid: "logged-out", expires_at: 1_900_000_000 }];
	let released = 0;
	let locked = 0;
	const writers = ["renewals", "scheduler"].map((name) => ({
		name,
		pause: ({ timeoutMs }) => {
			if (!(timeoutMs > 0)) return Promise.reject(new Error("every pause gets a time limit"));
			if (failPause && name === "scheduler") return Promise.reject(new Error("cannot pause"));
			calls.push(`pause ${name}`);
			return Promise.resolve();
		},
		resume: async () => calls.push(`resume ${name}`),
	}));
	const service = createDatabaseService({
		knex: sourceKnex ?? source.knex,
		current: () => ({
			source: env ? "env" : "default",
			connection: { engine: "sqlite", file: source.file },
			moved_at: null,
			moved_from: null,
		}),
		createKnex: knexFactory,
		box,
		dataDir: target.dir,
		migrations: migrations ?? MIGRATIONS,
		backup: {
			lockForMove: () => {
				if (busy)
					throw Object.assign(new Error("A backup or restore is running"), { code: "busy", status: 409 });
				locked += 1;
				return {
					safetyBackup: () => {
						if (failBackup) return Promise.reject(new Error("disk full"));
						calls.push("safety backup");
						return Promise.resolve("npmpro-backup-npmpro-20261029-100000-auto.npmpro");
					},
					release: () => {
						released += 1;
					},
				};
			},
		},
		writers: () => writers,
		maintenance,
		revocations: {
			held: () => held.map((row) => ({ ...row })),
			write: async (knex) => {
				if (writeRevocations) return await writeRevocations(knex, held);
				const rows = held.splice(0);
				for (const row of rows) await knex("session_revocation").insert(row).onConflict("sid").ignore();
				return rows.length;
			},
			close: () => {
				calls.push("close sessions");
				close?.();
			},
		},
		audit: (_access, data) => {
			calls.push(`audit ${data.action} ${data.meta.step ?? ""}`.trim());
			calls.audit = data;
			return Promise.resolve();
		},
		writeFile: writeFile ?? writeConnectionFile,
		exit: () => calls.push("exit"),
		later:
			later ??
			((fn, ms) => {
				calls.push(`exit in ${ms}`);
				fn();
			}),
		log,
		batchSize: 4,
	});
	return { service, target, calls, held, maintenance, released: () => released, locked: () => locked };
};

it("moves SQLite to a new SQLite file, writes the file last and exits", async () => {
	const source = await migratedSqlite();
	const ctx = await make({ source });
	try {
		const { counts } = await seedSource(source.knex);
		const before = await countRows(source.knex, "audit_log");
		const { id } = await ctx.service.move(access, { engine: "sqlite" });
		assert.match(id, MOVE_ID);
		assert.equal(ctx.maintenance.active(), true);
		await ctx.service.settled();
		const { move } = ctx.service.progress(access);
		assert.equal(move.state, "restarting", JSON.stringify(move.error));
		assert.equal(move.step, "switch");
		assert.equal(move.backup, "npmpro-backup-npmpro-20261029-100000-auto.npmpro");
		assert.ok(move.tables.length > 0);
		assert.ok(move.tables.every((table) => table.copied === table.rows));
		assert.deepEqual(ctx.calls, [
			"pause renewals",
			"pause scheduler",
			"safety backup",
			"exit in 2000",
			"close sessions",
			"exit",
		]);
		// maintenance stays on and the lock stays held until the process exits
		assert.equal(ctx.maintenance.active(), true);
		assert.equal(ctx.released(), 0);
		const file = path.join(ctx.target.dir, "database.json");
		const saved = parseConnectionFile(await readFile(file, "utf8"), { unseal: () => "", dataDir: ctx.target.dir });
		assert.equal(saved.engine, "sqlite");
		assert.match(path.basename(saved.file), SQLITE_NAME);
		assert.equal(move.target.file, saved.file);
		assert.deepEqual(saved.moved_from, { engine: "sqlite", name: source.file });
		const copy = knexFactory(knexConfigOf({ engine: "sqlite", file: saved.file }));
		try {
			for (const [table, count] of Object.entries(counts))
				assert.equal(await countRows(copy, table), count, table);
			// the audit entry is the first insert without an id after the copy: the id counter moved on
			const moved = await copy("audit_log").where("action", "moved").first();
			assert.equal(moved.id, before + 1);
			assert.equal(moved.object_type, "database");
			assert.equal(moved.user_id, 1);
			assert.match(String(moved.created_on), LOCAL_TIME);
			const meta = JSON.parse(moved.meta);
			assert.equal(meta.name, `sqlite ${saved.file}`);
			assert.equal(meta.from, `sqlite ${source.file}`);
			assert.equal(meta.automatic_backup, move.backup);
			assert.ok(await copy("session_revocation").where("sid", "logged-out").first());
		} finally {
			await copy.destroy();
		}
		// the database in use is unchanged
		assert.equal(await countRows(source.knex, "audit_log"), before);
		assert.equal(await source.knex("session_revocation").where("sid", "logged-out").first(), undefined);
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("exits only after the answer went out and the window saw restarting; a later logout goes to the new database", async () => {
	const source = await migratedSqlite();
	let tick = null;
	const ctx = await make({
		source,
		later: (fn) => {
			tick = fn;
		},
	});
	try {
		await seedSource(source.knex);
		let sent;
		const answered = new Promise((resolve) => {
			sent = resolve;
		});
		await ctx.service.move(access, { engine: "sqlite" }, { sent: answered });
		// the move runs until the switch, then waits for the answer
		for (let i = 0; i < 400 && ctx.service.progress(access).move.state === "running"; i += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(ctx.service.progress(access).move.state, "restarting");
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(tick, null, "no restart timer before the answer");
		sent();
		for (let i = 0; i < 100 && !tick; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
		assert.equal(typeof tick, "function");
		assert.equal(ctx.calls.includes("exit"), false);
		// a logout during the restart delay is held, then written before the exit
		ctx.held.push({ sid: "late-logout", expires_at: 1_900_000_000 });
		tick();
		await ctx.service.settled();
		assert.deepEqual(ctx.calls.slice(-2), ["close sessions", "exit"]);
		const saved = parseConnectionFile(await readFile(path.join(ctx.target.dir, "database.json"), "utf8"), {
			unseal: () => "",
			dataDir: ctx.target.dir,
		});
		const copy = knexFactory(knexConfigOf({ engine: "sqlite", file: saved.file }));
		try {
			assert.ok(await copy("session_revocation").where("sid", "late-logout").first());
			assert.ok(await copy("session_revocation").where("sid", "logged-out").first());
		} finally {
			await copy.destroy();
		}
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("after database.json is written nothing reaches the failure path, a throwing log included", async () => {
	const source = await migratedSqlite();
	const lines = [];
	const log = {
		info: () => {
			throw new Error("log is gone");
		},
		warn: () => {},
		error: (line) => lines.push(line),
	};
	const ctx = await make({ source, log });
	try {
		await seedSource(source.knex);
		await ctx.service.move(access, { engine: "sqlite" });
		await ctx.service.settled();
		const { move } = ctx.service.progress(access);
		assert.equal(move.state, "restarting", JSON.stringify(move.error));
		assert.equal(move.error, null);
		assert.ok(existsSync(path.join(ctx.target.dir, "database.json")));
		assert.equal(
			ctx.calls.some((call) => call.startsWith("audit")),
			false,
		);
		assert.equal(
			ctx.calls.some((call) => call.startsWith("resume")),
			false,
		);
		assert.deepEqual(ctx.calls.slice(-2), ["close sessions", "exit"]);
		assert.equal(ctx.maintenance.active(), true);
		assert.equal(ctx.released(), 0);
		assert.deepEqual(lines, []);
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("a failed last logout write is logged with the count, then sessions close and the process exits", async () => {
	const source = await migratedSqlite();
	const lines = [];
	const log = { info: () => {}, warn: () => {}, error: (line) => lines.push(line) };
	let writes = 0;
	const ctx = await make({
		source,
		log,
		writeRevocations: (_knex, held) => {
			writes += 1;
			held.push({ sid: "during-delay", expires_at: 1_900_000_000 });
			return Promise.reject(new Error("connection lost"));
		},
	});
	try {
		await ctx.service.move(access, { engine: "sqlite" });
		await ctx.service.settled();
		assert.equal(ctx.service.progress(access).move.state, "restarting");
		assert.equal(writes, 1);
		assert.deepEqual(ctx.calls.slice(-2), ["close sessions", "exit"]);
		assert.equal(lines.length, 1);
		assert.match(lines[0], LOST_LOGOUTS);
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("a throw from closing the logouts still closes the target and exits, the move stays done", async () => {
	const source = await migratedSqlite();
	const lines = [];
	const log = { info: () => {}, warn: () => {}, error: (line) => lines.push(line) };
	const ctx = await make({
		source,
		log,
		close: () => {
			throw new Error("cannot close");
		},
	});
	try {
		await ctx.service.move(access, { engine: "sqlite" });
		await ctx.service.settled();
		assert.equal(ctx.service.progress(access).move.state, "restarting");
		assert.deepEqual(ctx.calls.slice(-2), ["close sessions", "exit"]);
		assert.equal(lines.length, 1);
		assert.match(lines[0], CLOSE_FAILED);
		// the move stays done: database.json names the new file, nothing logged "stopped unexpectedly"
		const saved = parseConnectionFile(await readFile(path.join(ctx.target.dir, "database.json"), "utf8"), {
			unseal: () => "",
			dataDir: ctx.target.dir,
		});
		assert.ok(existsSync(saved.file));
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("a target test is refused while a move starts or runs", async () => {
	const source = await migratedSqlite();
	let tick = null;
	const ctx = await make({
		source,
		later: (fn) => {
			tick = fn;
		},
	});
	try {
		const starting = ctx.service.move(access, { engine: "sqlite" });
		// the move is between its checks and maintenance.start
		await assert.rejects(ctx.service.test(access, { engine: "sqlite" }), (error) => error.code === "move-running");
		await starting;
		await assert.rejects(
			ctx.service.test(access, { engine: "postgres", host: "db", port: 5432, user: "u", name: "n" }),
			(error) => error.code === "move-running" && error.status === 409,
		);
		for (let i = 0; i < 400 && !tick; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
		tick();
		await ctx.service.settled();
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

for (const [step, options] of [
	["maintenance", { failPause: true }],
	["backup", { failBackup: true }],
	["schema", { migrations: { tableName: "migrations", directory: "/nonexistent/migrations" } }],
	["copy", { select: "setting" }],
	["verify", { count: "setting" }],
	["switch", { writeFile: async () => Promise.reject(new Error("read-only file system")) }],
]) {
	it(`a failure at ${step} writes no file, keeps the old database and resumes`, async () => {
		const source = await migratedSqlite();
		const sourceKnex = options.select || options.count ? failing(source.knex, options) : undefined;
		const ctx = await make({ source, sourceKnex, ...options });
		try {
			await seedSource(source.knex);
			const before = await countRows(source.knex, "proxy_host");
			await ctx.service.move(access, { engine: "sqlite" });
			await ctx.service.settled();
			const { move } = ctx.service.progress(access);
			assert.equal(move.state, "failed");
			assert.equal(move.error.step, step);
			assert.ok(move.finished_at);
			assert.equal(typeof move.error.message_i18n, "string");
			assert.equal(existsSync(path.join(ctx.target.dir, "database.json")), false);
			assert.equal(ctx.maintenance.active(), false);
			assert.equal(ctx.released(), 1);
			assert.ok(ctx.calls.includes(`audit move-failed ${step}`), ctx.calls.join(", "));
			assert.equal(ctx.calls.audit.object_type, "database");
			assert.equal(ctx.calls.includes("exit"), false);
			const paused = ctx.calls.filter((call) => call.startsWith("pause ")).map((call) => call.slice(6));
			const resumed = ctx.calls.filter((call) => call.startsWith("resume ")).map((call) => call.slice(7));
			assert.ok(paused.length > 0);
			assert.deepEqual(resumed, [...paused].reverse());
			// the logout held during the move lands in the database that stays
			assert.ok(await source.knex("session_revocation").where("sid", "logged-out").first());
			assert.equal(await countRows(source.knex, "proxy_host"), before);
			assert.equal(await source.knex("audit_log").where("action", "moved").first(), undefined);
			// a target file made by the move is left as it is (nothing dropped) and the error says so
			const left = (await readdir(ctx.target.dir)).filter((name) => name.endsWith(".sqlite"));
			const made = !["maintenance", "backup"].includes(step);
			assert.equal(left.length, made ? 1 : 0);
			assert.equal(LEFT_FILE.test(String(move.error.details)), made);
		} finally {
			await source.cleanup();
			await ctx.target.cleanup();
		}
	});
}

it("a failure reports the code of the step's error, an unknown error as failed", async () => {
	const source = await migratedSqlite();
	try {
		const copy = await make({ source, sourceKnex: failing(source.knex, { select: "setting" }) });
		await copy.service.move(access, { engine: "sqlite" });
		await copy.service.settled();
		const copied = copy.service.progress(access).move.error;
		assert.equal(copied.code, "copy");
		assert.equal(copied.message_i18n, "database.error.copy");
		const backup = await make({ source, failBackup: true });
		await backup.service.move(access, { engine: "sqlite" });
		await backup.service.settled();
		const unknown = backup.service.progress(access).move.error;
		assert.deepEqual(
			{ code: unknown.code, message_i18n: unknown.message_i18n, details: unknown.details },
			{ code: "failed", message_i18n: "database.error.failed", details: "disk full" },
		);
		for (const ctx of [copy, backup]) await ctx.target.cleanup();
	} finally {
		await source.cleanup();
	}
});

it("writes that started before the move must finish in time", async () => {
	const source = await migratedSqlite();
	const maintenance = createMaintenance();
	const ctx = await make({ source, maintenance });
	try {
		const release = maintenance.beginWrite();
		await ctx.service.move(access, { engine: "sqlite" });
		// the move waits for the write, nothing is paused yet
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.deepEqual(ctx.calls, []);
		release();
		await ctx.service.settled();
		assert.equal(ctx.service.progress(access).move.state, "restarting");
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("refuses from env, during a move, while a backup runs and when the new file exists", async () => {
	const source = await migratedSqlite();
	try {
		const fromEnv = await make({ source, env: true });
		await assert.rejects(
			fromEnv.service.move(access, { engine: "sqlite" }),
			(error) => error.code === "env-locked" && error.status === 409,
		);
		await assert.rejects(
			fromEnv.service.test(access, { engine: "sqlite" }),
			(error) => error.code === "env-locked",
		);
		const busy = await make({ source, busy: true });
		await assert.rejects(
			busy.service.move(access, { engine: "sqlite" }),
			(error) => error.code === "busy" && error.status === 409,
		);
		assert.equal(busy.maintenance.active(), false);
		const twice = await make({ source });
		twice.maintenance.start("other");
		await assert.rejects(
			twice.service.move(access, { engine: "sqlite" }),
			(error) => error.code === "move-running" && error.status === 409,
		);
		await assert.rejects(
			twice.service.move(access, { engine: "postgres", host: "db", port: 5432, user: "u", name: "n" }),
			(error) => error.code === "move-running",
		);
		assert.equal(twice.locked(), 0);
		await assert.rejects(twice.service.move(access, { engine: "nope" }), (error) => error.code === "move-running");
		const invalid = await make({ source });
		await assert.rejects(
			invalid.service.move(access, { engine: "nope" }),
			(error) => error.code === "invalid-target",
		);
		assert.equal(invalid.maintenance.active(), false);
		for (const ctx of [fromEnv, busy, twice, invalid]) await ctx.target.cleanup();
	} finally {
		await source.cleanup();
	}
});

it("never overwrites an existing SQLite file", async () => {
	const source = await migratedSqlite();
	// the names of the next 5 seconds are taken, so the name the move picks exists already
	const ctx = await make({ source });
	try {
		const now = Date.now();
		const pad = (value) => String(value).padStart(2, "0");
		for (let offset = 0; offset < 5; offset += 1) {
			const date = new Date(now + offset * 1000);
			const name = `database-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.sqlite`;
			await writeRaw(path.join(ctx.target.dir, name), "keep");
		}
		await assert.rejects(
			ctx.service.move(access, { engine: "sqlite" }),
			(error) => error.code === "not-empty" && error.status === 409,
		);
		assert.equal(ctx.maintenance.active(), false);
		assert.equal(ctx.locked(), 0);
		for (const name of await readdir(ctx.target.dir)) {
			assert.equal(await readFile(path.join(ctx.target.dir, name), "utf8"), "keep");
		}
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("reports the database in use without secrets", async () => {
	const source = await migratedSqlite();
	const ctx = await make({ source });
	try {
		await seedSource(source.knex);
		const status = await ctx.service.status(access);
		assert.equal(status.engine, "sqlite");
		assert.match(status.version, SQLITE_VERSION);
		assert.equal(status.source, "default");
		assert.equal(status.file, source.file);
		assert.ok(status.size > 0);
		assert.equal(status.move, null);
		assert.deepEqual(
			status.tables.find((table) => table.name === "proxy_host"),
			{ name: "proxy_host", rows: 11 },
		);
		assert.equal(
			status.tables.some((table) => table.name === "migrations"),
			false,
		);
		assert.equal(JSON.stringify(status).includes("password"), false);
	} finally {
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("moves SQLite to Postgres with a sealed password", { skip: pgSkip, timeout: 180_000 }, async () => {
	const source = await migratedSqlite();
	const lines = [];
	const log = {
		info: (line) => lines.push(line),
		warn: (line) => lines.push(line),
		error: (line) => lines.push(line),
	};
	const ctx = await make({ source, log });
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await seedSource(source.knex);
		await resetPg(pg);
		await ctx.service.move(access, pgConnection);
		await ctx.service.settled();
		const { move } = ctx.service.progress(access);
		assert.equal(move.state, "restarting", JSON.stringify(move.error));
		assert.equal(leaksPassword(move), false);
		assert.equal(leaksPassword(await ctx.service.status(access)), false);
		assert.ok(lines.length > 0);
		assert.equal(hideNames(lines.join("\n")).includes(pgConnection.password), false);
		const raw = await readFile(path.join(ctx.target.dir, "database.json"), "utf8");
		const stored = JSON.parse(raw).password;
		assert.match(stored, SEALED);
		assert.notEqual(stored, pgConnection.password);
		const saved = parseConnectionFile(raw, {
			unseal: (sealed) => box.decrypt(sealed).password,
			dataDir: ctx.target.dir,
		});
		assert.equal(saved.password, pgConnection.password);
		assert.equal(saved.engine, "postgres");
		assert.equal(saved.name, "npmpro_test_unit");
		const moved = await pg("audit_log").where("action", "moved").first();
		assert.equal(moved.id, (await countRows(source.knex, "audit_log")) + 1);
		assert.equal(await countRows(pg, "proxy_host"), 11);
		assert.ok(await pg("session_revocation").where("sid", "logged-out").first());
		assert.deepEqual(ctx.calls, [
			"pause renewals",
			"pause scheduler",
			"safety backup",
			"exit in 2000",
			"close sessions",
			"exit",
		]);
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("a failed move to Postgres leaves the target and says so", { skip: pgSkip, timeout: 180_000 }, async () => {
	const source = await migratedSqlite();
	const ctx = await make({ source, sourceKnex: failing(source.knex, { select: "setting" }) });
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await seedSource(source.knex);
		await resetPg(pg);
		await ctx.service.move(access, pgConnection);
		await ctx.service.settled();
		const { move } = ctx.service.progress(access);
		assert.equal(move.state, "failed");
		assert.equal(move.error.step, "copy");
		assert.match(move.error.details, LEFT_TARGET);
		assert.equal(leaksPassword(move), false);
		// the tables the move made are still there (nothing dropped), the copied tables before setting too
		assert.ok(await pg.schema.hasTable("proxy_host"));
		assert.equal(existsSync(path.join(ctx.target.dir, "database.json")), false);
		assert.ok(await source.knex("session_revocation").where("sid", "logged-out").first());
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("a target that is not empty is refused before maintenance starts", { skip: pgSkip, timeout: 60_000 }, async () => {
	const source = await migratedSqlite();
	const ctx = await make({ source });
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await resetPg(pg);
		await pg.schema.createTable("someone_elses", (table) => table.integer("id"));
		await assert.rejects(ctx.service.move(access, pgConnection), (error) => error.code === "not-empty");
		assert.equal(ctx.maintenance.active(), false);
		assert.equal(ctx.locked(), 0);
		assert.deepEqual(ctx.calls, []);
		assert.equal(ctx.service.progress(access).move, null);
		assert.deepEqual(await pg("someone_elses").select("*"), []);
		assert.equal(await pg.schema.hasTable("migrations"), false);
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
		await ctx.target.cleanup();
	}
});

it("a move waits for a target test that is running, its probe table does not block the move", {
	skip: pgSkip,
	timeout: 180_000,
}, async () => {
	const source = await migratedSqlite();
	const ctx = await make({ source });
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await resetPg(pg);
		const tested = ctx.service.test(access, pgConnection);
		const moved = ctx.service.move(access, pgConnection);
		assert.equal((await tested).engine, "postgres");
		await moved;
		await ctx.service.settled();
		const { move } = ctx.service.progress(access);
		assert.equal(move.state, "restarting", JSON.stringify(move.error));
		assert.equal(await pg.schema.hasTable("npmpro_move_probe"), false);
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
		await ctx.target.cleanup();
	}
});
