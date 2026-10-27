// Plans and applies the reference fixes needed after a replace restore.
// Pure module: it only reads the rows it is given; applyReferences takes a knex transaction.
// Empty values match what the app writes for "none": certificate_id and npmpro_mtls_certificate_id
// are NOT NULL DEFAULT 0 columns, npmpro_dns_credential_id is a nullable column.

const HOST_TABLES = ["proxy_host", "redirection_host", "dead_host", "stream"];
const OWNED_TABLES = [...HOST_TABLES, "certificate", "access_list", "npmpro_dns_credential"];
const LINK_TABLE = "npmpro_proxy_host_access_list";
const CREDENTIAL_TABLE = "npmpro_dns_credential";
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

// name, or name with the first free suffix " (2)", " (3)" ... when taken holds it
const freeName = (name, taken) => {
	const base = String(name ?? "");
	if (!taken.has(nameKey(base))) return base;
	for (let n = 2; ; n++) {
		const suffix = ` (${n})`;
		const candidate = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
		if (!taken.has(nameKey(candidate))) return candidate;
	}
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
		updates.get(rowKey).values[change.column] = change.to;
	}
	for (const { table, id, values } of updates.values()) await trx(table).where({ id }).update(values);
};

export { applyReferences, planReferences };
