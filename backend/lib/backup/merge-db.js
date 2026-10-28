import { freeName } from "./references.js";
import { clientOf, createInserter, key, movedAvatar, SECRET_TYPES, typeData } from "./restore-db.js";
import { coerceRow } from "./rows.js";
import { TABLE as SCHEDULE_TABLE, SCHEDULE_TYPE } from "./schedule-rows.js";
import { ITEM_TYPES } from "./select.js";
import { CATEGORIES, RESTORE_ORDER, TYPES } from "./types.js";

// The merge apply in the database: writes a merge plan (merge-plan.js) in one transaction. Added rows get new ids,
// replaced rows keep the instance row's id, and every link is mapped to the added or matching row or cleared. Nothing
// on the instance is deleted, except the child rows of a replaced host or user, which the backup's replace. Files are
// placed elsewhere.

const HOST_TYPES = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams"];
const LINK_TYPES = ["dns_credentials", "certificates", "access_lists"];
// the setting row types; backup schedules are their own rows
const SETTINGS_TYPES = new Set(
	CATEGORIES.find(({ id }) => id === "settings").types.filter((typeId) => typeId !== SCHEDULE_TYPE),
);
const LINK_TABLE = "npmpro_proxy_host_access_list";
const LOCATION_TABLE = "npmpro_location";
// the actions each kind of item can have
const ROW_ACTIONS = {
	users: new Set(["add", "replace", "existing", "skip"]),
	link: new Set(["add", "existing", "skip"]),
	host: new Set(["add", "replace", "skip"]),
	setting: new Set(["take", "keep"]),
	schedule: new Set(["add", "keep", "take"]),
};
// the sealed meta key a setting row keeps from the instance when the backup has no secrets
const SECRET_SETTING_KEYS = { oidc: "client_secret", geoip: "license_key" };
// the table each link column points to, and the value for "none" (null: the link row is not written)
const LINKS = {
	certificate_id: ["certificate", 0],
	npmpro_mtls_certificate_id: ["certificate", 0],
	access_list_id: ["access_list", 0],
	npmpro_dns_credential_id: ["npmpro_dns_credential", null],
	[`${LINK_TABLE}.access_list_id`]: ["access_list", null],
};
const HOST_LINKS = ["certificate_id", "npmpro_mtls_certificate_id", "access_list_id"];

const parseJson = (value) => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

const lower = (value) => String(value ?? "").toLowerCase();
const isLink = (value) => Number(value) > 0;

const kindOf = (typeId) => {
	if (typeId === SCHEDULE_TYPE) return "schedule";
	if (typeId === "users") return "users";
	if (LINK_TYPES.includes(typeId)) return "link";
	return HOST_TYPES.includes(typeId) ? "host" : "setting";
};

// the setting ids a settings type holds, read from its where clause
const settingIdsOf = (knex, typeId) => {
	const query = knex("setting");
	for (const { where } of TYPES[typeId].tables) where?.(query);
	return new Set(query.toSQL().bindings.map(String));
};

const knownItem = (item) => {
	if (!Object.hasOwn(TYPES, item.type)) return false;
	if (item.type === SCHEDULE_TYPE) return String(item.key).startsWith("schedule:");
	return Object.hasOwn(ITEM_TYPES, item.type)
		? !String(item.key).startsWith("setting:")
		: SETTINGS_TYPES.has(item.type) && String(item.key).startsWith("setting:");
};

// the plan's row, setting and schedule items in RESTORE_ORDER; file items are placed elsewhere
const checkedItems = (plan) => {
	const items = (plan?.items ?? []).filter((item) => !String(item.key).startsWith("file:"));
	for (const item of items) {
		if (!knownItem(item))
			throw new Error(`The merge plan holds an item of the unknown type ${item.type} (${item.key})`);
		if (!ROW_ACTIONS[kindOf(item.type)].has(item.action)) {
			throw new Error(`The merge plan holds the action ${item.action} for ${item.key}`);
		}
		if (
			(item.action === "replace" || item.action === "existing") &&
			(!item.target || item.target.type !== item.type)
		)
			throw new Error(`${item.key} has no target of its type`);
	}
	return RESTORE_ORDER.flatMap((typeId) => items.filter((item) => item.type === typeId));
};

/**
 * Writes a merge plan into the database in one transaction; any error rolls everything back.
 *
 * @param   {Object}    options
 * @param   {Object}    options.knex
 * @param   {Object}    options.data          loadStageData() of the merged types, plus users when the file has them
 * @param   {Object}    options.plan          planMerge() result
 * @param   {number}    options.adminUserId   the restoring admin, never replaced
 * @param   {number}    options.importerId    owner of rows whose owner cannot be found
 * @param   {boolean}   [options.page]        a page import: every written row is owned by the importer
 * @param   {Object}    options.box           the secret box that seals the secrets
 * @param   {boolean}   options.secrets       whether the backup holds secrets
 * @param   {number}    [options.now]         seconds, npmpro_token_valid_after of added and replaced users
 * @returns {Promise<{ counts: Object, maps: { [table]: Map<string, number> }, certificateMoves: Array<{ from, to }>,
 *                     replacedUserIds: number[], avatarMoves: Array<{ from, to }>, cleared: number }>}
 *          maps: String(backup id) -> instance id per table, for added, replaced and matched rows (and the locations
 *          of written proxy hosts); certificateMoves: backup id -> new id of added certificates; avatarMoves: backup
 *          id -> instance id of every added or replaced user, whose avatar path now names the instance id; cleared:
 *          links whose target is neither imported nor matched
 */
const mergeTypes = async ({
	knex,
	data,
	plan,
	adminUserId,
	importerId,
	page = false,
	box,
	secrets,
	now = Math.floor(Date.now() / 1000),
}) => {
	const items = checkedItems(plan);
	const types = [...new Set(items.map((item) => item.type))];
	const prepared = Object.fromEntries(types.map((typeId) => [typeId, typeData(data, typeId)]));
	const backupUsers = Array.isArray(data?.users?.user) ? data.users.user : [];
	const rowOf = (item) => {
		let table = "setting";
		if (Object.hasOwn(ITEM_TYPES, item.type)) ({ table } = ITEM_TYPES[item.type]);
		else if (item.type === SCHEDULE_TYPE) table = SCHEDULE_TABLE;
		const row = prepared[item.type][table].find((other) => key(other.id) === key(item.id));
		if (!row) throw new Error(`The backup has no row for ${item.key}`);
		return row;
	};

	return await knex.transaction(async (trx) => {
		const inserter = createInserter(trx);
		const client = clientOf(trx);
		const columnsCache = new Map();
		const columnsOf = async (table) => {
			if (!columnsCache.has(table))
				columnsCache.set(table, { ...(await trx(table).columnInfo()), __client: client });
			return columnsCache.get(table);
		};
		const maps = Object.fromEntries(
			[...Object.values(ITEM_TYPES).map(({ table }) => table), LOCATION_TABLE].map((table) => [table, new Map()]),
		);
		const counts = {};
		const count = (typeId) => {
			counts[typeId] = (counts[typeId] ?? 0) + 1;
		};
		const certificateMoves = [];
		const replacedUserIds = [];
		const avatarMoves = [];
		const cleared = new Set();

		// the instance users by email, read before any user is written
		const instanceByEmail = new Map();
		for (const user of await trx("user").select("id", "email").orderBy("id")) {
			if (!instanceByEmail.has(lower(user.email))) instanceByEmail.set(lower(user.email), user.id);
		}
		const ownerOf = (backupOwner) => {
			if (page) return importerId;
			const mapped = maps.user.get(key(backupOwner));
			if (mapped !== undefined) return mapped;
			const user = backupUsers.find((row) => key(row.id) === key(backupOwner));
			return (user && instanceByEmail.get(lower(user.email))) ?? importerId;
		};
		// a link of the item's row: the target's instance id, or "none" (counted as cleared) when the target is not there
		const mapLink = (item, column, value) => {
			const [table, empty] = LINKS[column];
			if (!isLink(value)) return empty;
			const mapped = maps[table].get(key(value));
			if (mapped !== undefined) return mapped;
			cleared.add(`${item.key}\n${column}\n${key(value)}`);
			return empty;
		};

		// writes the backup row over the instance row: its id and created_on stay
		const updateRow = async (table, id, row) => {
			const columns = await columnsOf(table);
			const { id: _id, created_on: _created, ...rest } = row;
			const values = coerceRow(columns, table, rest);
			if (Object.hasOwn(columns, "modified_on")) values.modified_on = trx.fn.now();
			await trx(table).where({ id }).update(values);
		};

		const writeUser = async (item) => {
			const row = { ...rowOf(item), npmpro_token_valid_after: now };
			let userId;
			if (item.action === "add") {
				userId = await inserter.insertWithNewId("user", row);
				const avatar = movedAvatar(row.avatar, item.id, userId);
				if (avatar !== null) await trx("user").where({ id: userId }).update({ avatar });
			} else {
				userId = item.target.id;
				if (key(userId) === key(adminUserId)) throw new Error("A merge never replaces the restoring admin");
				const avatar = movedAvatar(row.avatar, item.id, userId);
				await updateRow("user", userId, avatar === null ? row : { ...row, avatar });
				for (const table of ["auth", "user_permission"]) await trx(table).where({ user_id: userId }).del();
				replacedUserIds.push(userId);
			}
			maps.user.set(key(item.id), userId);
			avatarMoves.push({ from: item.id, to: userId });
			const own = (rows) => (rows ?? []).filter((child) => key(child.user_id) === key(item.id));
			const { auth } = TYPES.users.secrets.seal({ auth: own(prepared.users.auth) }, box);
			for (const child of auth) await inserter.insertWithNewId("auth", { ...child, user_id: userId });
			for (const child of own(prepared.users.user_permission)) {
				await inserter.insertWithNewId("user_permission", { ...child, user_id: userId });
			}
		};

		// the DNS credential names each owner holds, lower case
		const credentialNames = new Map();
		const namesOf = async (ownerId) => {
			if (!credentialNames.has(key(ownerId))) {
				const names = await trx("npmpro_dns_credential").where({ owner_user_id: ownerId }).pluck("name");
				credentialNames.set(key(ownerId), new Set(names.map(lower)));
			}
			return credentialNames.get(key(ownerId));
		};

		const addCredential = async (row) => {
			const owner = ownerOf(row.owner_user_id);
			const taken = await namesOf(owner);
			const name = freeName(row.name, taken);
			taken.add(lower(name));
			const values = secrets ? (parseJson(row.values) ?? {}) : {};
			const [sealed] = TYPES.dns_credentials.secrets.seal(
				{ npmpro_dns_credential: [{ ...row, owner_user_id: owner, name, values }] },
				box,
			).npmpro_dns_credential;
			return await inserter.insertWithNewId("npmpro_dns_credential", sealed);
		};

		const addCertificate = async (row, item) => {
			const credentialId = row.npmpro_dns_credential_id;
			const newId = await inserter.insertWithNewId("certificate", {
				...row,
				owner_user_id: ownerOf(row.owner_user_id),
				npmpro_dns_credential_id:
					credentialId === null || credentialId === undefined
						? null
						: mapLink(item, "npmpro_dns_credential_id", credentialId),
			});
			certificateMoves.push({ from: row.id, to: newId });
			return newId;
		};

		const addAccessList = async (row) => {
			const newId = await inserter.insertWithNewId("access_list", {
				...row,
				owner_user_id: ownerOf(row.owner_user_id),
			});
			for (const [table, column] of ITEM_TYPES.access_lists.children) {
				for (const child of prepared.access_lists[table].filter(
					(other) => key(other[column]) === key(row.id),
				)) {
					const blank = table === "access_list_auth" && !secrets ? { password: "" } : {};
					await inserter.insertWithNewId(table, { ...child, ...blank, [column]: newId });
				}
			}
			return newId;
		};

		const addLinked = { dns_credentials: addCredential, certificates: addCertificate, access_lists: addAccessList };

		const writeLinked = async (item) => {
			const { table } = ITEM_TYPES[item.type];
			if (item.action === "skip") return;
			if (item.action === "existing") {
				maps[table].set(key(item.id), item.target.id);
				return;
			}
			maps[table].set(key(item.id), await addLinked[item.type](rowOf(item), item));
			count(item.type);
		};

		// a proxy host's locations and access list links, under its instance id
		const writeProxyChildren = async (item, hostId) => {
			const locations = new Map();
			for (const location of prepared.proxy_hosts[LOCATION_TABLE].filter(
				(other) => key(other.proxy_host_id) === key(item.id),
			)) {
				const locationId = await inserter.insertWithNewId(LOCATION_TABLE, {
					...location,
					proxy_host_id: hostId,
				});
				locations.set(key(location.id), locationId);
				maps[LOCATION_TABLE].set(key(location.id), locationId);
			}
			const links = new Map();
			for (const link of prepared.proxy_hosts[LINK_TABLE].filter(
				(other) => key(other.proxy_host_id) === key(item.id),
			)) {
				const accessListId = mapLink(item, `${LINK_TABLE}.access_list_id`, link.access_list_id);
				const locationId = isLink(link.location_id) ? locations.get(key(link.location_id)) : 0;
				if (accessListId === null || locationId === undefined) continue;
				const row = { ...link, proxy_host_id: hostId, location_id: locationId, access_list_id: accessListId };
				links.set(`${locationId}\n${accessListId}`, row);
			}
			await inserter.insert(LINK_TABLE, [...links.values()]);
		};

		const writeHost = async (item) => {
			if (item.action === "skip") return;
			const { table } = ITEM_TYPES[item.type];
			const source = rowOf(item);
			const row = {
				...source,
				owner_user_id: ownerOf(source.owner_user_id),
				npmpro_nginx_online: 1,
				npmpro_nginx_err: "",
			};
			for (const column of HOST_LINKS) row[column] = mapLink(item, column, source[column]);
			let hostId;
			if (item.action === "add") {
				hostId = await inserter.insertWithNewId(table, row);
			} else {
				hostId = item.target.id;
				// a replaced host stays with its owner
				const target = await trx(table).where({ id: hostId }).first("owner_user_id");
				if (target) row.owner_user_id = target.owner_user_id;
				await updateRow(table, hostId, row);
				if (item.type === "proxy_hosts") {
					await trx(LINK_TABLE).where({ proxy_host_id: hostId }).del();
					await trx(LOCATION_TABLE).where({ proxy_host_id: hostId }).del();
				}
			}
			maps[table].set(key(item.id), hostId);
			if (item.type === "proxy_hosts") await writeProxyChildren(item, hostId);
			count(item.type);
		};

		const settingIds = new Map();
		const writeSetting = async (item) => {
			if (item.action === "keep") return;
			if (!settingIds.has(item.type)) settingIds.set(item.type, settingIdsOf(trx, item.type));
			if (!settingIds.get(item.type).has(key(item.id))) {
				throw new Error(`The setting ${item.id} does not belong to ${item.type}`);
			}
			const source = rowOf(item);
			const [sealed] = TYPES[item.type].secrets.seal(
				{ setting: [{ ...source, meta: parseJson(source.meta) ?? {} }] },
				box,
			).setting;
			const current = await trx("setting").where({ id: source.id }).first();
			if (!current) {
				await inserter.insert("setting", [sealed]);
				count(item.type);
				return;
			}
			const meta = { ...sealed.meta };
			const secretKey = SECRET_SETTING_KEYS[key(source.id)];
			const currentMeta = parseJson(current.meta);
			if (
				!secrets &&
				SECRET_TYPES.has(item.type) &&
				secretKey &&
				currentMeta &&
				typeof currentMeta === "object" &&
				Object.hasOwn(currentMeta, secretKey)
			) {
				meta[secretKey] = currentMeta[secretKey];
			}
			const columns = await columnsOf("setting");
			const values = coerceRow(columns, "setting", {
				meta,
				...(Object.hasOwn(sealed, "value") ? { value: sealed.value } : {}),
			});
			await trx("setting").where({ id: source.id }).update(values);
			count(item.type);
		};

		// a schedule is added under a new id or written over the instance's schedule of the same name; without secrets
		// a taken passphrase schedule keeps the instance's sealed passphrase (other protections hold none)
		const writeSchedule = async (item) => {
			if (item.action === "keep") return;
			const source = rowOf(item);
			const current =
				item.action === "take" ? await trx(SCHEDULE_TABLE).where({ id: item.target.id }).first() : null;
			if (item.action === "take" && !current) throw new Error(`${item.key} has no schedule to take over`);
			const passphrase = secrets
				? source.passphrase
				: source.protection === "passphrase"
					? (current?.passphrase ?? null)
					: null;
			const [prepared] = TYPES[SCHEDULE_TYPE].restoreRows(
				TYPES[SCHEDULE_TYPE].secrets.seal({ [SCHEDULE_TABLE]: [{ ...source, passphrase }] }, box),
				{ adminUserId, nowMs: now * 1000 },
			)[SCHEDULE_TABLE];
			if (item.action === "add") {
				await inserter.insertWithNewId(SCHEDULE_TABLE, prepared);
			} else {
				// a replaced schedule stays with its owner and keeps its id
				await updateRow(SCHEDULE_TABLE, item.target.id, { ...prepared, owner_user_id: current.owner_user_id });
			}
			count(item.type);
		};

		for (const item of items) {
			const kind = kindOf(item.type);
			if (kind === "users") {
				if (item.action === "existing") maps.user.set(key(item.id), item.target.id);
				else if (item.action !== "skip") {
					await writeUser(item);
					count(item.type);
				}
			} else if (kind === "link") await writeLinked(item);
			else if (kind === "host") await writeHost(item);
			else if (kind === "schedule") await writeSchedule(item);
			else await writeSetting(item);
		}
		return { counts, maps, certificateMoves, replacedUserIds, avatarMoves, cleared: cleared.size };
	});
};

export { mergeTypes };
