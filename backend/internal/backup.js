import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { extractTo, packStage } from "../lib/backup/archive.js";
import { exportStage, verifyStage } from "../lib/backup/export.js";
import { BackupError, FORMAT_VERSION, openBackupFile, readHeader, writeBackupFile } from "../lib/backup/format.js";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { placeMergedFiles } from "../lib/backup/merge-files.js";
import { planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { loadStageData, previewReplace, replaceTypes } from "../lib/backup/restore-db.js";
import {
	adminAvatarFiles,
	fitStagedAvatars,
	relinkCertbotLive,
	removeCachedGravatars,
	swapFiles,
} from "../lib/backup/restore-files.js";
import { ITEM_TYPES, itemLabel, linkedOf } from "../lib/backup/select.js";
import { allowFile, CATEGORIES, RESTORE_ORDER, TYPES } from "../lib/backup/types.js";
import errs from "../lib/error.js";
import { isRestartRule, rulesOf } from "../lib/runtime-rules.js";

// Creating, storing and restoring backups. Everything the service touches is injected (createBackupService), so it
// runs against a test database and folders; internal/backup-service.js wires the default instance.

const MIN_PASSPHRASE = 12;
const MAX_UPLOAD = 2 * 1024 ** 3;
const MAX_IMPORT = 200 * 1024 ** 2;
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
const FILES_PREFIX = "files/";
const FILE_KEY = "file:";

// the kinds of the list pages: the permission they need and their audit log object type
const PAGE_KINDS = {
	proxy_hosts: { permission: "proxy_hosts", objectType: "proxy-host" },
	redirection_hosts: { permission: "redirection_hosts", objectType: "redirection-host" },
	dead_hosts: { permission: "dead_hosts", objectType: "dead-host" },
	streams: { permission: "streams", objectType: "stream" },
	certificates: { permission: "certificates", objectType: "certificate" },
	access_lists: { permission: "access_lists", objectType: "access-list" },
	dns_credentials: { permission: "certificates", objectType: "dns-credential" },
};
// the kinds a page import or export brings along with its items
const LINKED_KINDS = ["certificates", "access_lists", "dns_credentials"];
// the file types whose instance files a merge compares, and those placed file by file
const MERGE_FILE_TYPES = ["settings_default_site", "custom_nginx", "crowdsec_files"];
const CUSTOM_FILE_TYPES = ["custom_nginx", "crowdsec_files"];
const WRITTEN = new Set(["add", "replace", "take"]);
const TYPE_OF_ITEM_TABLE = Object.fromEntries(Object.entries(ITEM_TYPES).map(([typeId, { table }]) => [table, typeId]));

const pageKind = (kind) => {
	if (!Object.hasOwn(PAGE_KINDS, kind)) throw new BackupError("invalid-types", "Unknown kind of items");
	return PAGE_KINDS[kind];
};

const permissionOf = (typeId) => PAGE_KINDS[typeId]?.permission ?? typeId;

// whether the user has the level (view, manage) on the type's permission
const allows = (access, typeId, level) => {
	try {
		access.can(`${permissionOf(typeId)}:${level}`);
		return true;
	} catch (error) {
		if (error instanceof errs.PermissionError) return false;
		throw error;
	}
};

const expired = () =>
	Object.assign(new BackupError("token-expired", "The restore session has expired"), { status: 410 });

const settingsScope = (adminUserId) => ({
	adminUserId,
	importerId: adminUserId,
	page: false,
	canView: () => true,
	canManage: () => true,
	canEdit: () => true,
	visibleOwnerId: null,
});

// a page import: the importer's permissions limit what is added, replaced and matched
const pageScope = (access, importerId) => {
	const canManage = (typeId) => allows(access, typeId, "manage");
	const all = access.visibility === "all";
	return {
		adminUserId: importerId,
		importerId,
		page: true,
		canView: (typeId) => allows(access, typeId, "view"),
		canManage,
		canEdit: (table, row) =>
			canManage(TYPE_OF_ITEM_TABLE[table]) && (all || String(row.owner_user_id) === String(importerId)),
		visibleOwnerId: all ? null : importerId,
	};
};

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
	const writeBackup = async ({ file, types, secrets, mode, passphrase, userId, items }) => {
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
		} catch (error) {
			// the database transaction rolled back, the files are untouched
			log.error(`The restore failed before any change: ${error.message}`);
			if (error.public) throw error;
			throw new BackupError("restore-failed", "The restore failed and nothing was changed", { cause: error });
		}
		try {
			try {
				asideDir = await store.createStageDir("restore");
				swap = await swapStage({ stageDir: entry.stageDir, types, asideDir, adminUserId, users: result.users });
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
		if (result.users) {
			try {
				await removeCachedGravatars({ dataDir, ids: result.users.ids });
			} catch (error) {
				// a cache: the pictures are fetched again later
				log.warn(`Could not remove the cached Gravatar pictures of the restored users: ${error.message}`);
			}
		}
		let offline = [];
		try {
			offline = await offlineHosts();
		} catch (error) {
			// the restore itself succeeded
			log.error(`Could not read the hosts nginx rejected after the restore: ${error.message}`);
		}
		try {
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
		} catch (error) {
			// the restore itself succeeded
			log.error(`Could not write the audit log entry of the restore: ${error.message}`);
		}
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

	// the merged types: any of the backup's in a Settings session; a page's kind and the linked kinds the file has
	const mergedTypes = (entry, types) => {
		if (!entry.kind) return chosenTypes(types, entry.manifest.types);
		const available = [entry.kind, ...LINKED_KINDS.filter((typeId) => typeId !== entry.kind)].filter((typeId) =>
			entry.manifest.types.includes(typeId),
		);
		return chosenTypes(types ?? available, available);
	};

	const buildPlan = async ({ entry, scope, types, items, choices }) => {
		const chosen = mergedTypes(entry, types);
		// owners are mapped by email through the backup's users, also when users are not merged
		const loaded = entry.manifest.types.includes("users") ? [...new Set([...chosen, "users"])] : chosen;
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
		return { plan, data, types: chosen };
	};

	// the merge apply, as runRestore: automatic backup, database, files, regenerate, nginx -t, reload; rollback
	const runMerge = async ({ access, userId, entry, scope, plan, data }) => {
		const certificateIdsBefore = await knex("certificate").pluck("id");
		const taken = plan.items.filter((item) => item.action === "take");
		const fileRel = (item) => item.key.slice(FILE_KEY.length);
		const takeFiles = taken
			.filter((item) => item.key.startsWith(FILE_KEY) && CUSTOM_FILE_TYPES.includes(item.type))
			.map(fileRel);
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
		let autoName = null;
		let result = null;
		let swap = null;
		let nginxStep = false;
		let asideDir = null;
		let runtimeFailed = [];
		try {
			autoName = await automaticBackup(userId);
			result = await mergeTypes({
				knex,
				data,
				plan,
				adminUserId: scope.adminUserId,
				importerId: scope.importerId,
				page: scope.page,
				box,
				secrets: entry.manifest.secrets === true,
				now: Math.floor(clock.now() / 1000),
			});
		} catch (error) {
			log.error(`The merge failed before any change: ${error.message}`);
			if (error.public) throw error;
			throw new BackupError("restore-failed", "The merge failed and nothing was changed", { cause: error });
		}
		try {
			try {
				asideDir = await store.createStageDir("restore");
				swap = await placeMergedFiles({
					dataDir,
					stageDir: entry.stageDir,
					asideDir,
					certificateMoves: result.certificateMoves,
					takeFiles,
					takeDefaultSite,
					avatarMoves: result.avatarMoves,
				});
				if (result.certificateMoves.length > 0) {
					await relinkCertbotLive({ dataDir, ids: await knex("certificate").pluck("id") });
				}
				runtimeFailed = await applyRestored(types, {
					onNginx: () => {
						nginxStep = true;
					},
				});
			} catch (error) {
				log.error(`The merge failed, rolling back: ${error.message}`);
				try {
					await rollBack({
						autoName,
						types,
						references: [],
						swap,
						certificateIdsBefore,
						adminUserId: scope.adminUserId,
					});
				} catch (rollbackError) {
					log.error(`The rollback failed: ${rollbackError.message}`);
					throw Object.assign(
						new BackupError(
							"rollback-failed",
							`The merge failed and could not be rolled back, restore the automatic backup ${autoName}`,
							{ cause: rollbackError },
						),
						{ status: 500 },
					);
				}
				if (nginxStep) {
					throw new BackupError(
						"nginx-failed",
						`nginx rejected the merged configuration, everything was rolled back: ${error.message}`,
						{ cause: error },
					);
				}
				if (error.public) throw error;
				throw new BackupError("restore-failed", "The merge failed, everything was rolled back", {
					cause: error,
				});
			}
		} finally {
			await withoutStage(asideDir);
		}
		const userIds = result.avatarMoves.map((move) => move.to);
		if (userIds.length > 0) {
			try {
				await removeCachedGravatars({ dataDir, ids: userIds });
			} catch (error) {
				log.warn(`Could not remove the cached Gravatar pictures of the merged users: ${error.message}`);
			}
		}
		let offline = [];
		try {
			offline = await offlineHosts();
		} catch (error) {
			log.error(`Could not read the hosts nginx rejected after the merge: ${error.message}`);
		}
		try {
			await audit(
				access,
				scope.page
					? {
							action: "imported",
							object_type: PAGE_KINDS[entry.kind].objectType,
							object_id: 0,
							meta: { counts: result.counts },
						}
					: {
							action: "merged",
							object_type: "backup",
							object_id: 0,
							meta: { name: entry.file, types, counts: result.counts, automatic_backup: autoName },
						},
			);
		} catch (error) {
			log.error(`Could not write the audit log entry of the merge: ${error.message}`);
		}
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

	// the rows of a type the user can see, all or those with the ids
	const visibleRows = (access, typeId, ids) => {
		const query = knex(ITEM_TYPES[typeId].table).orderBy("id");
		if (access.visibility !== "all") query.where("owner_user_id", access.token.getUserId(1));
		if (ids !== undefined) query.whereIn("id", ids);
		return query;
	};

	// the user's visible rows of the page kind and the linked items they need, of the kinds the user can view
	const exportSelection = async (access, { kind, ids }) => {
		const { permission } = pageKind(kind);
		access.can(`${permission}:view`);
		if (!(ids === undefined || Array.isArray(ids))) throw new BackupError("invalid-types", "Choose the items");
		const rows = await visibleRows(access, kind, ids);
		const data = { [kind]: { [ITEM_TYPES[kind].table]: rows } };
		if (kind === "proxy_hosts") {
			data.proxy_hosts.npmpro_proxy_host_access_list = await knex("npmpro_proxy_host_access_list").whereIn(
				"proxy_host_id",
				rows.map((row) => row.id),
			);
		}
		const linked = [];
		const addLinked = async (typeId, neededBy) => {
			if (typeId === kind || neededBy.size === 0 || !allows(access, typeId, "view")) return [];
			const found = await visibleRows(access, typeId, [...neededBy.keys()]);
			for (const row of found) {
				const keys = [...neededBy.get(String(row.id))].sort((x, y) => (x < y ? -1 : Number(x > y)));
				linked.push({ type: typeId, id: row.id, label: itemLabel(typeId, row), needed_by: keys });
			}
			return found;
		};
		const needed = linkedOf(data);
		const certificates = await addLinked("certificates", needed.certificates);
		await addLinked("access_lists", needed.access_lists);
		const withCertificates = { certificates: { certificate: kind === "certificates" ? rows : certificates } };
		await addLinked("dns_credentials", linkedOf(withCertificates).dns_credentials);
		return { rows, linked };
	};

	const importKinds = new Map();

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

		/**
		 * The items of a page kind an export would hold: the visible ones (all, or those with the ids) and the
		 * certificates, access lists and DNS credentials they need, of the kinds the user can view
		 *
		 * @returns {Promise<{ items: Array<{ id, label }>, linked: Array<{ type, id, label, needed_by }>,
		 *                     secretsAllowed: boolean }>}
		 */
		exportPreview: async (access, { kind, ids } = {}) => {
			const { rows, linked } = await exportSelection(access, { kind, ids });
			// secrets need manage permission on every kind they come from
			const kinds = [kind, ...new Set(linked.map((item) => item.type))];
			return {
				items: rows.map((row) => ({ id: row.id, label: itemLabel(kind, row) })),
				linked,
				secretsAllowed: kinds.every((typeId) => allows(access, typeId, "manage")),
			};
		},

		/**
		 * Exports items of a page kind with the chosen linked items into a partial file, as a pending download
		 *
		 * @param   {Access}  access
		 * @param   {Object}  options  { kind, ids, linked: { [typeId]: ids }, secrets, passphrase }
		 * @returns {Promise<{ pending: string, name: string }>}
		 */
		exportItems: async (access, { kind, ids, linked, secrets, passphrase } = {}) => {
			const userId = access.token.getUserId(0);
			const selection = await exportSelection(access, { kind, ids });
			if (selection.rows.length === 0) throw new BackupError("invalid-types", "Choose at least one item");
			const items = { [kind]: selection.rows.map((row) => row.id) };
			for (const item of selection.linked) {
				if ((linked?.[item.type] ?? []).some((id) => String(id) === String(item.id))) {
					items[item.type] ??= [];
					items[item.type].push(item.id);
				}
			}
			const types = ALL_TYPES.filter((typeId) => Object.hasOwn(items, typeId));
			if (secrets) {
				for (const typeId of types) access.can(`${permissionOf(typeId)}:manage`);
				checkPassphrase(passphrase);
			}
			return await store.withLock(async () => {
				const name = store.exportName({ kind, host: hostname, date: new Date(clock.now()) });
				const file = store.tempPath("tmp");
				try {
					await writeBackup({
						file,
						types,
						secrets: Boolean(secrets),
						mode: secrets ? "passphrase" : "none",
						passphrase: secrets ? passphrase : undefined,
						userId,
						items,
					});
					await audit(access, {
						action: "exported",
						object_type: PAGE_KINDS[kind].objectType,
						object_id: 0,
						meta: {
							name,
							counts: Object.fromEntries(types.map((typeId) => [typeId, items[typeId].length])),
							secrets: Boolean(secrets),
						},
					});
					return { pending: await store.addPending(file, { owner: userId }), name };
				} catch (error) {
					await rm(file, { force: true });
					throw error;
				}
			});
		},

		/**
		 * Keeps an uploaded file for a page import of the kind, owned by the user, until importOpen
		 *
		 * @returns {Promise<{ id: string, summary: Object, encrypted: boolean }>}
		 */
		importUpload: async (access, readable, { kind } = {}) => {
			access.can(`${pageKind(kind).permission}:manage`);
			const temp = store.tempPath("upload");
			try {
				await receive(readable, temp, MAX_IMPORT, "The file is larger than 200 MB");
				const { header } = await readHeader(temp);
				const id = await store.addPending(temp, { owner: access.token.getUserId(0) });
				importKinds.set(id, kind);
				return { id, summary: header.summary ?? null, encrypted: header.kdf !== "none" };
			} finally {
				await rm(temp, { force: true });
			}
		},

		/**
		 * Unpacks an uploaded page import into a restore session of the user and its kind, with the plan of a merge
		 * with the default choices
		 *
		 * @returns {Promise<{ token: string, summary: Object, manifest: Object, plan: Object }>}
		 */
		importOpen: async (access, id, { passphrase } = {}) => {
			const userId = access.token.getUserId(0);
			const file = store.takePending(id, { owner: userId });
			const kind = importKinds.get(id);
			importKinds.delete(id);
			try {
				if (!kind) throw expired();
				access.can(`${permissionOf(kind)}:manage`);
				return await store.withLock(async () => {
					const { stageDir, summary, manifest } = await extractBackup(file, { passphrase });
					try {
						if (!manifest.types.includes(kind)) {
							throw new BackupError("wrong-kind", "The file holds no items of this page");
						}
						const entry = { stageDir, file: null, manifest, owner: userId, kind };
						const { plan } = await buildPlan({ entry, scope: pageScope(access, userId) });
						const token = store.createToken(entry);
						return { token, summary, manifest: manifestView(manifest), plan };
					} catch (error) {
						await withoutStage(stageDir);
						throw error;
					}
				});
			} finally {
				await rm(file, { force: true });
			}
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
