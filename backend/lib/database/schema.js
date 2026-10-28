import { fileURLToPath } from "node:url";
import errs from "../error.js";
import { engineOf, listTables, rawRows } from "./engine.js";
import { kindOfType } from "./values.js";

// code-unit order: deterministic and independent of the locale
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The schema side of a database move: the target gets NPMpro's own migrations, the tables to copy come from the
// source schema (so a table a later migration adds is copied too), ordered parents first.

const MIGRATIONS = {
	tableName: "migrations",
	directory: fileURLToPath(new URL("../../migrations", import.meta.url)),
};
const MIGRATION_TABLES = new Set(["migrations", "migrations_lock"]);

const mismatch = (message) => new errs.DatabaseMoveError("schema-mismatch", message);

const runMigrations = (knex, config = MIGRATIONS) => knex.migrate.latest(config);

const dataTables = async (knex) => (await listTables(knex)).filter((table) => !MIGRATION_TABLES.has(table));

/**
 * Every foreign key as { table, references }
 */
const foreignKeys = async (knex) => {
	switch (engineOf(knex)) {
		case "sqlite": {
			const keys = [];
			for (const table of await dataTables(knex)) {
				const rows = rawRows(knex, await knex.raw("select * from pragma_foreign_key_list(?)", [table]));
				for (const row of rows) keys.push({ table, references: String(row.table) });
			}
			return keys;
		}
		case "postgres":
			return rawRows(
				knex,
				await knex.raw(
					`select tc.table_name as "table", ccu.table_name as "references"
					from information_schema.table_constraints tc
					join information_schema.constraint_column_usage ccu
						on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
					where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = current_schema()`,
				),
			).map((row) => ({ table: String(row.table), references: String(row.references) }));
		default:
			return rawRows(
				knex,
				await knex.raw(
					`select table_name as \`table\`, referenced_table_name as \`references\`
					from information_schema.key_column_usage
					where table_schema = database() and referenced_table_name is not null`,
				),
			).map((row) => ({ table: String(row.table), references: String(row.references) }));
	}
};

/**
 * The tables parents first; tables that are ready together alphabetically
 */
const tableOrder = (tables, keys) => {
	const parents = new Map(tables.map((table) => [table, new Set()]));
	for (const { table, references } of keys) {
		if (table !== references && parents.has(table) && parents.has(references)) parents.get(table).add(references);
	}
	const pending = new Set(tables);
	const order = [];
	while (pending.size > 0) {
		const ready = [...pending]
			.filter((table) => [...parents.get(table)].every((parent) => !pending.has(parent)))
			.sort(byCode);
		if (ready.length === 0)
			throw mismatch(`The tables ${[...pending].sort(byCode).join(", ")} reference each other`);
		for (const table of ready) {
			order.push(table);
			pending.delete(table);
		}
	}
	return order;
};

const primaryKey = async (knex, table) => {
	switch (engineOf(knex)) {
		case "sqlite":
			return rawRows(
				knex,
				await knex.raw("select name from pragma_table_info(?) where pk > 0 order by pk", [table]),
			).map((row) => String(row.name));
		case "postgres":
			return rawRows(
				knex,
				await knex.raw(
					`select a.attname as name from pg_index i
					join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
					where i.indrelid = to_regclass(?) and i.indisprimary
					order by array_position(i.indkey::int2[], a.attnum)`,
					[`"${table}"`],
				),
			).map((row) => String(row.name));
		default:
			return rawRows(
				knex,
				await knex.raw(
					`select column_name as name from information_schema.key_column_usage
					where table_schema = database() and table_name = ? and constraint_name = 'PRIMARY'
					order by ordinal_position`,
					[table],
				),
			).map((row) => String(row.name));
	}
};

/**
 * The columns that identify a row: the primary key, or (a table without one) every column that can be compared in a
 * where clause, sorted
 */
const keyColumns = async (knex, table) => {
	const key = await primaryKey(knex, table);
	if (key.length > 0) return key;
	const info = await knex(table).columnInfo();
	return Object.entries(info)
		.filter(([, column]) => !["json", "binary"].includes(kindOfType(column.type)))
		.map(([name]) => name)
		.sort(byCode);
};

const listed = (names) => (names.length > 0 ? names.join(", ") : "none");

/**
 * Checks that the target has the same tables, columns and migrations as the database in use
 *
 * @returns {Promise<{ tables: string[], info: Object<string, { source: Object, target: Object }> }>}
 */
const compareSchemas = async (source, target) => {
	const sourceTables = await dataTables(source);
	const targetTables = await dataTables(target);
	const onlySource = sourceTables.filter((table) => !targetTables.includes(table));
	const onlyTarget = targetTables.filter((table) => !sourceTables.includes(table));
	if (onlySource.length > 0 || onlyTarget.length > 0) {
		throw mismatch(
			`The tables differ: only in the database in use: ${listed(onlySource)}; only in the target: ${listed(onlyTarget)}`,
		);
	}
	const sourceMigrations = new Set(await source(MIGRATIONS.tableName).pluck("name"));
	const targetMigrations = new Set(await target(MIGRATIONS.tableName).pluck("name"));
	const missing = [...sourceMigrations].filter((name) => !targetMigrations.has(name));
	const extra = [...targetMigrations].filter((name) => !sourceMigrations.has(name));
	if (missing.length > 0 || extra.length > 0) {
		throw mismatch(
			`The migrations differ: missing in the target: ${listed(missing)}; only in the target: ${listed(extra)}`,
		);
	}
	const info = {};
	for (const table of sourceTables) {
		const sourceInfo = await source(table).columnInfo();
		const targetInfo = await target(table).columnInfo();
		const a = Object.keys(sourceInfo).sort(byCode);
		const b = Object.keys(targetInfo).sort(byCode);
		if (a.join(",") !== b.join(",")) {
			throw mismatch(`The columns of ${table} differ: ${a.join(", ")} in use, ${b.join(", ")} in the target`);
		}
		info[table] = { source: sourceInfo, target: targetInfo };
	}
	return { tables: sourceTables, info };
};

export { compareSchemas, dataTables, foreignKeys, keyColumns, MIGRATION_TABLES, MIGRATIONS, runMigrations, tableOrder };
