import { migrate as logger } from "../logger.js";

const migrateName = "host_tags";
const TABLES = ["proxy_host", "redirection_host", "dead_host", "stream"];

/**
 * Migrate: up to 10 tags per host on the four host types, a JSON list, empty for existing hosts
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	for (const table of TABLES) {
		await knex.schema.alterTable(table, (t) => {
			t.json("npmpro_tags").notNull().defaultTo([]);
		});
		logger.info(`[${migrateName}] ${table} Table altered`);
	}
};

/**
 * Undo Migrate
 *
 * @param   {Object} _knex
 * @returns {Promise}
 */
const down = (_knex) => {
	throw new Error(`[${migrateName}] You can't migrate down this one.`);
};

export { down, up };
