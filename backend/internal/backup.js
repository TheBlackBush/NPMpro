import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { extractTo, packStage } from "../lib/backup/archive.js";
import { exportStage, verifyStage } from "../lib/backup/export.js";
import { BackupError, FORMAT_VERSION, openBackupFile, readHeader, writeBackupFile } from "../lib/backup/format.js";
import { checkAdminOnly, checkItemValues } from "../lib/backup/import-checks.js";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { placeMergedFiles } from "../lib/backup/merge-files.js";
import { planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { checkStagedRenewals } from "../lib/backup/renewal-conf.js";
import { loadStageData, previewReplace, replaceTypes } from "../lib/backup/restore-db.js";
import {
	adminAvatarFiles,
	fitStagedAvatars,
	relinkCertbotLive,
	removeCachedGravatars,
	swapFiles,
} from "../lib/backup/restore-files.js";
import { allowFile, CATEGORIES, RESTORE_ORDER, TYPES } from "../lib/backup/types.js";
import { isRestartRule, rulesOf } from "../lib/runtime-rules.js";
import { createBackupPages, LINKED_KINDS, PAGE_KINDS, pageScope, permissionOf } from "./backup-pages.js";

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
// an nginx error about a file in the custom nginx folder, e.g. "in /data/custom_nginx/server_proxy.conf:1"
const CUSTOM_NGINX_ERROR = /\/custom_nginx\//u;

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
const FILES_PREFIX = "files/";
const FILE_KEY = "file:";

// the file types whose instance files a merge compares, and those placed file by file
const MERGE_FILE_TYPES = ["settings_default_site", "custom_nginx", "crowdsec_files"];
const CUSTOM_FILE_TYPES = ["custom_nginx", "crowdsec_files"];
const WRITTEN = new Set(["add", "replace", "take"]);

const expired = () =>
	Object.assign(new BackupError("token-expired", "The restore session has expired"), { status: 410 });

const settingsScope = (adminUserId) => ({
	adminUserId,
	importerId: adminUserId,
	page: false,
	isAdmin: true,
	canView: () => true,
	canManage: () => true,
	canEdit: () => true,
	visibleOwnerId: null,
});

const sha256 = (file) =>
	new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(file)
			.on("error", reject)
			.on("data", (chunk) => hash.update(chunk))
			.on("end", () => resolve(hash.digest("hex")));
	});

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

// the sha256 of the regular files below rel that allow takes, into out by path relative to base
const hashFiles = async (base, rel, allow, out) => {
	const info = await exists(path.join(base, rel));
	if (!(info && allow(rel))) return;
	if (info.isFile()) out[rel] = await sha256(path.join(base, rel));
	if (!info.isDirectory()) return;
	for (const name of await readdir(path.join(base, rel))) await hashFiles(base, `${rel}/${name}`, allow, out);
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
 * @param   {Object}    [deps.dnsCredentials]  { write(certificate), remove(id) }: the certbot credentials file of a
 *                                             DNS challenge certificate row, written or removed
 * @param   {Function}  [deps.exclusive]       (fn) => runs fn in the runtime settings queue
 * @param   {number}    [deps.maxUpload]       bytes, 2 GiB
 * @param   {number}    [deps.maxImport]       bytes, the page import limit (200 MB)
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
	const writeBackup = async ({ file, types, secrets, mode, passphrase, userId, items, accounts }) => {
		const stageDir = await store.createStageDir("tmp");
		try {
			const { summary } = await exportStage({
				knex,
				box,
				dataDir,
				stageDir,
				types,
				secrets,
				items,
				accounts,
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

	// every type, secrets included, into backups/auto with the instance key; page: before a page import, named and
	// pruned apart from the Settings ones; the caller holds the lock
	const automaticBackup = async (userId, page = false) => {
		const name = store.uniqueName(
			store.fileName({ host: hostname, date: new Date(clock.now()), auto: true, page }),
		);
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
			const open = async () =>
				openBackupFile({
					file,
					passphrase,
					instanceKey: header.kdf === "instance" ? await instanceKey() : undefined,
				});
			try {
				await extractTo({ source: await open(), dir: stageDir, allow: (rel) => allowFile(summary.types, rel) });
			} catch (error) {
				// an encrypted file is authenticated only at its end, so the garbage of a wrong passphrase or a changed
				// byte fails the gzip or tar parsing first: an invalid archive counts only once the file proved authentic
				if (header.kdf !== "none" && error?.code === "invalid-archive") await finished((await open()).resume());
				throw error;
			}
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

	// the staged files of the chosen types in place; a users restore leaves the admin's picture files alone
	const swapStage = async ({ stageDir, types, asideDir, adminUserId, users }) => {
		if (!types.includes("users")) return await swapFiles({ dataDir, stageDir, types, asideDir });
		if (users) await fitStagedAvatars({ stageDir, adminUserId, users });
		return await swapFiles({ dataDir, stageDir, types, asideDir, keep: adminAvatarFiles(adminUserId) });
	};

	// configs, access files and runtime settings from the database as it is now, then one nginx -t and reload; with
	// wereOnline, a host of it that the regeneration took offline fails the apply as nginx -t would
	const applyRestored = async (types, { onNginx, wereOnline } = {}) => {
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
		if (wereOnline) await refuseTakenOffline(wereOnline);
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
			const { users } = await replaceTypes({
				knex,
				data,
				types: restoreTypes,
				adminUserId,
				box,
				// the users' sessions stay as they were before the failed restore
				now: null,
			});
			await swapStage({ stageDir: auto.stageDir, types, asideDir, adminUserId, users });
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

	// "proxy_host:1" of every enabled host nginx serves now
	const onlineHosts = async () => {
		const out = new Set();
		for (const typeId of HOST_TYPES) {
			const { table } = TYPES[typeId].tables[0];
			for (const row of await knex(table).where("enabled", 1).select("id", "npmpro_nginx_online")) {
				if (!OFFLINE.has(row.npmpro_nginx_online)) out.add(`${table}:${row.id}`);
			}
		}
		return out;
	};

	/**
	 * A changed custom nginx file breaks hosts one by one: the regeneration keeps the config of each host it breaks as
	 * .err, and nginx -t of the whole configuration passes. A host that was online before and is offline now, or an
	 * offline host whose nginx error names a custom nginx file (a host the apply brought in), fails the apply as
	 * nginx -t would, so that it is rolled back.
	 *
	 * @param {Set<string>} wereOnline  from onlineHosts() before the apply
	 */
	const refuseTakenOffline = async (wereOnline) => {
		const taken = (await offlineHosts()).filter(
			(host) => wereOnline.has(`${host.type}:${host.id}`) || CUSTOM_NGINX_ERROR.test(host.error),
		);
		if (taken.length === 0) return;
		const names = taken.map((host) => host.domain).join(", ");
		throw new Error(`${names} would go offline: ${taken[0].error}`);
	};

	// whether a restored runtime settings row holds a setting that needs a restart
	const needsRestart = (types, data) =>
		types.includes("settings_runtime") &&
		(data.settings_runtime?.setting ?? []).some((row) => {
			const keys = Object.keys(row.meta && typeof row.meta === "object" ? row.meta : {});
			return rulesOf(row.id).some((rule) => isRestartRule(rule) && keys.includes(rule.key));
		});

	/**
	 * The apply of a restore or merge: automatic backup, the database step, the file step, regenerate, nginx -t and
	 * reload; a failure past the database commit puts the instance back from the automatic backup. Then the cached
	 * Gravatar pictures of the written users go, the offline hosts are read and the audit entry is written.
	 *
	 * @param   {Object}    options
	 * @param   {string}    options.what                   "restore" or "merge", for the messages
	 * @param   {boolean}   [options.page]                 a page import: its automatic backup is named apart
	 * @param   {Object}    options.access
	 * @param   {number}    options.userId                 who made the automatic backup
	 * @param   {number}    options.adminUserId
	 * @param   {string[]}  options.types                  the types regenerated and rolled back
	 * @param   {boolean}   [options.customFiles]          custom nginx files change: a host the apply takes offline
	 *                                                     fails it
	 * @param   {Function}  options.dbStep                 () => Promise<result>, one transaction
	 * @param   {Function}  options.fileStep               (result, asideDir) => Promise<{ undo }>
	 * @param   {Function}  options.gravatarIds            (result) => ids
	 * @param   {Function}  options.auditEntry             ({ result, autoName, offline }) => the audit entry
	 * @returns {Promise<{ result, runtimeFailed: string[], offline: Array }>}
	 */
	const applyWithRollback = async ({
		what,
		page = false,
		access,
		userId,
		adminUserId,
		types,
		customFiles = false,
		dbStep,
		fileStep,
		gravatarIds,
		auditEntry,
	}) => {
		const certificateIdsBefore = await knex("certificate").pluck("id");
		let autoName = null;
		let result = null;
		let swap = null;
		let nginxStep = false;
		let asideDir = null;
		let runtimeFailed = [];
		let wereOnline = null;
		try {
			wereOnline = customFiles ? await onlineHosts() : null;
			autoName = await automaticBackup(userId, page);
			result = await dbStep();
		} catch (error) {
			// the database transaction rolled back, the files are untouched
			log.error(`The ${what} failed before any change: ${error.message}`);
			if (error.public) throw error;
			throw new BackupError("restore-failed", `The ${what} failed and nothing was changed`, { cause: error });
		}
		try {
			try {
				asideDir = await store.createStageDir("restore");
				swap = await fileStep(result, asideDir);
				runtimeFailed = await applyRestored(types, {
					onNginx: () => {
						nginxStep = true;
					},
					wereOnline,
				});
			} catch (error) {
				log.error(`The ${what} failed, rolling back: ${error.message}`);
				try {
					await rollBack({
						autoName,
						types,
						references: result.references ?? [],
						swap,
						certificateIdsBefore,
						adminUserId,
					});
				} catch (rollbackError) {
					log.error(`The rollback failed: ${rollbackError.message}`);
					throw Object.assign(
						new BackupError(
							"rollback-failed",
							`The ${what} failed and could not be rolled back, restore the automatic backup ${autoName}`,
							{ cause: rollbackError },
						),
						{ status: 500 },
					);
				}
				if (nginxStep) {
					throw new BackupError(
						"nginx-failed",
						`nginx rejected the ${what}d configuration, everything was rolled back: ${error.message}`,
						{ cause: error },
					);
				}
				if (error.public) throw error;
				throw new BackupError("restore-failed", `The ${what} failed, everything was rolled back`, {
					cause: error,
				});
			}
		} finally {
			await withoutStage(asideDir);
		}
		const ids = gravatarIds(result);
		if (ids.length > 0) {
			try {
				await removeCachedGravatars({ dataDir, ids });
			} catch (error) {
				// a cache: the pictures are fetched again later
				log.warn(`Could not remove the cached Gravatar pictures of the ${what}d users: ${error.message}`);
			}
		}
		let offline = [];
		try {
			offline = await offlineHosts();
		} catch (error) {
			// the apply itself succeeded
			log.error(`Could not read the hosts nginx rejected after the ${what}: ${error.message}`);
		}
		try {
			await audit(access, auditEntry({ result, autoName, offline }));
		} catch (error) {
			// the apply itself succeeded
			log.error(`Could not write the audit log entry of the ${what}: ${error.message}`);
		}
		return { result, runtimeFailed, offline };
	};

	const runRestore = async ({ access, adminUserId, entry, types }) => {
		const data = await loadStageData(entry.stageDir, types);
		const { result, runtimeFailed, offline } = await applyWithRollback({
			what: "restore",
			access,
			userId: adminUserId,
			adminUserId,
			types,
			customFiles: types.includes("custom_nginx"),
			dbStep: () => replaceTypes({ knex, data, types, adminUserId, box, now: Math.floor(clock.now() / 1000) }),
			fileStep: async (replaced, asideDir) => {
				const swap = await swapStage({
					stageDir: entry.stageDir,
					types,
					asideDir,
					adminUserId,
					users: replaced.users,
				});
				if (types.includes("certificates")) {
					await relinkCertbotLive({ dataDir, ids: await knex("certificate").pluck("id") });
				}
				return swap;
			},
			gravatarIds: (replaced) => replaced.users?.ids ?? [],
			auditEntry: ({ result: replaced, autoName, offline: rejected }) => ({
				action: "restored",
				object_type: "backup",
				object_id: 0,
				meta: {
					name: entry.file,
					types,
					counts: replaced.counts,
					references: replaced.references.length,
					skipped_users: replaced.skippedUsers.map((user) => user.email),
					offline_hosts: rejected.length,
					automatic_backup: autoName,
				},
			}),
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

	// the restore session of the token and the scope its owner merges in: a Settings session is the admin's, a page
	// session belongs to its importer and needs manage permission on its kind
	const openSession = (access, token) => {
		const userId = access.token.getUserId(0);
		const entry = store.takeToken(token, { owner: userId });
		if (!entry.kind) {
			access.canAdmin();
			return { userId, entry, scope: settingsScope(userId) };
		}
		access.can(`${permissionOf(entry.kind)}:manage`);
		return { userId, entry, scope: pageScope(access, userId) };
	};

	// the merged types and the types loaded for them: any of the backup's in a Settings session; a page session selects
	// only its kind and loads the linked kinds the file has, whose items come along with the hosts that need them
	const mergedTypes = (entry, types) => {
		if (!entry.kind) {
			const chosen = chosenTypes(types, entry.manifest.types);
			return { chosen, loaded: chosen };
		}
		const chosen = chosenTypes(types ?? [entry.kind], [entry.kind]);
		const linked = LINKED_KINDS.filter((typeId) => typeId !== entry.kind && entry.manifest.types.includes(typeId));
		return { chosen, loaded: [...chosen, ...linked] };
	};

	const buildPlan = async ({ entry, scope, types, items, choices }) => {
		const { chosen, loaded: typesLoaded } = mergedTypes(entry, types);
		// owners are mapped by email through the backup's users, also when users are not merged
		const loaded = entry.manifest.types.includes("users") ? [...new Set([...typesLoaded, "users"])] : typesLoaded;
		const data = await loadStageData(entry.stageDir, loaded);
		const files = {};
		for (const typeId of MERGE_FILE_TYPES.filter((type) => chosen.includes(type))) {
			const { roots, allow } = TYPES[typeId].files;
			for (const root of roots) await hashFiles(dataDir, root, allow, files);
		}
		const stageFiles = Object.fromEntries(
			entry.manifest.files.map((file) => [file.path.slice(FILES_PREFIX.length), file.sha256]),
		);
		const plan = planMerge({
			data,
			instance: { ...(await readInstanceRows(knex)), files },
			stageFiles,
			types: chosen,
			items,
			choices,
			scope,
			secrets: entry.manifest.secrets === true,
		});
		// a merge writes only what the API would let its user set: values the API refuses everyone, and for a user who
		// is no administrator raw config and file serving too; checked again before an apply
		await checkItemValues({ plan, data });
		if (!scope.isAdmin) await checkAdminOnly({ knex, plan, data });
		await checkStagedRenewals({ stageDir: entry.stageDir, dataDir, items: plan.items });
		return { plan, data, types: chosen };
	};

	/**
	 * Writes the certbot credentials file of every added DNS challenge certificate under its new id (renewals read it);
	 * one whose credential was added without its values (a file without secrets) waits until the values are entered.
	 * The returned undo() removes the written files and then undoes the placed files; a failed write does both at once.
	 */
	const withCredentialFiles = async ({ swap, plan, merged, secrets }) => {
		const credentialMap = merged.maps.npmpro_dns_credential;
		const blank = new Set(
			secrets
				? []
				: plan.items
						.filter((item) => item.type === "dns_credentials" && item.action === "add")
						.map((item) => String(credentialMap.get(String(item.id)))),
		);
		const added = merged.certificateMoves.map((move) => move.to);
		const rows = added.length === 0 ? [] : await knex("certificate").whereIn("id", added).orderBy("id");
		const written = [];
		const undo = async () => {
			for (const id of written) await dnsCredentials.remove(id);
			await swap.undo();
		};
		try {
			for (const row of rows) {
				const credentialId = row.npmpro_dns_credential_id;
				if (!Number(row.npmpro_dns_challenge) || credentialId === null || credentialId === undefined) continue;
				if (blank.has(String(credentialId))) continue;
				written.push(row.id);
				await dnsCredentials.write(row);
			}
		} catch (error) {
			try {
				await undo();
			} catch (undoError) {
				error.cause ??= undoError;
			}
			throw error;
		}
		return { undo };
	};

	// the merge apply, through the same path as a restore
	const runMerge = async ({ access, userId, entry, scope, plan, data }) => {
		const taken = plan.items.filter((item) => item.action === "take");
		const takeFiles = taken
			.filter((item) => item.key.startsWith(FILE_KEY) && CUSTOM_FILE_TYPES.includes(item.type))
			.map((item) => item.key.slice(FILE_KEY.length));
		const takeDefaultSite = taken.some(
			(item) =>
				item.key === "setting:default-site" ||
				(item.key.startsWith(FILE_KEY) && item.type === "settings_default_site"),
		);
		// the database types the merge writes; a failure past the commit puts them back from the automatic backup
		const types = RESTORE_ORDER.filter((typeId) =>
			plan.items.some(
				(item) => item.type === typeId && WRITTEN.has(item.action) && !item.key.startsWith(FILE_KEY),
			),
		);
		const { result, runtimeFailed, offline } = await applyWithRollback({
			what: "merge",
			page: scope.page,
			access,
			userId,
			adminUserId: scope.adminUserId,
			types,
			customFiles: taken.some((item) => item.key.startsWith(FILE_KEY) && item.type === "custom_nginx"),
			dbStep: () =>
				mergeTypes({
					knex,
					data,
					plan,
					adminUserId: scope.adminUserId,
					importerId: scope.importerId,
					page: scope.page,
					box,
					secrets: entry.manifest.secrets === true,
					now: Math.floor(clock.now() / 1000),
				}),
			fileStep: async (merged, asideDir) => {
				const swap = await placeMergedFiles({
					dataDir,
					stageDir: entry.stageDir,
					asideDir,
					certificateMoves: merged.certificateMoves,
					takeFiles,
					takeDefaultSite,
					avatarMoves: merged.avatarMoves,
					// ACME accounts hold private keys: only an administrator brings new ones in
					placeAccounts: scope.isAdmin,
				});
				if (merged.certificateMoves.length > 0) {
					await relinkCertbotLive({ dataDir, ids: await knex("certificate").pluck("id") });
				}
				return await withCredentialFiles({ swap, plan, merged, secrets: entry.manifest.secrets === true });
			},
			gravatarIds: (merged) => merged.avatarMoves.map((move) => move.to),
			auditEntry: ({ result: merged, autoName }) =>
				scope.page
					? {
							action: "imported",
							object_type: PAGE_KINDS[entry.kind].objectType,
							object_id: 0,
							meta: { counts: merged.counts },
						}
					: {
							action: "merged",
							object_type: "backup",
							object_id: 0,
							meta: { name: entry.file, types, counts: merged.counts, automatic_backup: autoName },
						},
		});
		const takenIds = new Set(taken.map((item) => item.key));
		const takenRuntime = (data.settings_runtime?.setting ?? []).filter((row) => takenIds.has(`setting:${row.id}`));
		return {
			counts: result.counts,
			cleared: plan.cleared_links,
			needsSecrets: plan.needs_secrets,
			restartNeeded: needsRestart(types, { settings_runtime: { setting: takenRuntime } }),
			runtimeFailed,
			offlineHosts: offline,
		};
	};

	const mergeRestore = (access, token, { types, items, choices, planHash }) =>
		store.withLock(async () => {
			const { userId, entry, scope } = openSession(access, token);
			// outside the runtime queue, as in a replace
			await renewals.pause();
			try {
				return await exclusive(async () => {
					// planned again inside the queue: what is applied is what the user confirmed, or nothing
					const { plan, data } = await buildPlan({ entry, scope, types, items, choices });
					if (plan.hash !== planHash) {
						throw Object.assign(
							new BackupError("plan-changed", "The instance changed since the plan was made"),
							{ status: 409, payload: { plan } },
						);
					}
					store.takeToken(token, { keep: false, owner: userId });
					try {
						return await runMerge({ access, userId, entry, scope, plan, data });
					} finally {
						await withoutStage(entry.stageDir);
					}
				});
			} finally {
				renewals.resume();
			}
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
