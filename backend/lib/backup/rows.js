// Rows in a form that does not depend on the database engine: JSON columns as values, dates as ISO strings. Written
// into the backup by exportRows() and turned back into insertable rows for the target engine by coerceRow().

const JSON_COLUMNS = {
	proxy_host: ["domain_names", "meta"],
	redirection_host: ["domain_names", "meta"],
	dead_host: ["domain_names", "meta"],
	stream: ["meta"],
	certificate: ["domain_names", "meta"],
	access_list: ["meta"],
	access_list_auth: ["meta"],
	access_list_client: ["meta"],
	user: ["roles"],
	auth: ["meta"],
	setting: ["meta"],
};

// tables without an id column, ordered by their primary key instead
const ORDER_BY = {
	npmpro_proxy_host_access_list: ["proxy_host_id", "location_id", "access_list_id"],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/u;
const DATE_TYPE = /date|time/iu;
const BOOL_TYPE = /bool/iu;
const SQLITE_CLIENTS = new Set(["sqlite3", "better-sqlite3"]);

const parseJson = (value) => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

/**
 * All rows of a table, read with raw knex (the models hide columns).
 *
 * @param   {import("knex").Knex}  knex
 * @param   {string}               table
 * @param   {Function}             [where]  (queryBuilder) => void, narrows the rows
 * @returns {Promise<Object[]>}    JSON columns parsed, Date values as ISO strings
 */
const exportRows = async (knex, table, where) => {
	const query = knex(table)
		.select("*")
		.orderBy(ORDER_BY[table] ?? ["id"]);
	if (where) where(query);
	const jsonColumns = JSON_COLUMNS[table] ?? [];
	return (await query).map((row) => {
		const out = {};
		for (const [key, value] of Object.entries(row)) {
			if (Buffer.isBuffer(value)) throw new Error(`${table}.${key} holds binary data`);
			if (value instanceof Date) out[key] = value.toISOString();
			else out[key] = jsonColumns.includes(key) ? parseJson(value) : value;
		}
		return out;
	});
};

const toSqlDate = (iso) => {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 19).replace("T", " ");
};

/**
 * A row from the backup as the target database takes it.
 *
 * @param   {Object}  columns  knex(table).columnInfo() of the target, plus __client (the knex client name)
 * @param   {string}  table
 * @param   {Object}  row      a row as exportRows() wrote it
 * @returns {Object}  only the columns the target has; JSON columns stringified; booleans as true/false for boolean
 *                    columns (1/0 on SQLite, which cannot bind booleans) and 1/0 for others; ISO dates as
 *                    YYYY-MM-DD HH:MM:SS (UTC) on SQLite and MySQL, kept as ISO on Postgres
 */
const coerceRow = (columns, table, row) => {
	const client = String(columns.__client ?? "");
	const sqlite = SQLITE_CLIENTS.has(client);
	const jsonColumns = JSON_COLUMNS[table] ?? [];
	const out = {};
	for (const [key, value] of Object.entries(row)) {
		const column = Object.hasOwn(columns, key) && key !== "__client" ? columns[key] : null;
		if (!column) continue;
		const type = String(column.type ?? "");
		const boolColumn = BOOL_TYPE.test(type) && !sqlite;
		if (jsonColumns.includes(key)) out[key] = value === null || value === undefined ? null : JSON.stringify(value);
		else if (typeof value === "boolean") out[key] = boolColumn ? value : Number(value);
		else if (boolColumn && (value === 0 || value === 1)) out[key] = value === 1;
		else if (typeof value === "string" && client !== "pg" && DATE_TYPE.test(type) && ISO_DATE.test(value)) {
			out[key] = toSqlDate(value);
		} else out[key] = value;
	}
	return out;
};

export { coerceRow, exportRows, JSON_COLUMNS };
