import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { BackupError } from "../lib/backup/format.js";
import { checkAdminOnly, checkItemValues } from "../lib/backup/import-checks.js";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { placeMergedFiles } from "../lib/backup/merge-files.js";
import { planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { checkStagedRenewals } from "../lib/backup/renewal-conf.js";
import { loadStageData } from "../lib/backup/restore-db.js";
import { relinkCertbotLive } from "../lib/backup/restore-files.js";
import { RESTORE_ORDER, TYPES } from "../lib/backup/types.js";
import { LINKED_KINDS, PAGE_KINDS, pageScope, permissionOf } from "./backup-pages.js";
import { chosenTypes, exists, withoutStage } from "./backup-shared.js";

const FILES_PREFIX = "files/";
const FILE_KEY = "file:";

// the file types whose instance files a merge compares, and those placed file by file
const MERGE_FILE_TYPES = ["settings_default_site", "custom_nginx", "crowdsec_files"];
const CUSTOM_FILE_TYPES = ["custom_nginx", "crowdsec_files"];
const WRITTEN = new Set(["add", "replace", "take"]);

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

// the sha256 of the regular files below rel that allow takes, into out by path relative to base
const hashFiles = async (base, rel, allow, out) => {
	const info = await exists(path.join(base, rel));
	if (!(info && allow(rel))) return;
	if (info.isFile()) out[rel] = await sha256(path.join(base, rel));
	if (!info.isDirectory()) return;
	for (const name of await readdir(path.join(base, rel))) await hashFiles(base, `${rel}/${name}`, allow, out);
};

// the merge of a backup's items into the instance: session, plan and apply
const createMerge = (
	{ knex, box, dataDir, store, renewals, dnsCredentials, exclusive, clock },
	{ needsRestart, applyWithRollback },
) => {
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
	return { openSession, buildPlan, mergeRestore };
};

export { createMerge };
