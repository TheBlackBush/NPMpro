import { migrate as logger } from "../logger.js";

const migrateName = "monitoring_visitors";

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

	// MySQL DDL is not transactional, so a rerun must be safe
	if (await knex.schema.hasTable("traffic_visitor")) {
		return;
	}
	await knex.schema.createTable("traffic_visitor", (table) => {
		table.increments().primary();
		table.integer("day").notNull();
		table.string("host", 255).notNull();
		table.string("hash", 32).notNull();
		table.unique(["day", "host", "hash"], { indexName: "tv_uq" });
		table.index(["day"], "tv_day");
	});

	logger.info(`[${migrateName}] traffic_visitor table created`);
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
