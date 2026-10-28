// Rows in a form that does not depend on the database engine: JSON columns as values, dates as ISO strings with an
// offset. Written into the backup by exportRows() and turned back into insertable rows for the target engine by
// coerceRow(). The app stores local time (SQLite datetime('now','localtime'), MySQL NOW() read by mysql2 as local
// time), so naive dates are read and written in the process time zone (TZ), which keeps the wall-clock time.

const JSON_COLUMNS = {
	// locations: left over from before npmpro_location ("[]"), still a column
	proxy_host: ["domain_names", "meta", "locations"],
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
	npmpro_backup_schedule: ["types"],
};

// tables without an id column, ordered by their primary key instead
const ORDER_BY = {
	npmpro_proxy_host_access_list: ["proxy_host_id", "location_id", "access_list_id"],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/u;
const NAIVE_DATE =
	/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?$/u;
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
	// SQLite returns dates as the stored naive local strings; mysql2 and pg return Date objects
	const dateColumns = SQLITE_CLIENTS.has(String(knex.client?.config?.client ?? ""))
		? Object.entries(await knex(table).columnInfo())
				.filter(([, column]) => DATE_TYPE.test(String(column.type ?? "")))
				.map(([name]) => name)
		: [];
	return (await query).map((row) => {
		const out = {};
		for (const [key, value] of Object.entries(row)) {
			if (Buffer.isBuffer(value)) throw new Error(`${table}.${key} holds binary data`);
			if (value instanceof Date) out[key] = value.toISOString();
			else if (dateColumns.includes(key) && typeof value === "string") out[key] = localToIso(value);
			else out[key] = jsonColumns.includes(key) ? parseJson(value) : value;
		}
		return out;
	});
};

const pad = (value) => String(value).padStart(2, "0");

// YYYY-MM-DD HH:MM:SS read as process-local time, as ISO (UTC); other strings unchanged
const localToIso = (value) => {
	const match = NAIVE_DATE.exec(value);
	if (!match) return value;
	const { year, month, day, hour, minute, second } = match.groups;
	const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
	return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

// an ISO date as process-local YYYY-MM-DD HH:MM:SS
const isoToLocal = (iso) => {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const isPlainObject = (value) => {
	if (value === null || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return Array.isArray(value) || proto === Object.prototype || proto === null;
};

/**
 * A row from the backup as the target database takes it.
 *
 * @param   {Object}  columns  knex(table).columnInfo() of the target, plus __client (the knex client name)
 * @param   {string}  table
 * @param   {Object}  row      a row as exportRows() wrote it
 * @returns {Object}  only the columns the target has; JSON columns and any other plain object or array value
 *                    stringified; booleans as true/false for boolean columns (1/0 on SQLite, which cannot bind
 *                    booleans) and 1/0 for others; ISO dates as process-local YYYY-MM-DD HH:MM:SS on SQLite and
 *                    MySQL, kept as ISO on Postgres
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
		else if (isPlainObject(value)) out[key] = JSON.stringify(value);
		else if (typeof value === "boolean") out[key] = boolColumn ? value : Number(value);
		else if (boolColumn && (value === 0 || value === 1)) out[key] = value === 1;
		else if (typeof value === "string" && client !== "pg" && DATE_TYPE.test(type) && ISO_DATE.test(value)) {
			out[key] = isoToLocal(value);
		} else out[key] = value;
	}
	return out;
};

export { coerceRow, exportRows, isoToLocal, JSON_COLUMNS, localToIso };
