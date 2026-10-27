import { rm } from "node:fs/promises";
import { BackupError, readHeader } from "../lib/backup/format.js";
import { ITEM_TYPES, itemLabel, linkedOf } from "../lib/backup/select.js";
import { CATEGORIES } from "../lib/backup/types.js";
import errs from "../lib/error.js";

// Export and import of single items on the list pages (proxy hosts, certificates, ...). The files are partial backups;
// an import is merged through the backup service's plan and apply (internal/backup.js).

const MAX_IMPORT = 200 * 1024 ** 2;
const ALL_TYPES = CATEGORIES.flatMap((category) => category.types);

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

// a page import: the importer's permissions limit what is added, replaced and matched
const pageScope = (access, importerId) => {
	const canManage = (typeId) => allows(access, typeId, "manage");
	const all = access.visibility === "all";
	return {
		adminUserId: importerId,
		importerId,
		page: true,
		isAdmin: access.isAdmin === true,
		canView: (typeId) => allows(access, typeId, "view"),
		canManage,
		canEdit: (table, row) =>
			canManage(TYPE_OF_ITEM_TABLE[table]) && (all || String(row.owner_user_id) === String(importerId)),
		visibleOwnerId: all ? null : importerId,
	};
};

const compareText = (a, b) => (a < b ? -1 : Number(a > b));

/**
 * @param   {Object}    deps                  from createBackupService
 * @param   {Object}    deps.knex
 * @param   {Object}    deps.store
 * @param   {Function}  deps.extractBackup    (file, { passphrase }) => { stageDir, summary, manifest }
 * @param   {Function}  deps.writeBackup      ({ file, types, secrets, mode, passphrase, userId, items })
 * @param   {Function}  deps.buildPlan        ({ entry, scope, types, items, choices }) => { plan }
 * @param   {Function}  deps.receive          (readable, file, max, message) => bytes
 * @param   {Function}  deps.checkPassphrase
 * @param   {Function}  deps.manifestView
 * @param   {Function}  deps.withoutStage
 * @param   {Function}  deps.audit
 * @param   {string}    deps.hostname
 * @param   {Object}    deps.clock
 * @param   {Object}    deps.log
 * @param   {number}    [deps.maxImport]      bytes, 200 MB
 */
const createBackupPages = ({
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
	maxImport = MAX_IMPORT,
}) => {
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
				const keys = [...neededBy.get(String(row.id))].sort(compareText);
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

	return {
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
			const exported = await store.withLock(async () => {
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
					return {
						pending: await store.addPending(file, { owner: userId }),
						name: store.exportName({ kind, host: hostname, date: new Date(clock.now()) }),
					};
				} catch (error) {
					await rm(file, { force: true });
					throw error;
				}
			});
			try {
				await audit(access, {
					action: "exported",
					object_type: PAGE_KINDS[kind].objectType,
					object_id: 0,
					meta: {
						name: exported.name,
						counts: Object.fromEntries(types.map((typeId) => [typeId, items[typeId].length])),
						secrets: Boolean(secrets),
					},
				});
			} catch (error) {
				// the export itself succeeded
				log.error(`Could not write the audit log entry of the export: ${error.message}`);
			}
			return exported;
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
				await receive(readable, temp, maxImport, "The file is larger than 200 MB");
				const { header } = await readHeader(temp);
				// sealed with the key of the instance that made it
				if (header.kdf === "instance") {
					throw new BackupError(
						"not-importable",
						"Automatic backups can only be restored in Settings on the instance that made them",
					);
				}
				const id = await store.addPending(temp, { owner: access.token.getUserId(0), kind });
				return { id, summary: header.summary ?? null, encrypted: header.kdf === "scrypt" };
			} finally {
				await rm(temp, { force: true });
			}
		},

		/**
		 * Unpacks an uploaded page import into a restore session of the user and its kind, with the plan of a merge
		 * with the default choices. A wrong or missing passphrase keeps the upload for another try; anything else
		 * uses it up.
		 *
		 * @returns {Promise<{ token: string, summary: Object, manifest: Object, plan: Object }>}
		 */
		importOpen: async (access, id, { passphrase } = {}) => {
			const userId = access.token.getUserId(0);
			const { kind } = store.peekPending(id, { owner: userId });
			// a pending download is no import
			if (!kind) throw Object.assign(new BackupError("token-expired", "The upload has expired"), { status: 410 });
			access.can(`${permissionOf(kind)}:manage`);
			return await store.withLock(async () => {
				const { file } = store.peekPending(id, { owner: userId });
				const consume = async () => {
					store.takePending(id, { owner: userId });
					await rm(file, { force: true });
				};
				let extracted;
				try {
					extracted = await extractBackup(file, { passphrase });
				} catch (error) {
					if (error.code !== "wrong-passphrase") await consume();
					throw error;
				}
				await consume();
				const { stageDir, summary, manifest } = extracted;
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
		},
	};
};

export { createBackupPages, LINKED_KINDS, PAGE_KINDS, pageScope, permissionOf };
