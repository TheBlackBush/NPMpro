import { migrate as logger } from "../logger.js";

const migrateName = "host_description";
// the host tables that get the description streams already have
const TABLES = ["proxy_host", "redirection_host", "dead_host"];

/**
 * Migrate: a one-line description on proxy, redirection and 404 hosts, empty for existing hosts
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
			t.string("npmpro_description", 255).notNull().defaultTo("");
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
