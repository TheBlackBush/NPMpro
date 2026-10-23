import { migrate as logger } from "../logger.js";

const migrateName = "rename_to_npmpro";
const oldName = "npmplus";
const newName = "npmpro";

const prefixed = (name) => name.startsWith(`${oldName}_`);
const renamed = (name) => name.replaceAll(oldName, newName);

/**
 * @param   {Object}  knex
 * @returns {"sqlite"|"mysql"|"pg"}
 */
const clientOf = (knex) => {
	const { client } = knex.client.config;
	if (["pg", "postgres", "postgresql"].includes(client)) {
		return "pg";
	}
	if (["mysql", "mysql2"].includes(client)) {
		return "mysql";
	}
	return "sqlite";
};

/**
 * knex.raw resolves to a different shape per client
 *
 * @param   {String}  client  result of clientOf
 * @param   {*}       result  resolved knex.raw value
 * @returns {Array<Object>}
 */
const rowsOf = (client, result) => {
	if (client === "pg") {
		return result.rows;
	}
	if (client === "mysql") {
		return result[0];
	}
	return result;
};

const listTables = async (knex, client) => {
	const sql = {
		sqlite: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
		mysql: "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
		pg: "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
	}[client];
	return rowsOf(client, await knex.raw(sql)).map((row) => row.name);
};

const renameTables = async (knex, client) => {
	const tables = await listTables(knex, client);
	for (const table of tables.filter(prefixed)) {
		const target = renamed(table);
		if (tables.includes(target)) {
			throw new Error(`[${migrateName}] Both tables ${table} and ${target} exist, repair the database manually`);
		}
		await knex.schema.renameTable(table, target);
		logger.info(`[${migrateName}] Table ${table} renamed to ${target}`);
	}
};

const renameColumns = async (knex, client) => {
	for (const table of await listTables(knex, client)) {
		const columns = Object.keys(await knex(table).columnInfo());
		for (const column of columns.filter(prefixed)) {
			const target = renamed(column);
			if (columns.includes(target)) {
				throw new Error(
					`[${migrateName}] Both columns ${table}.${column} and ${target} exist, repair the database manually`,
				);
			}
			await knex.schema.alterTable(table, (t) => {
				t.renameColumn(column, target);
			});
		}
	}
	logger.info(`[${migrateName}] Columns renamed`);
};

// SQLite has no RENAME INDEX; column and table renames already rewrote the stored definitions
const renameSqliteIndexes = async (knex) => {
	const indexes = await knex.raw(
		"SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND name LIKE ?",
		[`%${oldName}%`],
	);
	for (const { name, sql } of indexes) {
		await knex.raw("DROP INDEX ??", [name]);
		await knex.raw(sql.replace(name, renamed(name)));
	}
	return indexes.length;
};

// renaming an index that backs a constraint renames the constraint too
const renamePgObjects = async (knex) => {
	const indexes = rowsOf(
		"pg",
		await knex.raw(
			"SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND indexname LIKE ?",
			[`%${oldName}%`],
		),
	);
	for (const { name } of indexes) {
		await knex.raw("ALTER INDEX ?? RENAME TO ??", [name, renamed(name)]);
	}
	const sequences = rowsOf(
		"pg",
		await knex.raw(
			"SELECT sequence_name AS name FROM information_schema.sequences WHERE sequence_schema = current_schema() AND sequence_name LIKE ?",
			[`%${oldName}%`],
		),
	);
	for (const { name } of sequences) {
		await knex.raw("ALTER SEQUENCE ?? RENAME TO ??", [name, renamed(name)]);
	}
	return indexes.length + sequences.length;
};

// primary keys are always named PRIMARY in MySQL
const renameMysqlIndexes = async (knex) => {
	const indexes = rowsOf(
		"mysql",
		await knex.raw(
			"SELECT DISTINCT index_name AS name, table_name AS tbl FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name LIKE ?",
			[`%${oldName}%`],
		),
	);
	for (const { name, tbl } of indexes) {
		await knex.raw("ALTER TABLE ?? RENAME INDEX ?? TO ??", [tbl, name, renamed(name)]);
	}
	return indexes.length;
};

/**
 * Migrate
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	const client = clientOf(knex);

	// MySQL DDL is not transactional; every step reads the current schema, so a rerun continues where it stopped
	await renameTables(knex, client);
	await renameColumns(knex, client);
	const renameIndexes = { sqlite: renameSqliteIndexes, mysql: renameMysqlIndexes, pg: renamePgObjects }[client];
	const count = await renameIndexes(knex);
	logger.info(`[${migrateName}] ${count} index or sequence name(s) renamed`);

	logger.info(`[${migrateName}] Migrating Up Complete`);
};

/**
 * Undo Migrate
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const down = (_knex) => {
	throw new Error(`[${migrateName}] You can't migrate down this one.`);
};

export { clientOf, down, rowsOf, up };
