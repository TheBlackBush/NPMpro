// Plans and applies the reference fixes needed after a replace restore. Pure: it only reads the rows it is given;
// applyReferences takes a knex transaction. Empty values match what the app writes for "none": certificate_id and
// npmpro_mtls_certificate_id are NOT NULL DEFAULT 0 columns, npmpro_dns_credential_id is nullable.

const HOST_TABLES = ["proxy_host", "redirection_host", "dead_host", "stream"];
const OWNED_TABLES = [...HOST_TABLES, "certificate", "access_list", "npmpro_dns_credential", "npmpro_ddns_record"];
const LINK_TABLE = "npmpro_proxy_host_access_list";
const CREDENTIAL_TABLE = "npmpro_dns_credential";
const DOMAIN_TABLE = "npmpro_dns_domain";
const RECORD_TABLE = "npmpro_ddns_record";
// npmpro_dns_credential.name is a varchar(255), unique per owner
const MAX_NAME = 255;

// ids can arrive as numbers or strings (JSON round trips, bigint columns), so compare them as strings
const key = (value) => String(value);
const idSet = (rows) => new Set((rows ?? []).map((row) => key(row.id)));

const rowLabel = (table, row) => {
	const domain = Array.isArray(row.domain_names) ? row.domain_names[0] : undefined;
	const name = domain || row.nice_name || row.name;
	return `${table} ${name || `#${row.id}`}`;
};

// names compare case-insensitively: MySQL's default collation does
const nameKey = (name) => String(name ?? "").toLowerCase();

const freeName = (name, taken) => {
	const base = String(name ?? "");
	if (!taken.has(nameKey(base))) return base;
	for (let n = 2; ; n++) {
		const suffix = ` (${n})`;
		const candidate = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
		if (!taken.has(nameKey(candidate))) return candidate;
	}
};

const domainChange = (row, label) => ({
	table: DOMAIN_TABLE,
	id: row.id,
	column: "*",
	remove: true,
	from: row.dns_credential_id,
	to: null,
	label,
});

/**
 * The domain rows whose credential is not in the given credential rows, as removals with their note.
 *
 * @param   {Array<Object>}  domains
 * @param   {Array<Object>}  credentials
 * @returns {{ kept: Array<Object>, orphans: Array<Object> }}
 */
const splitOrphanDomains = (domains, credentials) => {
	const credentialIds = idSet(credentials);
	const kept = [];
	const orphans = [];
	for (const row of domains) {
		if (credentialIds.has(key(row.dns_credential_id))) kept.push(row);
		else orphans.push(domainChange(row, `DNS domain ${row.name}: credential #${row.dns_credential_id} not found`));
	}
	return { kept, orphans };
};

const recordChange = (row, why) => ({
	table: RECORD_TABLE,
	id: row.id,
	column: "*",
	remove: true,
	from: row.dns_credential_id,
	to: null,
	label: `DDNS record ${row.name}: DNS credential #${row.dns_credential_id} ${why}`,
});

/**
 * The DDNS record rows whose credential is not in the given credential rows, or belongs to another provider than the
 * record, as removals with their note. The owner is not compared: a record belongs to its credential's owner (who sees
 * it follows the credential). A record without a credential (the custom provider) has nothing to resolve.
 *
 * @param   {Array<Object>}  records
 * @param   {Array<Object>}  credentials
 * @returns {{ kept: Array<Object>, orphans: Array<Object> }}
 */
const splitOrphanRecords = (records, credentials) => {
	const byId = new Map((credentials ?? []).map((row) => [key(row.id), row]));
	const kept = [];
	const orphans = [];
	for (const row of records ?? []) {
		const value = row.dns_credential_id;
		const credential = byId.get(key(value));
		if (value === null || value === undefined) kept.push(row);
		else if (!credential) orphans.push(recordChange(row, "not found"));
		else if (credential.provider !== row.provider) orphans.push(recordChange(row, "is of another provider"));
		else kept.push(row);
	}
	return { kept, orphans };
};

// the host tables a host record (a managed DDNS row) may point to, by its host_type
const RECORD_HOST_TABLES = new Set(["proxy_host", "redirection_host", "dead_host"]);

const isManagedRecord = (row) => row.host_type !== null && row.host_type !== undefined && row.host_type !== "";

const metaOf = (value) => {
	if (typeof value !== "string") return value !== null && typeof value === "object" ? value : {};
	try {
		return metaOf(JSON.parse(value));
	} catch {
		return {};
	}
};

const hostRecordChange = (row, why) => ({
	table: RECORD_TABLE,
	id: row.id,
	column: "*",
	remove: true,
	from: row.host_id,
	to: null,
	label: `DDNS record ${row.name}: ${why}`,
});

/**
 * The host records (DDNS rows with a host_type) of a restore that has no host to follow: a record whose host is not
 * among the given host rows, whose host type is unknown, or that is an orphan (a failed delete at the provider, never
 * exported) is dropped with a note, never kept as a record of a host that is missing. A manual record has nothing to
 * resolve. The restore itself never creates a record at a provider, and never leaves a row that claims a host it
 * does not have.
 *
 * @param   {Array<Object>}                   records
 * @param   {Object<string, Array<Object>>}   hostRows  the host rows after the restore, by table (a table whose type is
 *                                                      not restored is missing)
 * @returns {{ kept: Array<Object>, orphans: Array<Object> }}
 */
const splitUnhostedRecords = (records, hostRows) => {
	const hostIds = Object.fromEntries(Object.entries(hostRows).map(([table, rows]) => [table, idSet(rows)]));
	const kept = [];
	const orphans = [];
	for (const row of records ?? []) {
		if (!isManagedRecord(row)) kept.push(row);
		else if (metaOf(row.meta).orphan === true)
			orphans.push(hostRecordChange(row, "a record that was left at the provider"));
		else if (!RECORD_HOST_TABLES.has(row.host_type))
			orphans.push(hostRecordChange(row, `host type ${row.host_type} is unknown`));
		else if (!hostIds[row.host_type]?.has(key(row.host_id)))
			orphans.push(hostRecordChange(row, `${row.host_type} #${row.host_id} is not restored`));
		else kept.push(row);
	}
	return { kept, orphans };
};

// a record that kept its host link must still have the host, and the host must still have the name; otherwise the
// row becomes a plain record (the engine keeps it current, nothing manages it for a host)
const unlinkedRecords = (finalRows) => {
	const hosts = Object.fromEntries(
		[...RECORD_HOST_TABLES].map((table) => [
			table,
			new Map((finalRows[table] ?? []).map((row) => [key(row.id), row])),
		]),
	);
	const changes = [];
	for (const row of finalRows[RECORD_TABLE] ?? []) {
		if (!isManagedRecord(row)) continue;
		const host = hosts[row.host_type]?.get(key(row.host_id));
		const names = Array.isArray(host?.domain_names) ? host.domain_names.map(nameKey) : [];
		if (host && names.includes(nameKey(row.name))) continue;
		changes.push({
			table: RECORD_TABLE,
			id: row.id,
			column: "host_id",
			from: row.host_id,
			to: null,
			values: { host_type: null, host_id: null, origin: null },
			label: `DDNS record ${row.name}: ${row.host_type} #${row.host_id} is gone or no longer has the name, the record is kept without a host`,
		});
	}
	return changes;
};

/**
 * @param   {{ finalRows: Object<string, Array<Object>>, adminUserId: number }} args
 *          finalRows holds every referenced and referencing table as it is after the restore
 *          (a table missing from it counts as empty).
 * @returns {Array<{ table: string, id?: number, column: string, from: *, to: *, label: string }>}
 */
const planReferences = ({ finalRows, adminUserId }) => {
	const rows = (table) => finalRows[table] ?? [];
	const certificateIds = idSet(rows("certificate"));
	const accessListIds = idSet(rows("access_list"));
	const credentialIds = idSet(rows("npmpro_dns_credential"));
	const userIds = idSet(rows("user"));
	const changes = [];

	for (const table of HOST_TABLES) {
		for (const row of rows(table)) {
			for (const column of ["certificate_id", "npmpro_mtls_certificate_id"]) {
				const value = row[column];
				if (Number(value) > 0 && !certificateIds.has(key(value))) {
					const what = column === "certificate_id" ? "certificate" : "client certificate";
					changes.push({
						table,
						id: row.id,
						column,
						from: value,
						to: 0,
						label: `${rowLabel(table, row)}: ${what} #${value} not found`,
					});
				}
			}
		}
	}

	const hostsById = new Map(rows("proxy_host").map((row) => [key(row.id), row]));
	for (const link of rows(LINK_TABLE)) {
		if (!accessListIds.has(key(link.access_list_id))) {
			const host = hostsById.get(key(link.proxy_host_id));
			const hostLabel = host ? rowLabel("proxy_host", host) : `proxy_host #${link.proxy_host_id}`;
			changes.push({
				table: LINK_TABLE,
				proxy_host_id: link.proxy_host_id,
				location_id: link.location_id,
				access_list_id: link.access_list_id,
				column: "*",
				from: link.access_list_id,
				to: null,
				label: `${hostLabel}: access list #${link.access_list_id} not found`,
			});
		}
	}

	for (const row of rows("certificate")) {
		const value = row.npmpro_dns_credential_id;
		if (value !== null && value !== undefined && value !== "" && !credentialIds.has(key(value))) {
			changes.push({
				table: "certificate",
				id: row.id,
				column: "npmpro_dns_credential_id",
				from: value,
				to: null,
				label: `${rowLabel("certificate", row)}: DNS credential #${value} not found`,
			});
		}
	}

	// the names of the admin's DNS credentials: unique per owner, so a credential handed to the admin may need another
	const adminCredentialNames = new Set(
		rows(CREDENTIAL_TABLE)
			.filter((row) => key(row.owner_user_id) === key(adminUserId))
			.map((row) => nameKey(row.name)),
	);
	for (const table of OWNED_TABLES) {
		for (const row of rows(table)) {
			if (userIds.has(key(row.owner_user_id))) continue;
			changes.push({
				table,
				id: row.id,
				column: "owner_user_id",
				from: row.owner_user_id,
				to: adminUserId,
				label: `${rowLabel(table, row)}: owner #${row.owner_user_id} not found`,
			});
			if (table !== CREDENTIAL_TABLE) continue;
			const name = freeName(row.name, adminCredentialNames);
			adminCredentialNames.add(nameKey(name));
			if (name !== row.name) {
				changes.push({
					table,
					id: row.id,
					column: "name",
					from: row.name,
					to: name,
					label: `${rowLabel(table, row)}: renamed to ${name}, the admin has a DNS credential with this name`,
				});
			}
		}
	}

	// the DDNS records: one whose credential is gone is removed (the engine has nothing to write it with)
	changes.push(...splitOrphanRecords(rows(RECORD_TABLE), rows(CREDENTIAL_TABLE)).orphans);
	changes.push(...unlinkedRecords(finalRows));

	// the domains: a name is kept once per owner, on the credential with the lowest id (a credential handed to the admin
	// may now share an owner with one that has the name)
	const { kept, orphans } = splitOrphanDomains(rows(DOMAIN_TABLE), rows(CREDENTIAL_TABLE));
	changes.push(...orphans);
	const credentialNames = new Map(rows(CREDENTIAL_TABLE).map((row) => [key(row.id), row.name]));
	const ownerOfCredential = new Map(
		rows(CREDENTIAL_TABLE).map((row) => [
			key(row.id),
			userIds.has(key(row.owner_user_id)) ? row.owner_user_id : adminUserId,
		]),
	);
	const byId = (a, b) => Number(a) - Number(b);
	const keeper = new Map();
	for (const row of [...kept].sort((a, b) => byId(a.dns_credential_id, b.dns_credential_id) || byId(a.id, b.id))) {
		const owner = key(ownerOfCredential.get(key(row.dns_credential_id)));
		const holder = `${owner}\u0000${nameKey(row.name)}`;
		if (keeper.has(holder)) {
			changes.push(
				domainChange(row, `DNS domain ${row.name}: the owner keeps it on DNS credential ${keeper.get(holder)}`),
			);
		} else keeper.set(holder, credentialNames.get(key(row.dns_credential_id)) ?? `#${row.dns_credential_id}`);
	}

	return changes;
};

/**
 * The changes of one row are written in one update: a DNS credential's new owner and new name only together keep
 * unique(owner_user_id, name).
 *
 * @param   {Object} trx      knex transaction
 * @param   {Array}  changes  the list returned by planReferences
 * @returns {Promise}
 */
const applyReferences = async (trx, changes) => {
	const updates = new Map();
	for (const change of changes) {
		if (change.remove) {
			await trx(change.table).where({ id: change.id }).del();
			continue;
		}
		if (change.column === "*") {
			await trx(change.table)
				.where({
					proxy_host_id: change.proxy_host_id,
					location_id: change.location_id,
					access_list_id: change.access_list_id,
				})
				.del();
			continue;
		}
		const rowKey = `${change.table}#${key(change.id)}`;
		if (!updates.has(rowKey)) updates.set(rowKey, { table: change.table, id: change.id, values: {} });
		Object.assign(updates.get(rowKey).values, change.values ?? { [change.column]: change.to });
	}
	for (const { table, id, values } of updates.values()) await trx(table).where({ id }).update(values);
};

export { applyReferences, freeName, planReferences, splitOrphanDomains, splitOrphanRecords, splitUnhostedRecords };
