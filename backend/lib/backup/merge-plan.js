import { createHash } from "node:crypto";
import { domainsOf, ITEM_TYPES, itemLabel, linkedOf, selectRows } from "./select.js";
import { CATEGORIES, RESTORE_ORDER, TYPES } from "./types.js";

// The merge planner: decides per backup item whether it is added, replaces a matching instance row, is skipped or uses
// the matching row, with the user's choices and the permission limits applied. It is pure and deterministic, so the
// apply can run it again and compare the hash with the plan the user confirmed.

const DOMAIN_HOST_TYPES = ["proxy_hosts", "redirection_hosts", "dead_hosts"];
const HOST_TYPES = [...DOMAIN_HOST_TYPES, "streams"];
const LINK_TYPES = ["certificates", "access_lists", "dns_credentials"];
const SETTINGS_TYPES = CATEGORIES.find(({ id }) => id === "settings").types;
const FILE_TYPES = ["settings_default_site", "custom_nginx", "crowdsec_files"];
const ACTIONS = ["add", "replace", "skip", "existing", "take", "keep"];
// actions that write the backup row, and so carry its links
const ACTIVE = new Set(["add", "replace"]);
// link targets that stay linked: the added row or the matching instance row
const KEPT_TARGETS = new Set(["add", "existing"]);
const MATCH_CHOICES = {
	proxy_hosts: ["skip", "replace"],
	redirection_hosts: ["skip", "replace"],
	dead_hosts: ["skip", "replace"],
	streams: ["skip", "replace"],
	certificates: ["existing", "add"],
	access_lists: ["existing", "add"],
	dns_credentials: ["existing", "add"],
	users: ["existing", "replace"],
};
const SETTING_CHOICES = ["keep", "take"];
const INSTANCE_TABLES = [
	"user",
	"certificate",
	"access_list",
	"npmpro_dns_credential",
	"proxy_host",
	"redirection_host",
	"dead_host",
	"stream",
];
const INSTANCE_COLUMNS = [
	"id",
	"email",
	"name",
	"nice_name",
	"domain_names",
	"owner_user_id",
	"incoming_port",
	"tcp_forwarding",
	"udp_forwarding",
	"provider",
];

const lower = (value) => String(value ?? "").toLowerCase();
const same = (a, b) => String(a) === String(b);
const isOn = (value) => Boolean(Number(value));
const compareText = (a, b) => {
	if (a < b) return -1;
	return a > b ? 1 : 0;
};
const byId = (a, b) => Number(a.id) - Number(b.id) || compareText(String(a.id), String(b.id));
const sortedRows = (rows) => [...(Array.isArray(rows) ? rows : [])].sort(byId);
const domainKey = (row) => [...new Set(domainsOf(row).map(lower))].sort(compareText).join("\n");
const tableRows = (data, typeId) => sortedRows(data[typeId]?.[ITEM_TYPES[typeId].table]);
const instanceRows = (instance, typeId) => sortedRows(instance[ITEM_TYPES[typeId].table]);

const parseJson = (value) => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

// the value with object keys sorted, for a comparison that ignores key order
const canonical = (value) => {
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort(compareText)
				.map((name) => [name, canonical(value[name])]),
		);
	}
	return value;
};

const hostClashes = (row, instance) => {
	const domains = new Set(domainsOf(row).map(lower));
	return DOMAIN_HOST_TYPES.flatMap((type) =>
		instanceRows(instance, type)
			.filter((other) => domainsOf(other).some((domain) => domains.has(lower(domain))))
			.map((other) => ({ type, row: other })),
	);
};

const streamClashes = (row, instance) =>
	sortedRows(instance.stream)
		.filter(
			(other) =>
				same(other.incoming_port, row.incoming_port) &&
				((isOn(row.tcp_forwarding) && isOn(other.tcp_forwarding)) ||
					(isOn(row.udp_forwarding) && isOn(other.udp_forwarding))),
		)
		.map((other) => ({ type: "streams", row: other }));

// the same domain set; without domains the same provider and name
const certificateMatch = (row, candidates) => {
	const domains = domainKey(row);
	return candidates.filter((other) =>
		domains === ""
			? domainKey(other) === "" &&
				other.provider === row.provider &&
				lower(other.nice_name) === lower(row.nice_name)
			: domainKey(other) === domains,
	);
};

const nameMatch = (row, candidates) => candidates.filter((other) => lower(other.name) === lower(row.name));

const userMatch = (row, candidates) => candidates.filter((other) => lower(other.email) === lower(row.email));

// the instance rows a certificate, access list or DNS credential may match: only those the user can see
const candidatesFor = (typeId, { instance, scope }) => {
	if (scope.page && !scope.canView(typeId)) return [];
	let rows = instanceRows(instance, typeId);
	if (scope.visibleOwnerId !== null && scope.visibleOwnerId !== undefined) {
		rows = rows.filter((row) => same(row.owner_user_id, scope.visibleOwnerId));
	}
	if (typeId === "dns_credentials" && scope.page)
		rows = rows.filter((row) => same(row.owner_user_id, scope.importerId));
	return rows;
};

const findTargets = (typeId, row, ctx) => {
	if (DOMAIN_HOST_TYPES.includes(typeId)) return hostClashes(row, ctx.instance);
	if (typeId === "streams") return streamClashes(row, ctx.instance);
	if (typeId === "users")
		return userMatch(row, instanceRows(ctx.instance, "users")).map((other) => ({ type: typeId, row: other }));
	const candidates = candidatesFor(typeId, ctx);
	const found = typeId === "certificates" ? certificateMatch(row, candidates) : nameMatch(row, candidates);
	return found.map((other) => ({ type: typeId, row: other }));
};

const reasonOf = (typeId, count) => {
	if (DOMAIN_HOST_TYPES.includes(typeId)) return count > 1 ? "domain-in-use-several" : "domain-in-use";
	if (typeId === "streams") return "port-in-use";
	if (typeId === "certificates") return "same-certificate";
	return typeId === "users" ? "same-email" : "same-name";
};

// the item before limits and choices, with the instance row it matches
const matchItem = (typeId, row, ctx) => {
	const base = { key: `${typeId}:${row.id}`, type: typeId, id: row.id, label: itemLabel(typeId, row) };
	const targets = findTargets(typeId, row, ctx);
	if (targets.length === 0) {
		return { item: { ...base, action: "add", reason: null, target: null, choices: [], default: "add" } };
	}
	const [first] = targets;
	let choices = [...MATCH_CHOICES[typeId]];
	// a replace keeps the target's id, so it needs a single target of the same type
	if (HOST_TYPES.includes(typeId) && (targets.length > 1 || first.type !== typeId)) choices = ["skip"];
	if (typeId === "users" && same(first.row.id, ctx.scope.adminUserId)) choices = ["existing"];
	const target = { type: first.type, id: first.row.id, label: itemLabel(first.type, first.row) };
	const item = { ...base, action: choices[0], reason: reasonOf(typeId, targets.length), target, choices };
	return { item: { ...item, default: choices[0] }, targetRow: first.row };
};

// page imports: no replace of a host the user may not edit; a type the user cannot manage is only matched
const limitByScope = ({ item, targetRow }, scope) => {
	if (!scope.page) return item;
	if (HOST_TYPES.includes(item.type) && item.target) {
		return scope.canEdit(ITEM_TYPES[item.target.type].table, targetRow) ? item : { ...item, choices: ["skip"] };
	}
	if (LINK_TYPES.includes(item.type) && !scope.canManage(item.type)) {
		return item.target
			? { ...item, choices: ["existing"], default: "existing" }
			: { ...item, choices: [], default: "skip" };
	}
	return item;
};

// the user's choice when it is one the item offers; an unticked linked item uses its match or is left out
const applyChoice = (item, choice) => {
	if (item.linked && choice === "unticked")
		return { ...item, unticked: true, action: item.target ? "existing" : "skip" };
	return { ...item, action: item.choices.includes(choice) ? choice : item.default };
};

/**
 * @param   {string}            typeId
 * @param   {Object[]}          rows
 * @param   {Object}            ctx
 * @param   {Object}            [links]
 * @param   {Map}               [links.neededBy]     String(id) -> Set of item keys
 * @param   {Set|undefined}     [links.selectedIds]  undefined: every row is selected
 */
const planRows = (typeId, rows, ctx, { neededBy = new Map(), selectedIds } = {}) =>
	sortedRows(rows).map((row) => {
		const item = limitByScope(matchItem(typeId, row, ctx), ctx.scope);
		const id = String(row.id);
		const needed = [...(neededBy.get(id) ?? [])].sort(compareText);
		const linked = selectedIds !== undefined && !selectedIds.has(id);
		const choice = Object.hasOwn(ctx.choices, item.key) ? ctx.choices[item.key] : undefined;
		return applyChoice({ ...item, needed_by: needed, linked, unticked: false }, choice);
	});

const selectedRows = (typeId, ctx) => {
	if (!(ctx.types.includes(typeId) && ctx.data[typeId])) return [];
	const ids = ctx.only[typeId];
	return selectRows(typeId, ctx.data[typeId], Array.isArray(ids) ? ids : undefined)[ITEM_TYPES[typeId].table] ?? [];
};

// the selected rows of the type and the rows the active items need
const planLinked = (typeId, neededBy, ctx) => {
	const selected = selectedRows(typeId, ctx);
	const selectedIds = new Set(selected.map((row) => String(row.id)));
	const needed = tableRows(ctx.data, typeId).filter(
		(row) => neededBy.has(String(row.id)) && !selectedIds.has(String(row.id)),
	);
	return planRows(typeId, [...selected, ...needed], ctx, { neededBy, selectedIds });
};

// the data of the items that write their row, for linkedOf
const activeData = (items, data) =>
	Object.fromEntries(
		Object.keys(ITEM_TYPES)
			.filter((typeId) => data[typeId])
			.map((typeId) => {
				const ids = items
					.filter((item) => item.type === typeId && ACTIVE.has(item.action))
					.map((item) => item.id);
				return [typeId, selectRows(typeId, data[typeId], ids)];
			}),
	);

// the compared part of a setting row: its value and its meta without secret keys
const settingContent = (typeId, row) => {
	const meta = parseJson(row.meta);
	const stripped = TYPES[typeId].secrets.strip({ setting: [{ ...row, meta: meta ?? {} }] }).setting[0].meta;
	return JSON.stringify(canonical([row.value ?? null, stripped]));
};

const listedItem = ({ key, typeId, id, label, target }) => ({
	key,
	type: typeId,
	id,
	label,
	action: "keep",
	reason: "differs",
	target,
	choices: [...SETTING_CHOICES],
	default: "keep",
	needed_by: [],
	linked: false,
	unticked: false,
});

// setting rows whose value or meta, without secrets, differs from the instance's
const settingDiffs = (ctx) =>
	SETTINGS_TYPES.filter((typeId) => ctx.types.includes(typeId)).flatMap((typeId) =>
		(ctx.data[typeId]?.setting ?? []).flatMap((row) => {
			const current = (ctx.instance.setting ?? []).find((other) => same(other.id, row.id));
			if (current && settingContent(typeId, current) === settingContent(typeId, row)) return [];
			const target = current ? { type: typeId, id: current.id, label: current.name || String(current.id) } : null;
			return [
				listedItem({ key: `setting:${row.id}`, typeId, id: row.id, label: row.name || String(row.id), target }),
			];
		}),
	);

// staged files of the chosen file types that the instance lacks or holds with other content
const fileDiffs = (ctx) => {
	const types = FILE_TYPES.filter((typeId) => ctx.types.includes(typeId));
	const current = ctx.instance.files ?? {};
	return Object.keys(ctx.stageFiles)
		.sort(compareText)
		.flatMap((rel) => {
			const typeId = types.find((type) => TYPES[type].files.allow(rel));
			if (typeId === undefined || current[rel] === ctx.stageFiles[rel]) return [];
			const target = Object.hasOwn(current, rel) ? { type: typeId, id: rel, label: rel } : null;
			return [listedItem({ key: `file:${rel}`, typeId, id: rel, label: rel, target })];
		});
};

const rowOf = (data, item) => tableRows(data, item.type).find((row) => same(row.id, item.id));

// [column, target type, target id] of the links a row carries
const linksOf = (typeId, row, data) => {
	if (typeId === "certificates") {
		return row.npmpro_dns_credential_id > 0
			? [["npmpro_dns_credential_id", "dns_credentials", row.npmpro_dns_credential_id]]
			: [];
	}
	const links = [
		["certificate_id", "certificates"],
		["npmpro_mtls_certificate_id", "certificates"],
		["access_list_id", "access_lists"],
	]
		.filter(([column]) => row[column] > 0)
		.map(([column, type]) => [column, type, row[column]]);
	if (typeId === "proxy_hosts") {
		for (const link of data.proxy_hosts?.npmpro_proxy_host_access_list ?? []) {
			if (same(link.proxy_host_id, row.id) && link.access_list_id > 0) {
				links.push(["npmpro_proxy_host_access_list.access_list_id", "access_lists", link.access_list_id]);
			}
		}
	}
	return links;
};

// links of the written hosts and certificates whose target is neither added nor matched
const clearedLinks = (items, data) => {
	const byKey = new Map(items.map((item) => [item.key, item]));
	const cleared = new Map();
	for (const item of items) {
		if (!(ACTIVE.has(item.action) && (HOST_TYPES.includes(item.type) || item.type === "certificates"))) continue;
		const row = rowOf(data, item);
		for (const [column, type, from] of row ? linksOf(item.type, row, data) : []) {
			const target = byKey.get(`${type}:${from}`);
			if (target && KEPT_TARGETS.has(target.action)) continue;
			cleared.set(`${item.key}\n${column}\n${from}`, {
				key: item.key,
				column,
				from,
				label: target?.label ?? `#${from}`,
			});
		}
	}
	return [...cleared.values()].sort(
		(a, b) =>
			compareText(a.key, b.key) || compareText(a.column, b.column) || compareText(String(a.from), String(b.from)),
	);
};

const needsSecret = (item, data) => {
	if (!ACTIVE.has(item.action)) return false;
	if (item.type === "certificates") return rowOf(data, item)?.provider !== "mtls";
	if (item.type === "access_lists") {
		return (data.access_lists?.access_list_auth ?? []).some((auth) => same(auth.access_list_id, item.id));
	}
	return item.type === "dns_credentials" || item.type === "users";
};

const itemGroup = (item) => {
	if (item.key.startsWith("setting:")) return 2;
	return item.key.startsWith("file:") ? 3 : 1;
};

const compareItems = (a, b) =>
	itemGroup(a) - itemGroup(b) ||
	(itemGroup(a) === 1 ? RESTORE_ORDER.indexOf(a.type) - RESTORE_ORDER.indexOf(b.type) : 0) ||
	(itemGroup(a) === 1 ? Number(a.id) - Number(b.id) : 0) ||
	compareText(String(a.id), String(b.id));

/**
 * The hash the apply compares: actions, targets and cleared links, independent of the item order.
 *
 * @param   {Object}  plan
 * @returns {string}
 */
const planHash = (plan) => {
	const items = [...plan.items]
		.sort((a, b) => compareText(a.key, b.key))
		.map(({ key, action, target }) => [key, action, target?.id ?? null]);
	const cleared = plan.cleared_links.map((link) => [link.key, link.column, link.from]);
	return createHash("sha256")
		.update(JSON.stringify([items, cleared]))
		.digest("hex");
};

/**
 * Plans a merge of a backup's items into the instance; see the spec for the rules.
 *
 * @param   {Object}    options
 * @param   {Object}    options.data        { [typeId]: { [table]: rows } }
 * @param   {Object}    options.instance    readInstanceRows() plus files: { [rel]: sha256 }
 * @param   {Object}    options.stageFiles  { [rel]: sha256 }
 * @param   {string[]}  options.types
 * @param   {Object}    [options.items]     { [typeId]: ids[] }
 * @param   {Object}    [options.choices]   { [key]: choice }
 * @param   {Object}    options.scope       { adminUserId, importerId, page, canView, canManage, canEdit, visibleOwnerId }
 * @param   {boolean}   options.secrets
 * @returns {{ items: Object[], counts: Object, cleared_links: Object[], needs_secrets: string[], hash: string }}
 */
const planMerge = ({ data, instance, stageFiles, types, items, choices, scope, secrets }) => {
	// users, settings and custom files are never part of a page import
	const chosen = scope.page
		? types.filter((typeId) => typeId !== "users" && Object.hasOwn(ITEM_TYPES, typeId))
		: types;
	const ctx = {
		data: data ?? {},
		instance: instance ?? {},
		stageFiles: stageFiles ?? {},
		types: chosen,
		only: items ?? {},
		choices: choices ?? {},
		scope,
	};
	const planned = HOST_TYPES.flatMap((typeId) => planRows(typeId, selectedRows(typeId, ctx), ctx));
	const hostLinks = linkedOf(activeData(planned, ctx.data));
	planned.push(...planLinked("certificates", hostLinks.certificates, ctx));
	planned.push(...planLinked("access_lists", hostLinks.access_lists, ctx));
	planned.push(...planLinked("dns_credentials", linkedOf(activeData(planned, ctx.data)).dns_credentials, ctx));
	planned.push(...planRows("users", selectedRows("users", ctx), ctx));
	planned.push(...[...settingDiffs(ctx), ...fileDiffs(ctx)].map((item) => applyChoice(item, ctx.choices[item.key])));
	planned.sort(compareItems);
	const counts = Object.fromEntries(
		ACTIONS.map((action) => [action, planned.filter((item) => item.action === action).length]),
	);
	const plan = {
		items: planned,
		counts,
		cleared_links: clearedLinks(planned, ctx.data),
		needs_secrets: secrets ? [] : planned.filter((item) => needsSecret(item, ctx.data)).map((item) => item.key),
	};
	return { ...plan, hash: planHash(plan) };
};

// a table's rows with only the columns the planner reads, domain_names parsed
const readTable = async (knex, table) => {
	const present = Object.keys(await knex(table).columnInfo());
	const columns = INSTANCE_COLUMNS.filter((column) => present.includes(column));
	if (!columns.includes("id")) return [];
	const rows = await knex(table).select(columns).orderBy("id");
	return rows.map((row) =>
		typeof row.domain_names === "string" ? { ...row, domain_names: parseJson(row.domain_names) } : row,
	);
};

/**
 * The instance rows the planner matches against.
 *
 * @param   {import("knex").Knex}  knex
 * @returns {Promise<Object>}      { [table]: rows }
 */
const readInstanceRows = async (knex) => {
	const out = {};
	for (const table of INSTANCE_TABLES) out[table] = await readTable(knex, table);
	const settingColumns = Object.keys(await knex("setting").columnInfo());
	const settings = settingColumns.length > 0 ? await knex("setting").select().orderBy("id") : [];
	out.setting = settings.map((row) => ({ ...row, meta: parseJson(row.meta) }));
	return out;
};

export { planHash, planMerge, readInstanceRows };
