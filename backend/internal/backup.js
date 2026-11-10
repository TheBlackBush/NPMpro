import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BackupError, readHeader } from "../lib/backup/format.js";
import { loadStageData, previewReplace } from "../lib/backup/restore-db.js";
import { CATEGORIES, TYPES } from "../lib/backup/types.js";
import { createBackupWriter } from "./backup-create.js";
import { createMerge } from "./backup-merge.js";
import { createOfflineChecks } from "./backup-offline.js";
import { createBackupPages } from "./backup-pages.js";
import { createRestore } from "./backup-restore.js";
import { ALL_TYPES, chosenTypes, exists, unknownMigrations, withoutStage } from "./backup-shared.js";

// Creating, storing and restoring backups. Everything the service touches is injected (createBackupService), so it
// runs against a test database and folders; internal/backup-service.js wires the default instance.

const MIN_PASSPHRASE = 12;
const MAX_UPLOAD = 2 * 1024 ** 3;
const CERTIFICATE_KINDS = ["letsencrypt", "other", "mtls"];

const AUTO_SUFFIX = /-auto\.npmpro$/u;

const expired = () =>
	Object.assign(new BackupError("token-expired", "The restore session has expired"), { status: 410 });

// the archive mode of each schedule protection
const SCHEDULE_MODES = { passphrase: "passphrase", instance_key: "instance", none: "none" };

const checkPassphrase = (passphrase) => {
	if (typeof passphrase !== "string" || [...passphrase.normalize("NFC")].length < MIN_PASSPHRASE) {
		throw new BackupError("weak-passphrase", `The passphrase needs at least ${MIN_PASSPHRASE} characters`);
	}
};

/**
 * Streams an upload into file, refusing it past max bytes
 *
 * @returns {Promise<number>}  the bytes written
 */
const receive = async (readable, file, max, message) => {
	let bytes = 0;
	const limit = new Transform({
		transform(chunk, _encoding, done) {
			bytes += chunk.length;
			if (bytes > max) done(Object.assign(new BackupError("too-large", message), { status: 413 }));
			else done(null, chunk);
		},
	});
	await pipeline(readable, limit, createWriteStream(file, { mode: 0o600, flags: "wx" }));
	return bytes;
};

// the manifest as the UI sees it, without the file list
const manifestView = ({ files: _files, ...rest }) => rest;

/**
 * Everything it touches is in deps: knex, box (secret box), dataDir, store (createBackupStore), dbVersion,
 * dbMigrations, npmproVersion, instanceKey, audit, nginx { test, reload }, renewals { pause, resume }, regenerate,
 * runtime, hostname, and the optional reloadSettings, dnsCredentials { write, remove }, exclusive (the runtime
 * settings queue), maxUpload, maxImport, clock { now } and log.
 */
const createBackupService = ({
	knex,
	box,
	dataDir,
	store,
	dbVersion,
	dbMigrations,
	npmproVersion,
	instanceKey,
	audit,
	nginx,
	renewals,
	regenerate,
	runtime,
	reloadSettings = {},
	dnsCredentials = { write: async () => {}, remove: async () => {} },
	exclusive = (fn) => fn(),
	maxUpload = MAX_UPLOAD,
	maxImport,
	hostname,
	clock = Date,
	log = console,
}) => {
	const adminOf = (access) => {
		access.canAdmin();
		return access.token.getUserId(0);
	};

	// one shared set of the injected values (defaults applied) for the files the service is built from
	const deps = {
		knex,
		box,
		dataDir,
		store,
		dbVersion,
		dbMigrations,
		npmproVersion,
		instanceKey,
		audit,
		nginx,
		renewals,
		regenerate,
		runtime,
		reloadSettings,
		dnsCredentials,
		exclusive,
		maxUpload,
		maxImport,
		hostname,
		clock,
		log,
	};

	const { countRows, countTypeFiles, writeBackup, entryOf, automaticBackup } = createBackupWriter(deps);
	const { offlineHosts, onlineHosts, refuseTakenOffline } = createOfflineChecks(deps);
	const { extractBackup, needsRestart, applyWithRollback, runRestore } = createRestore(deps, {
		automaticBackup,
		offlineHosts,
		onlineHosts,
		refuseTakenOffline,
	});
	const { openSession, buildPlan, mergeRestore } = createMerge(deps, {
		offlineHosts,
		needsRestart,
		applyWithRollback,
	});

	const pages = createBackupPages({
		knex,
		store,
		extractBackup,
		writeBackup,
		buildPlan,
		receive,
		checkPassphrase,
		manifestView,
		withoutStage,
		audit,
		hostname,
		clock,
		log,
		maxImport,
	});

	return {
		...pages,

		/**
		 * @returns {Promise<{ categories: Array, counts: Object<string, number>, certificateKinds: Object }>}
		 */
		types: async (access) => {
			access.canAdmin();
			const counts = {};
			for (const typeId of ALL_TYPES) {
				counts[typeId] =
					TYPES[typeId].tables.length > 0 ? await countRows(typeId) : await countTypeFiles(typeId);
			}
			const certificateKinds = Object.fromEntries(CERTIFICATE_KINDS.map((kind) => [kind, 0]));
			for (const row of await knex("certificate").select("provider").count({ count: "*" }).groupBy("provider")) {
				certificateKinds[row.provider] = Number(row.count);
			}
			return {
				categories: CATEGORIES,
				counts,
				certificateKinds,
				time_zone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
			};
		},

		/**
		 * One run of a backup schedule into the backup folder (spec "Scheduler"); the caller checks access
		 *
		 * @param   {Object}  options  { scheduleId, types, protection, passphrase, userId }
		 * @returns {Promise<{ name: string, size: number }>}
		 */
		scheduledBackup: async ({ scheduleId, types, protection, passphrase, userId }) => {
			const chosen = chosenTypes(types);
			const mode = SCHEDULE_MODES[protection];
			if (!mode) throw new BackupError("invalid-types", `Unknown protection ${protection}`);
			if (mode === "passphrase") checkPassphrase(passphrase);
			return await store.withLock(async () => {
				const name = store.uniqueName(
					store.fileName({ host: hostname, date: new Date(clock.now()), scheduleId }),
				);
				const file = store.pathOf(name);
				await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
				await writeBackup({
					file,
					types: chosen,
					secrets: mode !== "none",
					mode,
					passphrase: mode === "passphrase" ? passphrase : undefined,
					userId,
				});
				return { name, size: (await stat(file)).size };
			});
		},

		/**
		 * The backup lock for a database move (spec "Move steps"): taken at once (busy while a backup or restore runs),
		 * held until release(); safetyBackup writes the automatic backup of every type with the instance key under
		 * this same lock (backups/auto, pruned like the restore ones) and returns its name
		 *
		 * @param   {number}  userId
		 * @returns {{ safetyBackup: () => Promise<string>, release: () => void }}
		 */
		lockForMove: (userId) => {
			const release = store.acquire();
			let released = false;
			return {
				safetyBackup: async () => {
					if (released) throw new Error("The backup lock of the database move was released already");
					return await automaticBackup(userId);
				},
				release: () => {
					released = true;
					release();
				},
			};
		},

		/**
		 * @param   {Access}  access
		 * @param   {Object}  options   { types, secrets, passphrase, keep }
		 * @returns {Promise<{ entry: Object } | { pending: string, name: string }>}  keep: the stored backup; else a
		 *                                                    pending download (store.takePending) under that name
		 */
		create: async (access, { types, secrets, passphrase, keep }) => {
			const userId = adminOf(access);
			const chosen = chosenTypes(types);
			if (secrets) checkPassphrase(passphrase);
			return await store.withLock(async () => {
				const name = store.uniqueName(store.fileName({ host: hostname, date: new Date(clock.now()) }));
				const file = keep ? store.pathOf(name) : store.tempPath("tmp");
				try {
					await writeBackup({
						file,
						types: chosen,
						secrets: Boolean(secrets),
						mode: secrets ? "passphrase" : "none",
						passphrase: secrets ? passphrase : undefined,
						userId,
					});
					const size = (await stat(file)).size;
					await audit(access, {
						action: "created",
						object_type: "backup",
						object_id: 0,
						meta: { name, types: chosen, secrets: Boolean(secrets), size, kept: Boolean(keep) },
					});
					if (keep) return { entry: await entryOf(name) };
					return { pending: await store.addPending(file, { owner: userId }), name };
				} catch (error) {
					if (!keep) await rm(file, { force: true });
					throw error;
				}
			});
		},

		/**
		 * The file of a backup created with keep: false, once; the caller removes it after sending it
		 *
		 * @returns {string}
		 */
		takePending: (access, id) => store.takePending(id, { owner: access.token.getUserId(0) }),

		list: async (access) => {
			access.canAdmin();
			return await store.list();
		},

		/** @returns {Promise<string>} the path of the stored backup */
		download: async (access, name) => {
			access.canAdmin();
			const file = store.pathOf(name);
			if (!(await exists(file))?.isFile()) {
				throw Object.assign(new BackupError("not-a-backup", "Backup not found"), { status: 404 });
			}
			return file;
		},

		remove: async (access, name) => {
			access.canAdmin();
			await store.remove(name);
			await audit(access, { action: "deleted", object_type: "backup", object_id: 0, meta: { name } });
		},

		/**
		 * Stores an uploaded backup under its own name (a suffix when the name is taken), or a name from its summary
		 *
		 * @param   {Access}                        access
		 * @param   {import("node:stream").Readable}  readable
		 * @param   {Object}                        [options]
		 * @param   {string}                        [options.name]  the uploaded file's name
		 * @returns {Promise<Object>}  the stored entry
		 */
		upload: async (access, readable, { name } = {}) => {
			access.canAdmin();
			const temp = store.tempPath("upload");
			try {
				const bytes = await receive(readable, temp, maxUpload, "The backup file is larger than 2 GiB");
				const { header } = await readHeader(temp);
				let wanted = name;
				if (typeof wanted !== "string" || !store.NAME.test(wanted)) {
					const created = new Date(header.summary?.created_at ?? clock.now());
					wanted = store.fileName({
						host: "upload",
						date: Number.isNaN(created.getTime()) ? new Date(clock.now()) : created,
					});
				}
				// an uploaded file is never an automatic backup or part of a local schedule: those are pruned and live in their own folder
				const stored = store.uniqueName(store.withoutSchedule(wanted.replace(AUTO_SUFFIX, ".npmpro")));
				await rename(temp, store.pathOf(stored));
				await audit(access, {
					action: "uploaded",
					object_type: "backup",
					object_id: 0,
					meta: { name: stored, size: bytes },
				});
				return entryOf(stored);
			} finally {
				await rm(temp, { force: true });
			}
		},

		/**
		 * Unpacks a stored backup into a stage kept under a restore token and returns what a restore would change
		 *
		 * @returns {Promise<{ token: string, summary: Object, manifest: Object, preview: Object }>}
		 */
		inspect: async (access, name, { passphrase } = {}) => {
			const adminUserId = adminOf(access);
			const file = store.pathOf(name);
			if (!(await exists(file))?.isFile()) {
				throw Object.assign(new BackupError("not-a-backup", "Backup not found"), { status: 404 });
			}
			return store.withLock(async () => {
				const { stageDir, summary, manifest } = await extractBackup(file, { passphrase });
				try {
					const data = await loadStageData(stageDir, manifest.types);
					const preview = await previewReplace({
						knex,
						data,
						types: manifest.types,
						adminUserId,
						secrets: manifest.secrets === true,
					});
					const token = store.createToken({ stageDir, file: name, manifest, owner: adminUserId });
					return { token, summary, manifest: manifestView(manifest), preview };
				} catch (error) {
					await withoutStage(stageDir);
					throw error;
				}
			});
		},

		/** @returns {Promise<Object>} the preview of a restore of these types */
		check: async (access, token, { types }) => {
			const adminUserId = adminOf(access);
			const entry = store.takeToken(token, { owner: adminUserId });
			const chosen = chosenTypes(types, entry.manifest.types);
			const data = await loadStageData(entry.stageDir, chosen);
			return previewReplace({
				knex,
				data,
				types: chosen,
				adminUserId,
				secrets: entry.manifest.secrets === true,
			});
		},

		/**
		 * The dry run of a merge: what each item would do (merge-plan.js); changes nothing
		 *
		 * @param   {Access}  access
		 * @param   {string}  token
		 * @param   {Object}  options  { mode: "merge", types, items, choices }
		 * @returns {Promise<Object>}  the plan
		 */
		plan: async (access, token, { mode = "merge", types, items, choices } = {}) => {
			if (mode !== "merge") throw new BackupError("invalid-types", "Only a merge is planned");
			const { entry, scope } = openSession(access, token);
			return (await buildPlan({ entry, scope, types, items, choices })).plan;
		},

		/**
		 * Replaces the chosen types with the backup's (spec "Restore (replace)"), or merges the backup's items into the
		 * instance when the plan is still the one with planHash (spec "Merge rules")
		 *
		 * @returns {Promise<Object>}  replace: { counts, references, skippedUsers, restartNeeded, runtimeFailed,
		 *          offlineHosts }; merge: { counts, cleared, needsSecrets, restartNeeded, runtimeFailed, offlineHosts }
		 */
		restore: async (access, token, { mode = "replace", types, items, choices, planHash } = {}) => {
			if (mode === "merge") return await mergeRestore(access, token, { types, items, choices, planHash });
			if (mode !== "replace") throw new BackupError("invalid-types", "Unknown restore mode");
			const adminUserId = adminOf(access);
			return await store.withLock(async () => {
				const opened = store.takeToken(token, { owner: adminUserId });
				// a page import session only merges
				if (opened.kind) throw expired();
				// replacing a type with a part of it would delete the rest
				if (opened.manifest.partial === true) {
					throw new BackupError("partial-replace", "A file with single items can only be merged");
				}
				const chosen = chosenTypes(types, opened.manifest.types);
				const entry = store.takeToken(token, { keep: false, owner: adminUserId });
				try {
					// outside the runtime queue: a running renewal queues its stapling recovery there and must be able
					// to finish before the pause returns
					await renewals.pause();
					return await exclusive(() => runRestore({ access, adminUserId, entry, types: chosen }));
				} finally {
					renewals.resume();
					await withoutStage(entry.stageDir);
				}
			});
		},

		// a Settings session is cancelled by its admin, a page import session by its importer
		cancel: (access, token) => {
			const owner = access.token.getUserId(0);
			let entry;
			try {
				entry = store.takeToken(token, { owner });
			} catch (error) {
				if (error.code === "token-expired") return;
				throw error;
			}
			if (!entry.kind) access.canAdmin();
			store.dropToken(token);
		},
	};
};

export { createBackupService, unknownMigrations };
