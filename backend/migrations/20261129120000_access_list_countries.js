import { migrate as logger } from "../logger.js";

const migrateName = "access_list_countries";

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
	const listColumns = [
		["npmpro_geo_mode", (table) => table.string("npmpro_geo_mode", 8).notNull().defaultTo("off")],
		["npmpro_geo_unknown", (table) => table.string("npmpro_geo_unknown", 8).notNull().defaultTo("auto")],
		["npmpro_geo_drop", (table) => table.boolean("npmpro_geo_drop").notNull().defaultTo(false)],
	];
	for (const [name, add] of listColumns) {
		if (!(await knex.schema.hasColumn("access_list", name))) {
			await knex.schema.alterTable("access_list", add);
		}
	}
	if (!(await knex.schema.hasColumn("access_list_client", "npmpro_comment"))) {
		await knex.schema.alterTable("access_list_client", (table) => {
			table.string("npmpro_comment", 255).notNull().defaultTo("");
		});
	}
	if (!(await knex.schema.hasTable("npmpro_access_list_country"))) {
		await knex.schema.createTable("npmpro_access_list_country", (table) => {
			table.increments().primary();
			table.dateTime("created_on").notNull();
			table.dateTime("modified_on").notNull();
			table
				.integer("access_list_id")
				.unsigned()
				.notNull()
				.references("id")
				.inTable("access_list")
				.onDelete("CASCADE");
			table.string("country", 2).notNull();
			table.string("npmpro_comment", 255).notNull().defaultTo("");
			table.unique(["access_list_id", "country"], { indexName: "npmpro_access_list_country_list_country" });
		});
	}
	logger.info(`[${migrateName}] access list country rules and rule comments added`);
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
