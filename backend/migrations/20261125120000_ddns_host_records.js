import { migrate as logger } from "../logger.js";

const migrateName = "ddns_host_records";

// knex has no portable "index exists"; a failed statement would abort a Postgres transaction, so ask first
const hasIndex = async (knex, tableName, indexName) => {
	const client = knex.client.config.client;
	if (client === "pg" || client === "postgresql") {
		const { rows } = await knex.raw(
			"select 1 from pg_indexes where schemaname = current_schema() and tablename = ? and indexname = ?",
			[tableName, indexName],
		);
		return rows.length > 0;
	}
	if (client === "mysql" || client === "mysql2" || client === "mariadb") {
		const [rows] = await knex.raw(
			"select 1 from information_schema.statistics where table_schema = database() and table_name = ? and index_name = ?",
			[tableName, indexName],
		);
		return rows.length > 0;
	}
	const rows = await knex.raw(`pragma index_list(${tableName})`);
	return rows.some((row) => row.name === indexName);
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

	// MySQL DDL is not transactional, so a rerun after a partial run must work
	if (!(await knex.schema.hasColumn("npmpro_ddns_record", "host_type"))) {
		await knex.schema.alterTable("npmpro_ddns_record", (table) => {
			// proxy_host, redirection_host or dead_host, checked by the service (three host tables, no foreign key)
			table.string("host_type", 32).nullable();
		});
	}
	if (!(await knex.schema.hasColumn("npmpro_ddns_record", "host_id"))) {
		await knex.schema.alterTable("npmpro_ddns_record", (table) => {
			table.integer("host_id").unsigned().nullable();
		});
	}
	if (!(await knex.schema.hasColumn("npmpro_ddns_record", "origin"))) {
		await knex.schema.alterTable("npmpro_ddns_record", (table) => {
			// created: NPMpro made the record; adopted: it existed and the user chose to take it over; null: a manual record
			table.string("origin", 16).nullable();
		});
	}
	logger.info(`[${migrateName}] npmpro_ddns_record host columns added`);

	if (!(await hasIndex(knex, "npmpro_ddns_record", "npmpro_ddns_record_host"))) {
		await knex.schema.alterTable("npmpro_ddns_record", (table) => {
			table.index(["host_type", "host_id"], "npmpro_ddns_record_host");
		});
	}
	logger.info(`[${migrateName}] npmpro_ddns_record_host index created`);
};

/**
 * Undo Migrate
 *
 * @param   {Object}  _knex
 * @returns {Promise}
 */
const down = (_knex) => {
	throw new Error(`[${migrateName}] You can't migrate down this one.`);
};

export { down, up };
