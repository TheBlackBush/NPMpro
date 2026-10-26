import { migrate as logger } from "../logger.js";

const migrateName = "session_revocation";

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
	if (await knex.schema.hasTable("session_revocation")) {
		return;
	}
	await knex.schema.createTable("session_revocation", (table) => {
		table.increments().primary();
		table.string("sid", 64).notNull();
		table.integer("expires_at").notNull();
		table.unique(["sid"], { indexName: "session_revocation_sid" });
		table.index(["expires_at"], "session_revocation_expires");
	});

	logger.info(`[${migrateName}] session_revocation table created`);
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
