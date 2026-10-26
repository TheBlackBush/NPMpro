import { migrate as logger } from "../logger.js";

const migrateName = "traffic_indexes";

// [table, index prefix]: the bucket-only indexes duplicate the leading column of each unique index, and the per
// host views need host first
const TABLES = [
	["traffic_minute", "tm"],
	["traffic_hour", "th"],
	["traffic_country_hour", "tch"],
	["traffic_asn_hour", "tah"],
	["traffic_ip_hour", "tih"],
];

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

	// MySQL DDL is not transactional: each step may already be done by an earlier, interrupted run
	for (const [table, short] of TABLES) {
		if (!(await knex.schema.hasTable(table))) continue;
		try {
			await knex.schema.alterTable(table, (t) => t.dropIndex(["bucket"], `${short}_bucket`));
		} catch (err) {
			logger.info(`[${migrateName}] ${short}_bucket not dropped (${err.message})`);
		}
		try {
			await knex.schema.alterTable(table, (t) => t.index(["host", "bucket"], `${short}_hb`));
		} catch (err) {
			logger.info(`[${migrateName}] ${short}_hb not created (${err.message})`);
		}
	}

	logger.info(`[${migrateName}] traffic indexes updated`);
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
