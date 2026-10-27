import { readFile } from "node:fs/promises";
import path from "node:path";
import { BackupError } from "./format.js";
import { applyReferences, planReferences } from "./references.js";
import { coerceRow } from "./rows.js";
import { RESTORE_ORDER, TYPES } from "./types.js";

// Replace restore of the database rows: the chosen types' rows are deleted and the backup's rows inserted with their
// ids, in one transaction. The restoring admin's user, auth and user_permission rows are never touched.

const PG_CLIENTS = new Set(["pg", "postgres", "postgresql"]);
const CHUNK = 200;
const HOST_TABLES = ["proxy_host", "redirection_host", "dead_host", "stream"];
// what planReferences reads; a table it is not given counts as empty, so it always gets all of them
const REFERENCE_TABLES = [
	"user",
	"certificate",
	"access_list",
	"npmpro_dns_credential",
	...HOST_TABLES,
	"npmpro_proxy_host_access_list",
];
const REFERENCE_COLUMNS = [
	"id",
	"email",
	"name",
	"nice_name",
	"domain_names",
	"owner_user_id",
	"certificate_id",
	"npmpro_mtls_certificate_id",
	"npmpro_dns_credential_id",
	"proxy_host_id",
	"location_id",
	"access_list_id",
];
// tables without an integer id sequence
const NO_SEQUENCE = new Set(["setting", "npmpro_proxy_host_access_list"]);
// types with values a backup without secrets leaves out
const SECRET_TYPES = new Set([
	"certificates",
	"access_lists",
	"dns_credentials",
	"users",
	"settings_oidc",
	"settings_monitoring",
	"crowdsec_files",
]);
// the type each whole table belongs to (the setting table is shared, by row id)
const TYPE_OF_TABLE = Object.fromEntries(
	Object.entries(TYPES).flatMap(([typeId, type]) =>
		type.tables.filter(({ where }) => !where).map(({ table }) => [table, typeId]),
	),
);
// stands for the id a backup user gets when its own id is the admin's; only used by the preview
const NEW_USER_ID = "new";

// ids can be numbers or strings (JSON, bigint columns)
const key = (value) => String(value);

const isPlainObject = (value) =>
	value !== null &&
	typeof value === "object" &&
	!Array.isArray(value) &&
	[Object.prototype, null].includes(Object.getPrototypeOf(value));

const invalid = (reason) => new BackupError("invalid-archive", reason);

const typeOf = (typeId) => {
	if (!Object.hasOwn(TYPES, typeId)) throw invalid(`Unknown type ${typeId}`);
	return TYPES[typeId];
};

const clientOf = (knex) => {
	const client = String(knex.client?.config?.client ?? "");
	return PG_CLIENTS.has(client) ? "pg" : client;
};

/**
 * The query that moves a Postgres id sequence past the table's highest id, or null when there is nothing to do.
 *
 * @param   {import("knex").Knex}  knex
 * @param   {string}               table
 * @returns {import("knex").Knex.Raw|null}
 */
const sequenceResetQuery = (knex, table) =>
	clientOf(knex) === "pg" && !NO_SEQUENCE.has(table)
		? knex.raw("select setval(pg_get_serial_sequence(?, 'id'), coalesce((select max(id) from ??), 0) + 1, false)", [
				`"${table}"`,
				table,
			])
		: null;

// the type's rows as { [table]: rows }: only its tables, each an array of plain objects
const checkTypeData = (typeId, parsed) => {
	const tables = typeOf(typeId).tables.map(({ table }) => table);
	if (!isPlainObject(parsed)) throw invalid(`data/${typeId}.json is not an object`);
	for (const table of Object.keys(parsed)) {
		if (!tables.includes(table)) throw invalid(`data/${typeId}.json holds the table ${table}`);
	}
	const out = {};
	for (const table of tables) {
		const rows = parsed[table] ?? [];
		if (!(Array.isArray(rows) && rows.every(isPlainObject)))
			throw invalid(`data/${typeId}.json: ${table} is invalid`);
		out[table] = rows;
	}
	return out;
};

/**
 * Reads data/<type>.json of the chosen types that have tables.
 *
 * @param   {string}    stageDir
 * @param   {string[]}  types
 * @returns {Promise<Object<string, Object<string, Object[]>>>}  rejects with BackupError("invalid-archive")
 */
const loadStageData = async (stageDir, types) => {
	const data = {};
	for (const typeId of types) {
		if (typeOf(typeId).tables.length === 0) continue;
		let parsed;
		try {
			parsed = JSON.parse(await readFile(path.join(stageDir, "data", `${typeId}.json`), "utf8"));
		} catch (error) {
			throw new BackupError("invalid-archive", `data/${typeId}.json cannot be read`, { cause: error });
		}
		data[typeId] = checkTypeData(typeId, parsed);
	}
	return data;
};

// the rows of a table planReferences needs, only the id and reference columns
const readReferenceRows = async (knex, table) => {
	const present = Object.keys(await knex(table).columnInfo());
	const columns = REFERENCE_COLUMNS.filter((column) => present.includes(column));
	if (columns.length === 0) return [];
	return (await knex(table).select(columns)).map((row) => {
		if (typeof row.domain_names !== "string") return row;
		try {
			return { ...row, domain_names: JSON.parse(row.domain_names) };
		} catch {
			return row;
		}
	});
};

const typeData = (data, typeId) => {
	if (!isPlainObject(data?.[typeId])) throw invalid(`No data for ${typeId}`);
	return checkTypeData(typeId, data[typeId]);
};

/**
 * Sorts the backup's users: skipped (the admin's email, case-insensitive), moved (the admin's id with another email:
 * gets a new id) and the others. idMap sends a skipped user's id to the admin.
 */
const splitUsers = (rows, admin) => {
	const adminEmail = String(admin.email ?? "").toLowerCase();
	const out = { users: [], moved: null, skipped: [], idMap: new Map() };
	for (const row of rows) {
		if (String(row.email ?? "").toLowerCase() === adminEmail) {
			out.skipped.push({ id: row.id, email: row.email, name: row.name });
			out.idMap.set(key(row.id), admin.id);
		} else if (key(row.id) === key(admin.id)) out.moved = row;
		else out.users.push(row);
	}
	return out;
};

// auth and user_permission rows of the restored users only, user_id mapped
const userRows = (rows, restoredIds, idMap) =>
	rows
		.filter((row) => restoredIds.has(key(row.user_id)))
		.map((row) => (idMap.has(key(row.user_id)) ? { ...row, user_id: idMap.get(key(row.user_id)) } : row));

// owner_user_id of every row mapped through idMap
const remapOwners = (rowsByTable, idMap) =>
	idMap.size === 0
		? rowsByTable
		: Object.fromEntries(
				Object.entries(rowsByTable).map(([table, rows]) => [
					table,
					rows.map((row) =>
						Object.hasOwn(row, "owner_user_id") && idMap.has(key(row.owner_user_id))
							? { ...row, owner_user_id: idMap.get(key(row.owner_user_id)) }
							: row,
					),
				]),
			);

const findAdmin = async (knex, adminUserId) => {
	const admin = await knex("user").where({ id: adminUserId }).first();
	if (!admin) throw new Error(`The restoring admin #${adminUserId} does not exist`);
	return admin;
};

/**
 * What a replace of the chosen types would change, without writing anything.
 *
 * @param   {Object}    options
 * @param   {Object}    options.knex
 * @param   {Object}    options.data          loadStageData() of the chosen types
 * @param   {string[]}  options.types
 * @param   {number}    options.adminUserId
 * @param   {boolean}   [options.secrets]     whether the backup holds secrets (its manifest)
 * @returns {Promise<{ references: Array, skippedUsers: Array, missingSecrets: string[] }>}
 */
const previewReplace = async ({ knex, data, types, adminUserId, secrets = true }) => {
	const chosen = RESTORE_ORDER.filter((typeId) => types.includes(typeId));
	for (const typeId of types) typeOf(typeId);
	const finalRows = {};
	for (const table of REFERENCE_TABLES) {
		finalRows[table] = chosen.includes(TYPE_OF_TABLE[table]) ? [] : await readReferenceRows(knex, table);
	}
	let idMap = new Map();
	let skippedUsers = [];
	if (chosen.includes("users")) {
		const admin = await findAdmin(knex, adminUserId);
		const split = splitUsers(typeData(data, "users").user, admin);
		if (split.moved) split.idMap.set(key(split.moved.id), NEW_USER_ID);
		finalRows.user = [admin, ...split.users, ...(split.moved ? [{ ...split.moved, id: NEW_USER_ID }] : [])];
		({ idMap } = split);
		skippedUsers = split.skipped;
	}
	for (const typeId of chosen) {
		if (typeId === "users" || typeOf(typeId).tables.length === 0) continue;
		const rowsByTable = remapOwners(typeData(data, typeId), idMap);
		for (const [table, rows] of Object.entries(rowsByTable)) {
			if (REFERENCE_TABLES.includes(table)) finalRows[table] = rows;
		}
	}
	return {
		references: planReferences({ finalRows, adminUserId }),
		skippedUsers,
		missingSecrets: secrets ? [] : chosen.filter((typeId) => SECRET_TYPES.has(typeId)),
	};
};

const createInserter = (trx) => {
	const client = clientOf(trx);
	const columnsCache = new Map();
	const touched = new Set();
	const columnsOf = async (table) => {
		if (!columnsCache.has(table)) columnsCache.set(table, { ...(await trx(table).columnInfo()), __client: client });
		return columnsCache.get(table);
	};
	const resetSequence = async (table) => {
		const query = sequenceResetQuery(trx, table);
		if (query) await query;
	};
	return {
		touched,
		resetSequence,
		// rows with their ids, in chunks
		insert: async (table, rows) => {
			if (rows.length === 0) return;
			const columns = await columnsOf(table);
			await trx.batchInsert(
				table,
				rows.map((row) => coerceRow(columns, table, row)),
				CHUNK,
			);
			touched.add(table);
		},
		// one row without its id; resolves to the id it got
		insertWithNewId: async (table, row) => {
			const { id: _old, ...rest } = row;
			const columns = await columnsOf(table);
			await resetSequence(table);
			const query = trx(table).insert(coerceRow(columns, table, rest));
			const [result] = await (client === "pg" ? query.returning("id") : query);
			touched.add(table);
			return result !== null && typeof result === "object" ? result.id : result;
		},
	};
};

const deleteType = async (trx, typeId, adminUserId) => {
	for (const { table, where } of [...typeOf(typeId).tables].reverse()) {
		const query = trx(table);
		if (typeId === "users") query.whereNot(table === "user" ? "id" : "user_id", adminUserId);
		if (where) where(query);
		await query.del();
	}
};

// the rows just inserted into a shared table must all be rows of the type
const checkTypeRows = async (trx, table, where, rows) => {
	const ids = rows.map((row) => row.id);
	if (ids.length === 0) return;
	const query = trx(table).whereIn("id", ids);
	where(query);
	const [{ count }] = await query.count({ count: "*" });
	if (Number(count) !== ids.length) throw invalid(`The backup holds ${table} rows of another type`);
};

// a moved user's avatar that names the picture file by the old id names it by the new one
const movedAvatar = (avatar, from, to) => {
	if (typeof avatar !== "string") return null;
	for (const folder of ["/images/avatar/", "/images/gravatar/"]) {
		if (avatar.startsWith(`${folder}${from}.`)) return `${folder}${to}${avatar.slice(`${folder}${from}`.length)}`;
	}
	return null;
};

const insertUsers = async ({ trx, inserter, rowsByTable, adminUserId, now }) => {
	const admin = await findAdmin(trx, adminUserId);
	const split = splitUsers(rowsByTable.user, admin);
	const stamp = now === null ? (row) => row : (row) => ({ ...row, npmpro_token_valid_after: now });
	await inserter.insert("user", split.users.map(stamp));
	let moved = null;
	if (split.moved) {
		moved = { from: split.moved.id, to: await inserter.insertWithNewId("user", stamp(split.moved)) };
		split.idMap.set(key(moved.from), moved.to);
		const avatar = movedAvatar(split.moved.avatar, moved.from, moved.to);
		if (avatar !== null) await trx("user").where({ id: moved.to }).update({ avatar });
	}
	const restoredIds = new Set([...split.users, ...(split.moved ? [split.moved] : [])].map((row) => key(row.id)));
	for (const table of ["auth", "user_permission"]) {
		// the admin's rows stay: a backup row with one of their ids gets a new id
		const keptIds = new Set((await trx(table).where({ user_id: adminUserId }).pluck("id")).map(key));
		const rows = userRows(rowsByTable[table], restoredIds, split.idMap);
		await inserter.insert(
			table,
			rows.filter((row) => !keptIds.has(key(row.id))),
		);
		for (const row of rows.filter((item) => keptIds.has(key(item.id)))) await inserter.insertWithNewId(table, row);
	}
	return {
		idMap: split.idMap,
		skipped: split.skipped,
		count: restoredIds.size,
		users: {
			ids: [...split.users.map((row) => row.id), ...(moved ? [moved.to] : [])],
			moved,
			skippedIds: split.skipped.map((row) => row.id),
		},
	};
};

/**
 * Replaces the chosen types' rows with the backup's in one transaction, then clears references to rows that do not
 * exist afterwards. Any error rolls everything back.
 *
 * @param   {Object}    options
 * @param   {Object}    options.knex
 * @param   {Object}    options.data          loadStageData() of the chosen types
 * @param   {string[]}  options.types
 * @param   {number}    options.adminUserId   the restoring admin, kept as they are
 * @param   {Object}    options.box           the secret box that seals the secrets
 * @param   {?number}   [options.now]         seconds, npmpro_token_valid_after of the restored users; null keeps
 *                                            the backup's values (the rollback to the automatic backup)
 * @returns {Promise<{ references: Array, skippedUsers: Array, counts: Object<string, number>, users: ?Object }>}
 *          users, when users were restored: { ids: the restored users' ids, moved: { from, to } of the backup user
 *          that held the admin's id or null, skippedIds: the backup ids of the skipped users }
 */
const replaceTypes = async ({ knex, data, types, adminUserId, box, now = Math.floor(Date.now() / 1000) }) => {
	for (const typeId of types) typeOf(typeId);
	const chosen = RESTORE_ORDER.filter((typeId) => types.includes(typeId) && TYPES[typeId].tables.length > 0);
	const prepared = Object.fromEntries(chosen.map((typeId) => [typeId, typeData(data, typeId)]));
	return await knex.transaction(async (trx) => {
		const inserter = createInserter(trx);
		const counts = {};
		let idMap = new Map();
		let skippedUsers = [];
		let users = null;
		for (const typeId of chosen) {
			const type = TYPES[typeId];
			const rowsByTable = type.secrets.seal(remapOwners(prepared[typeId], idMap), box);
			await deleteType(trx, typeId, adminUserId);
			if (typeId === "users") {
				const result = await insertUsers({ trx, inserter, rowsByTable, adminUserId, now });
				({ idMap } = result);
				skippedUsers = result.skipped;
				counts[typeId] = result.count;
				({ users } = result);
				continue;
			}
			for (const { table, where } of type.tables) {
				await inserter.insert(table, rowsByTable[table]);
				if (where) await checkTypeRows(trx, table, where, rowsByTable[table]);
			}
			counts[typeId] = rowsByTable[type.tables[0].table].length;
		}
		for (const table of inserter.touched) await inserter.resetSequence(table);
		const finalRows = {};
		for (const table of REFERENCE_TABLES) finalRows[table] = await readReferenceRows(trx, table);
		const references = planReferences({ finalRows, adminUserId });
		await applyReferences(trx, references);
		return { references, skippedUsers, counts, users };
	});
};

export {
	clientOf,
	createInserter,
	key,
	loadStageData,
	movedAvatar,
	previewReplace,
	replaceTypes,
	SECRET_TYPES,
	sequenceResetQuery,
	typeData,
};
