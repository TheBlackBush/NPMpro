import { readFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { extractTo } from "../lib/backup/archive.js";
import { verifyStage } from "../lib/backup/export.js";
import { BackupError, FORMAT_VERSION, openBackupFile, readHeader } from "../lib/backup/format.js";
import { loadStageData, replaceTypes } from "../lib/backup/restore-db.js";
import {
	adminAvatarFiles,
	fitStagedAvatars,
	relinkCertbotLive,
	removeCachedGravatars,
	swapFiles,
} from "../lib/backup/restore-files.js";
import { allowFile, RESTORE_ORDER, TYPES } from "../lib/backup/types.js";
import { isRestartRule, rulesOf } from "../lib/runtime-rules.js";
import { invalid, isTypeList, unknownMigrations, withoutStage } from "./backup-shared.js";

// the type each whole table belongs to: a reference fix in one of them changes that type
const TYPE_OF_TABLE = Object.fromEntries(
	Object.entries(TYPES).flatMap(([typeId, type]) =>
		type.tables.filter(({ where }) => !where).map(({ table }) => [table, typeId]),
	),
);

// an instance-key file whose key does not open it was made by another instance
const otherInstance = (header, error) =>
	header.kdf === "instance" && error?.code === "wrong-passphrase"
		? new BackupError("other-instance", "This backup was made with another instance's key", { cause: error })
		: error;

// extracting and checking a backup, and the apply shared by a restore and a merge (rollback included)
const createRestore = (
	{
		knex,
		box,
		dataDir,
		store,
		dbMigrations,
		instanceKey,
		audit,
		nginx,
		regenerate,
		runtime,
		reloadSettings,
		clock,
		log,
	},
	{ automaticBackup, offlineHosts, onlineHosts, refuseTakenOffline },
) => {
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
				if (header.kdf !== "none" && error?.code === "invalid-archive") {
					try {
						await finished((await open()).resume());
					} catch (authError) {
						throw otherInstance(header, authError);
					}
				}
				throw otherInstance(header, error);
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
		await reloadSettings.landingPages?.(types);
		if (types.includes("settings_crowdsec") || types.includes("crowdsec_files")) await reloadSettings.crowdsec?.();
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

	// whether a restored runtime settings row holds a setting that needs a restart
	const needsRestart = (types, data) =>
		types.includes("settings_runtime") &&
		(data.settings_runtime?.setting ?? []).some((row) => {
			const keys = Object.keys(row.meta && typeof row.meta === "object" ? row.meta : {});
			return rulesOf(row.id).some((rule) => isRestartRule(rule) && keys.includes(rule.key));
		});

	/**
	 * The apply of a restore or merge: automatic backup, database step, file step, regenerate, nginx -t and reload; a
	 * failure past the database commit puts the instance back from the automatic backup. Then the cached Gravatar
	 * pictures go, the offline hosts are read and the audit entry is written. customFiles: a host the apply takes
	 * offline fails it. dbStep() is one transaction, fileStep(result, asideDir) returns { undo }.
	 *
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
		if (types.includes("backup_schedules")) {
			// the restored schedules may hold ids of other schedules: they start their retention with their own new
			// files only, earlier scheduled files stay as plain stored backups. Runs under the backup lock, so no
			// scheduled run comes first.
			try {
				await store.detachAllSchedules();
			} catch (error) {
				log.warn(`Could not detach the stored files from their schedules after the restore: ${error.message}`);
			}
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

	return { extractBackup, needsRestart, applyWithRollback, runRestore };
};

export { createRestore };
