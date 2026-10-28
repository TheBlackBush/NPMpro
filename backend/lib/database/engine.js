import { stat } from "node:fs/promises";

// Engine-specific queries, one branch per engine. Everything else in lib/database works through these.

const SQLITE_CLIENTS = new Set(["sqlite3", "better-sqlite3"]);
const PG_CLIENTS = new Set(["pg", "postgres", "postgresql"]);
const MYSQL_CLIENTS = new Set(["mysql", "mysql2"]);

const engineOf = (knex) => {
	const client = String(knex.client?.config?.client ?? "");
	if (SQLITE_CLIENTS.has(client)) return "sqlite";
	if (PG_CLIENTS.has(client)) return "postgres";
	if (MYSQL_CLIENTS.has(client)) return "mysql";
	throw new Error(`Unknown database client ${client}`);
};

// the rows of a knex.raw result
const rawRows = (knex, result) => {
	switch (engineOf(knex)) {
		case "postgres":
			return result.rows;
		case "mysql":
			return result[0];
		default:
			return result;
	}
};

/**
 * The tables of the database (sorted); views too when asked (the emptiness check)
 */
const listTables = async (knex, { views = false } = {}) => {
	let result;
	switch (engineOf(knex)) {
		case "sqlite":
			result = await knex.raw(
				`select name from sqlite_master where type in (${views ? "'table', 'view'" : "'table'"}) and name not like 'sqlite\\_%' escape '\\'`,
			);
			break;
		case "postgres":
			result = await knex.raw(
				`select table_name as name from information_schema.tables where table_schema = current_schema()${views ? "" : " and table_type = 'BASE TABLE'"}`,
			);
			break;
		default:
			result = await knex.raw(
				`select table_name as name from information_schema.tables where table_schema = database()${views ? "" : " and table_type = 'BASE TABLE'"}`,
			);
	}
	return rawRows(knex, result)
		.map((row) => String(row.name))
		.sort();
};

const serverVersion = async (knex) => {
	switch (engineOf(knex)) {
		case "sqlite":
			return String(rawRows(knex, await knex.raw("select sqlite_version() as version"))[0].version);
		case "postgres":
			return String(rawRows(knex, await knex.raw("show server_version"))[0].server_version);
		default:
			return String(rawRows(knex, await knex.raw("select version() as version"))[0].version);
	}
};

const fileSize = async (file) => {
	try {
		return (await stat(file)).size;
	} catch {
		return 0;
	}
};

/**
 * The size of the database in bytes, or null when the engine does not report it
 *
 * @param   {Object}  knex
 * @param   {Object}  [options]  { file }: the SQLite file (with its -wal file)
 */
const databaseSize = async (knex, { file } = {}) => {
	switch (engineOf(knex)) {
		case "sqlite":
			return file ? (await fileSize(file)) + (await fileSize(`${file}-wal`)) : null;
		case "postgres":
			return Number(rawRows(knex, await knex.raw("select pg_database_size(current_database()) as size"))[0].size);
		default:
			return Number(
				rawRows(
					knex,
					await knex.raw(
						"select coalesce(sum(data_length + index_length), 0) as size from information_schema.tables where table_schema = database()",
					),
				)[0].size,
			);
	}
};

export { databaseSize, engineOf, listTables, rawRows, serverVersion };
