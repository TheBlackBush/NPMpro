import { TYPES } from "./types.js";

// the main table of each type with items, and the child tables that follow a main row
const ITEM_TYPES = {
	proxy_hosts: {
		table: "proxy_host",
		children: [
			["npmpro_location", "proxy_host_id"],
			["npmpro_proxy_host_access_list", "proxy_host_id"],
		],
	},
	redirection_hosts: { table: "redirection_host", children: [] },
	dead_hosts: { table: "dead_host", children: [] },
	streams: { table: "stream", children: [] },
	certificates: { table: "certificate", children: [] },
	access_lists: {
		table: "access_list",
		children: [
			["access_list_auth", "access_list_id"],
			["access_list_client", "access_list_id"],
		],
	},
	dns_credentials: { table: "npmpro_dns_credential", children: [] },
	users: {
		table: "user",
		children: [
			["auth", "user_id"],
			["user_permission", "user_id"],
		],
	},
};

const HOST_TYPES = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams"];
const CERTIFICATE_ID = /npm-(?<id>\d+)(?:\/|\.conf$|\.der$|\.pem$|$)/gu;
const ACCOUNTS_ROOT = "tls/certbot/accounts";

const domainsOf = (row) => {
	let domains = row.domain_names;
	if (typeof domains === "string") {
		try {
			domains = JSON.parse(domains);
		} catch {
			domains = [];
		}
	}
	return Array.isArray(domains) ? domains.filter((domain) => typeof domain === "string" && domain !== "") : [];
};

const streamLabel = (row) => {
	const protocols = [row.tcp_forwarding ? "tcp" : "", row.udp_forwarding ? "udp" : ""].filter(Boolean);
	return protocols.length > 0 ? `${row.incoming_port} (${protocols.join("+")})` : `${row.incoming_port}`;
};

/**
 * A readable name for one item.
 *
 * @param   {string}  typeId
 * @param   {Object}  row     the main row
 * @returns {string}
 */
const itemLabel = (typeId, row) => {
	let label = "";
	if (HOST_TYPES.includes(typeId) && typeId !== "streams") label = domainsOf(row).join(", ");
	else if (typeId === "certificates") label = domainsOf(row).join(", ") || row.nice_name || "";
	else if (typeId === "streams") label = row.incoming_port ? streamLabel(row) : "";
	else if (typeId === "access_lists" || typeId === "dns_credentials") label = row.name || "";
	else if (typeId === "users") label = row.name && row.email ? `${row.name} (${row.email})` : "";
	return label || `#${row.id}`;
};

/**
 * Keeps the chosen main rows and the child rows that follow them; other tables stay as they are.
 *
 * @param   {string}                typeId
 * @param   {Object}                rowsByTable
 * @param   {string[]|undefined}    ids          undefined keeps everything
 * @returns {Object}
 */
const selectRows = (typeId, rowsByTable, ids) => {
	if (ids === undefined) return rowsByTable;
	const { table, children } = ITEM_TYPES[typeId];
	const chosen = new Set(ids.map(String));
	const main = (rowsByTable[table] ?? []).filter((row) => chosen.has(String(row.id)));
	const kept = new Set(main.map((row) => String(row.id)));
	const out = { ...rowsByTable, [table]: main };
	for (const [childTable, column] of children) {
		if (Array.isArray(rowsByTable[childTable])) {
			out[childTable] = rowsByTable[childTable].filter((row) => kept.has(String(row[column])));
		}
	}
	return out;
};

const add = (map, id, key) => {
	const name = String(id);
	if (!map.has(name)) map.set(name, new Set());
	map.get(name).add(key);
};

/**
 * Which items need which certificates, access lists and DNS credentials.
 *
 * @param   {Object}  data  { [typeId]: rowsByTable }
 * @returns {{ certificates: Map<string, Set<string>>, access_lists: Map<string, Set<string>>,
 *             dns_credentials: Map<string, Set<string>> }}
 */
const linkedOf = (data) => {
	const linked = { certificates: new Map(), access_lists: new Map(), dns_credentials: new Map() };
	for (const typeId of HOST_TYPES) {
		const rowsByTable = data[typeId];
		if (!rowsByTable) continue;
		for (const row of rowsByTable[ITEM_TYPES[typeId].table] ?? []) {
			const key = `${typeId}:${row.id}`;
			if (row.certificate_id > 0) add(linked.certificates, row.certificate_id, key);
			if (row.npmpro_mtls_certificate_id > 0) add(linked.certificates, row.npmpro_mtls_certificate_id, key);
			if (row.access_list_id > 0) add(linked.access_lists, row.access_list_id, key);
		}
	}
	for (const row of data.proxy_hosts?.npmpro_proxy_host_access_list ?? []) {
		if (row.access_list_id > 0) add(linked.access_lists, row.access_list_id, `proxy_hosts:${row.proxy_host_id}`);
	}
	for (const row of data.certificates?.certificate ?? []) {
		if (row.npmpro_dns_credential_id !== null && row.npmpro_dns_credential_id !== undefined) {
			add(linked.dns_credentials, row.npmpro_dns_credential_id, `certificates:${row.id}`);
		}
	}
	return linked;
};

/**
 * A filter for the certificate files of the given certificate ids; the shared ACME accounts and the folders that lead
 * to the certificates stay allowed.
 *
 * @param   {Array<string|number>}  ids
 * @returns {Function}              (rel) => boolean
 */
const certificateFileFilter = (ids) => {
	const chosen = new Set(ids.map(String));
	return (rel) => {
		if (!TYPES.certificates.files.allow(rel)) return false;
		if (rel === ACCOUNTS_ROOT || rel.startsWith(`${ACCOUNTS_ROOT}/`)) return true;
		const last = [...rel.matchAll(CERTIFICATE_ID)].at(-1);
		return last === undefined || chosen.has(last.groups.id);
	};
};

export { certificateFileFilter, ITEM_TYPES, itemLabel, linkedOf, selectRows };
