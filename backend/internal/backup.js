import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractTo, packStage } from "../lib/backup/archive.js";
import { exportStage, verifyStage } from "../lib/backup/export.js";
import { BackupError, FORMAT_VERSION, openBackupFile, readHeader, writeBackupFile } from "../lib/backup/format.js";
import { loadStageData, previewReplace, replaceTypes } from "../lib/backup/restore-db.js";
import { relinkCertbotLive, swapFiles } from "../lib/backup/restore-files.js";
import { allowFile, CATEGORIES, RESTORE_ORDER, TYPES } from "../lib/backup/types.js";
import { isRestartRule, rulesOf } from "../lib/runtime-rules.js";

// Creating, storing and restoring backups. Everything the service touches is injected (createBackupService), so it
// runs against a test database and folders; internal/backup-service.js wires the default instance.

const MIN_PASSPHRASE = 12;
const MAX_UPLOAD = 2 * 1024 ** 3;
const ALL_TYPES = CATEGORIES.flatMap((category) => category.types);
const CERTIFICATE_KINDS = ["letsencrypt", "other", "mtls"];
// the type each whole table belongs to: a reference fix in one of them changes that type
const TYPE_OF_TABLE = Object.fromEntries(
	Object.entries(TYPES).flatMap(([typeId, type]) =>
		type.tables.filter(({ where }) => !where).map(({ table }) => [table, typeId]),
	),
);

const HOST_TYPES = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams"];
const MAX_HOST_ERROR = 500;
const OFFLINE = new Set([0, false, "0", null]);

// a host's first domain name, a stream's incoming port
const hostLabel = (row) => {
	let names = row.domain_names;
	if (typeof names === "string") {
		try {
			names = JSON.parse(names);
		} catch {
			names = [];
		}
	}
	if (Array.isArray(names) && names.length > 0) return String(names[0]);
	return row.incoming_port === undefined || row.incoming_port === null ? "" : String(row.incoming_port);
};

const AUTO_SUFFIX = /-auto\.npmpro$/u;

const invalid = (reason) => new BackupError("invalid-archive", reason);

const isTypeList = (types) =>
	Array.isArray(types) && types.length > 0 && types.every((typeId) => Object.hasOwn(TYPES, typeId));

// the chosen types once each, in restore order; an unknown or empty choice is refused
const chosenTypes = (types, available = ALL_TYPES) => {
	if (!isTypeList(types)) throw new BackupError("invalid-types", "Choose at least one known type");
	const missing = types.filter((typeId) => !available.includes(typeId));
	if (missing.length > 0) throw new BackupError("invalid-types", `The backup does not hold ${missing.join(", ")}`);
	return RESTORE_ORDER.filter((typeId) => types.includes(typeId));
};

/**
 * The migrations a backup's database had that this instance has not run (a newer NPMpro made it). Migration names are
 * compared as a set: some old names have malformed timestamps, so the newest name says nothing. A backup without the
 * list (made before it was recorded) is accepted.
 *
 * @param   {*}         backupMigrations  manifest.db_migrations
 * @param   {string[]}  instanceMigrations
 * @returns {string[]}
 */
const unknownMigrations = (backupMigrations, instanceMigrations) => {
	if (backupMigrations === undefined) return [];
	if (!(Array.isArray(backupMigrations) && backupMigrations.every((name) => typeof name === "string"))) {
		throw invalid("The manifest lists invalid migrations");
	}
	const known = new Set(instanceMigrations);
	return backupMigrations.filter((name) => !known.has(name));
};

const checkPassphrase = (passphrase) => {
	if (typeof passphrase !== "string" || [...passphrase.normalize("NFC")].length < MIN_PASSPHRASE) {
		throw new BackupError("weak-passphrase", `The passphrase needs at least ${MIN_PASSPHRASE} characters`);
	}
};

const exists = (file) =>
	lstat(file).then(
		(info) => info,
		(error) => {
			if (error.code === "ENOENT") return null;
			throw error;
		},
	);

// the regular files below dir that allow takes, as paths relative to base
const countFiles = async (dir, base, allow) => {
	const info = await exists(dir);
	if (!info) return 0;
	const rel = path.relative(base, dir).split(path.sep).join("/");
	if (!allow(rel)) return 0;
	if (info.isFile()) return 1;
	if (!info.isDirectory()) return 0;
	let count = 0;
	for (const name of await readdir(dir)) count += await countFiles(path.join(dir, name), base, allow);
	return count;
};

// the manifest as the UI sees it, without the file list
const manifestView = ({ files: _files, ...rest }) => rest;

const withoutStage = async (stageDir) => {
	if (stageDir) await rm(stageDir, { recursive: true, force: true });
};

/**
 * @param   {Object}    deps
 * @param   {Object}    deps.knex
 * @param   {Object}    deps.box               the secret box: { encrypt, decrypt }
 * @param   {string}    deps.dataDir           the data folder (/data)
 * @param   {Object}    deps.store             createBackupStore()
 * @param   {Function}  deps.dbVersion         () => Promise<string>, the newest migration of the instance (shown)
 * @param   {Function}  deps.dbMigrations      () => Promise<string[]>, the names of the completed migrations
 * @param   {string}    deps.npmproVersion
 * @param   {Function}  deps.instanceKey       () => Promise<Buffer>, the key of the automatic backups
 * @param   {Function}  deps.audit             (access, { action, object_type, object_id, meta }) => Promise
 * @param   {Object}    deps.nginx             { test, reload }
 * @param   {Object}    deps.renewals          { pause, resume }
 * @param   {Object}    deps.regenerate        { loadEnabledHosts, regenerateAllHostsNow, rebuildAccessListFiles,
 *                                             regenerateDefaultSite }
 * @param   {Object}    deps.runtime           { loadRuntimeConfig, applyAllRuntime }
 * @param   {Object}    [deps.reloadSettings]  { oidc, monitoring }: make the running services read the settings again
 * @param   {Function}  [deps.exclusive]       (fn) => runs fn in the runtime settings queue
 * @param   {number}    [deps.maxUpload]       bytes, 2 GiB
 * @param   {string}    deps.hostname
 * @param   {Object}    [deps.clock]           { now() } in ms
 * @param   {Object}    [deps.log]             { info, warn, error }
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
	exclusive = (fn) => fn(),
	maxUpload = MAX_UPLOAD,
	hostname,
	clock = Date,
	log = console,
}) => {
	const adminOf = (access) => {
		access.canAdmin();
		return access.token.getUserId(0);
	};

	const createdBy = async (userId) => {
		const user = await knex("user").where({ id: userId }).first("name", "email");
		return { name: user?.name ?? "", email: user?.email ?? "" };
	};

	const countRows = async (typeId) => {
		const { table, where } = TYPES[typeId].tables[0];
		const query = knex(table);
		if (where) where(query);
		const [{ count }] = await query.count({ count: "*" });
		return Number(count);
	};

	const countTypeFiles = async (typeId) => {
		const { files } = TYPES[typeId];
		let count = 0;
		for (const root of files.roots) count += await countFiles(path.join(dataDir, root), dataDir, files.allow);
		return count;
	};

	/**
	 * Exports the types into a backup file at file; the caller holds the lock
	 *
	 * @returns {Promise<Object>}  the header summary
	 */
	const writeBackup = async ({ file, types, secrets, mode, passphrase, userId }) => {
		const stageDir = await store.createStageDir("tmp");
		try {
			const { summary } = await exportStage({
				knex,
				box,
				dataDir,
				stageDir,
				types,
				secrets,
				meta: {
					npmproVersion,
					dbVersion: await dbVersion(),
					dbMigrations: await dbMigrations(),
					createdBy: await createdBy(userId),
					createdAt: new Date(clock.now()).toISOString(),
				},
			});
			await writeBackupFile({
				source: packStage(stageDir),
				file,
				mode,
				passphrase,
				instanceKey: mode === "instance" ? await instanceKey() : undefined,
				summary,
			});
			return summary;
		} finally {
			await withoutStage(stageDir);
		}
	};

	const entryOf = async (name) => (await store.list()).find((item) => item.name === name);

	// every type, secrets included, into backups/auto with the instance key; the caller holds the lock
	const automaticBackup = async (userId) => {
		const name = store.uniqueName(store.fileName({ host: hostname, date: new Date(clock.now()), auto: true }));
		const file = store.pathOf(name);
		await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		await writeBackup({ file, types: ALL_TYPES, secrets: true, mode: "instance", userId });
		await store.pruneAuto();
		return name;
	};

	// the stage of a backup file: extracted, checked against its manifest; removed again on any failure
	const extractBackup = async (file, { passphrase } = {}) => {
		const { header } = await readHeader(file);
		const summary = header.summary;
		if (!(summary && typeof summary === "object" && isTypeList(summary.types))) {
			throw invalid("The backup header does not list known types");
		}
		if (header.v > FORMAT_VERSION || summary.format > FORMAT_VERSION) {
			throw new BackupError("newer-format", "This backup was made by a newer NPMpro, update NPMpro first");
		}
		const stageDir = await store.createStageDir("restore");
		try {
			const source = await openBackupFile({
				file,
				passphrase,
				instanceKey: header.kdf === "instance" ? await instanceKey() : undefined,
			});
			await extractTo({ source, dir: stageDir, allow: (rel) => allowFile(summary.types, rel) });
			let manifest;
			try {
				manifest = JSON.parse(await readFile(path.join(stageDir, "manifest.json"), "utf8"));
			} catch (error) {
				throw new BackupError("invalid-archive", "The manifest cannot be read", { cause: error });
			}
			if (!(manifest && typeof manifest === "object")) throw invalid("The manifest cannot be read");
			if (!(Number.isInteger(manifest.format) && manifest.format >= 1))
				throw invalid("The manifest has no format");
			if (manifest.format > FORMAT_VERSION) {
				throw new BackupError("newer-format", "This backup was made by a newer NPMpro, update NPMpro first");
			}
			if (!isTypeList(manifest.types) || manifest.types.some((typeId) => !summary.types.includes(typeId))) {
				throw invalid("The manifest lists other types than the header");
			}
			if (unknownMigrations(manifest.db_migrations, await dbMigrations()).length > 0) {
				throw new BackupError(
					"newer-database",
					"This backup has a newer database version, update NPMpro first",
				);
			}
			await verifyStage(stageDir, manifest);
			return { stageDir, summary, manifest };
		} catch (error) {
			await withoutStage(stageDir);
			throw error;
		}
	};

	const reloadRestoredSettings = async (types) => {
		if (types.includes("settings_oidc")) await reloadSettings.oidc?.();
		if (types.includes("settings_monitoring")) await reloadSettings.monitoring?.();
	};

	// configs, access files and runtime settings from the database as it is now, then one nginx -t and reload
	const applyRestored = async (types, { onNginx } = {}) => {
		await regenerate.rebuildAccessListFiles();
		await regenerate.regenerateAllHostsNow(await regenerate.loadEnabledHosts());
		await regenerate.regenerateDefaultSite();
		await runtime.loadRuntimeConfig();
		const failed = await runtime.applyAllRuntime();
		for (const [group, error] of Object.entries(failed ?? {})) {
			log.error(`Could not apply the ${group} runtime settings after the restore: ${error.message}`);
		}
		await reloadRestoredSettings(types);
		onNginx?.();
		await nginx.test();
		await nginx.reload();
		return Object.keys(failed ?? {});
	};

	// the types whose rows changed: the chosen ones and those a reference fix touched
	const changedTypes = (types, references) =>
		RESTORE_ORDER.filter(
			(typeId) => types.includes(typeId) || references.some((change) => TYPE_OF_TABLE[change.table] === typeId),
		);

	// puts the instance back from its automatic backup after a restore failed past the database commit
	const rollBack = async ({ autoName, types, references, swap, certificateIdsBefore, adminUserId }) => {
		const problems = [];
		try {
			await swap?.undo();
		} catch (error) {
			problems.push(error);
		}
		const restoreTypes = changedTypes(types, references);
		const auto = await extractBackup(store.pathOf(autoName));
		const asideDir = await store.createStageDir("restore");
		try {
			const data = await loadStageData(auto.stageDir, restoreTypes);
			await replaceTypes({
				knex,
				data,
				types: restoreTypes,
				adminUserId,
				box,
				now: Math.floor(clock.now() / 1000),
			});
			await swapFiles({ dataDir, stageDir: auto.stageDir, types, asideDir });
			if (types.includes("certificates")) await relinkCertbotLive({ dataDir, ids: certificateIdsBefore });
			await applyRestored(restoreTypes);
		} finally {
			await withoutStage(auto.stageDir);
			await withoutStage(asideDir);
		}
		for (const problem of problems) log.warn(`Rolling back the restore: ${problem.message}`);
	};

	/**
	 * The enabled hosts of every host type whose config nginx rejected in the regeneration (kept as .err): the
	 * regeneration renders all hosts, so a restore of certificates or access lists can break hosts too. They do not
	 * fail the restore.
	 *
	 * @returns {Promise<Array<{ type: string, id: number, domain: string, error: string }>>}
	 */
	const offlineHosts = async () => {
		const out = [];
		for (const typeId of HOST_TYPES) {
			const { table } = TYPES[typeId].tables[0];
			for (const row of await knex(table).where("enabled", 1).orderBy("id")) {
				if (!OFFLINE.has(row.npmpro_nginx_online)) continue;
				out.push({
					type: table,
					id: row.id,
					domain: hostLabel(row),
					error: String(row.npmpro_nginx_err ?? "").slice(0, MAX_HOST_ERROR),
				});
			}
		}
		return out;
	};

	// whether a restored runtime settings row holds a setting that needs a restart
	const needsRestart = (types, data) =>
		types.includes("settings_runtime") &&
		(data.settings_runtime?.setting ?? []).some((row) => {
			const keys = Object.keys(row.meta && typeof row.meta === "object" ? row.meta : {});
			return rulesOf(row.id).some((rule) => isRestartRule(rule) && keys.includes(rule.key));
		});

	const runRestore = async ({ access, adminUserId, entry, types }) => {
		const data = await loadStageData(entry.stageDir, types);
		const certificateIdsBefore = await knex("certificate").pluck("id");
		let autoName = null;
		let result = null;
		let swap = null;
		let nginxStep = false;
		let asideDir = null;
		let runtimeFailed = [];
		try {
			autoName = await automaticBackup(adminUserId);
			result = await replaceTypes({
				knex,
				data,
				types,
				adminUserId,
				box,
				now: Math.floor(clock.now() / 1000),
			});
			try {
				asideDir = await store.createStageDir("restore");
				swap = await swapFiles({ dataDir, stageDir: entry.stageDir, types, asideDir });
				if (types.includes("certificates")) {
					await relinkCertbotLive({ dataDir, ids: await knex("certificate").pluck("id") });
				}
				runtimeFailed = await applyRestored(types, {
					onNginx: () => {
						nginxStep = true;
					},
				});
			} catch (error) {
				log.error(`The restore failed, rolling back: ${error.message}`);
				try {
					await rollBack({
						autoName,
						types,
						references: result.references,
						swap,
						certificateIdsBefore,
						adminUserId,
					});
				} catch (rollbackError) {
					log.error(`The rollback failed: ${rollbackError.message}`);
					throw Object.assign(
						new BackupError(
							"rollback-failed",
							`The restore failed and could not be rolled back, restore the automatic backup ${autoName}`,
							{ cause: rollbackError },
						),
						{ status: 500 },
					);
				}
				if (nginxStep) {
					throw new BackupError(
						"nginx-failed",
						`nginx rejected the restored configuration, everything was rolled back: ${error.message}`,
						{ cause: error },
					);
				}
				if (error.public) throw error;
				throw new BackupError("restore-failed", "The restore failed, everything was rolled back", {
					cause: error,
				});
			}
		} finally {
			await withoutStage(asideDir);
		}
		let offline = [];
		try {
			offline = await offlineHosts();
		} catch (error) {
			// the restore itself succeeded
			log.error(`Could not read the hosts nginx rejected after the restore: ${error.message}`);
		}
		await audit(access, {
			action: "restored",
			object_type: "backup",
			object_id: 0,
			meta: {
				name: entry.file,
				types,
				counts: result.counts,
				references: result.references.length,
				skipped_users: result.skippedUsers.map((user) => user.email),
				offline_hosts: offline.length,
				automatic_backup: autoName,
			},
		});
		return {
			counts: result.counts,
			references: result.references,
			skippedUsers: result.skippedUsers,
			restartNeeded: needsRestart(types, data),
			runtimeFailed,
			offlineHosts: offline,
		};
	};

	return {
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
			return { categories: CATEGORIES, counts, certificateKinds };
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
					return { pending: await store.addPending(file), name };
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
		takePending: (access, id) => {
			access.canAdmin();
			return store.takePending(id);
		},

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
				let bytes = 0;
				const limit = new Transform({
					transform(chunk, _encoding, done) {
						bytes += chunk.length;
						if (bytes > maxUpload) {
							done(
								Object.assign(new BackupError("too-large", "The backup file is larger than 2 GiB"), {
									status: 413,
								}),
							);
						} else done(null, chunk);
					},
				});
				await pipeline(readable, limit, createWriteStream(temp, { mode: 0o600, flags: "wx" }));
				const { header } = await readHeader(temp);
				let wanted = name;
				if (typeof wanted !== "string" || !store.NAME.test(wanted)) {
					const created = new Date(header.summary?.created_at ?? clock.now());
					wanted = store.fileName({
						host: "upload",
						date: Number.isNaN(created.getTime()) ? new Date(clock.now()) : created,
					});
				}
				// an uploaded file is never an automatic backup: those are pruned and live in their own folder
				const stored = store.uniqueName(wanted.replace(AUTO_SUFFIX, ".npmpro"));
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
					const token = store.createToken({ stageDir, file: name, manifest });
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
			const entry = store.takeToken(token);
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
		 * Replaces the chosen types with the backup's (spec "Restore (replace)")
		 *
		 * @returns {Promise<{ counts: Object, references: Array, skippedUsers: Array, restartNeeded: boolean,
		 *                     runtimeFailed: string[], offlineHosts: Array }>}
		 */
		restore: async (access, token, { types }) => {
			const adminUserId = adminOf(access);
			return await store.withLock(async () => {
				const chosen = chosenTypes(types, store.takeToken(token).manifest.types);
				const entry = store.takeToken(token, { keep: false });
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

		cancel: (access, token) => {
			access.canAdmin();
			store.dropToken(token);
		},
	};
};

export { createBackupService, unknownMigrations };
