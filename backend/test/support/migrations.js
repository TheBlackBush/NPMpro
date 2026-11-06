import { readdir } from "node:fs/promises";
import { MIGRATIONS } from "../../lib/database/schema.js";

// recache_gravatars fetches avatars from the network and hard_delete removes avatar files below /data. Knex cannot pass
// them options, so the test source gives them a stand-in fetch and a throwaway root (db.dir).
// biome-ignore lint/security/noSecrets: a migration file name
const GRAVATARS = "20260913183435_recache_gravatars.js";
const HARD_DELETE = "20261010135653_hard_delete.js";

const migrationNames = async () => (await readdir(MIGRATIONS.directory)).filter((name) => name.endsWith(".js")).sort();

const sourceFor = (db) => ({
	getMigrations: migrationNames,
	getMigrationName: (name) => name,
	getMigration: async (name) => {
		const migration = await import(`${MIGRATIONS.directory}/${name}`);
		if (name === HARD_DELETE) return { ...migration, up: (knex) => migration.up(knex, { root: db.dir }) };
		if (name !== GRAVATARS) return migration;
		const fetchGravatar = () => "/images/default-avatar.jpg";
		return { ...migration, up: (knex) => migration.up(knex, { fetchGravatar }) };
	},
});

const configFor = (db) => ({
	tableName: MIGRATIONS.tableName,
	migrationSource: sourceFor(db),
});

/**
 * Builds a database of a given age: the migrations in knex's order, up to and including one file
 *
 * @param   {Object}  knex
 * @param   {Object}  db    the tempSqlite the knex belongs to
 * @param   {string}  last  file name, e.g. "20260802121623_unique_constraints.js"
 * @returns {Promise}
 */
const migrateThrough = async (knex, db, last) => {
	if (!(await migrationNames()).includes(last)) throw new Error(`no migration ${last}`);
	const config = configFor(db);
	for (;;) {
		const [done] = await knex.migrate.list(config);
		if (done.some((item) => (item.name ?? item) === last)) return;
		await knex.migrate.up(config);
	}
};

const migrateRest = (knex, db) => knex.migrate.latest(configFor(db));

// token_valid_after is added with the time of the migration as its default; the snapshot keeps a placeholder instead
const steady = (sql) =>
	sql.replace(/(npmpro_token_valid_after" bigint NOT NULL DEFAULT )'\d+'/u, "$1'<migration time>'");

/**
 * Every table, index and trigger as sqlite_master stores it, sorted; the migration bookkeeping is left out
 */
const schemaSnapshot = async (knex) => {
	const rows = await knex("sqlite_master")
		.select("type", "name", "tbl_name", "sql")
		.where("name", "not like", "sqlite_%")
		.where("tbl_name", "not like", "migrations%")
		.orderBy(["type", "name"]);
	return rows.map(({ type, name, tbl_name: table, sql }) => ({ type, name, table, sql: sql ? steady(sql) : null }));
};

export { migrateRest, migrateThrough, migrationNames, schemaSnapshot };
