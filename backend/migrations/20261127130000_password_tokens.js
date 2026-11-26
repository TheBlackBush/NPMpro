import { migrate as logger } from "../logger.js";

const migrateName = "password_tokens";

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
	if (!(await knex.schema.hasTable("npmpro_password_token"))) {
		await knex.schema.createTable("npmpro_password_token", (table) => {
			table.increments().primary();
			table.integer("user_id").unsigned().notNull();
			// reset (30 minutes), later invite
			table.string("purpose", 16).notNull();
			// SHA-256 hex of the 32 random bytes; the clear token is never stored
			table.string("token_hash", 64).notNull();
			table.dateTime("created_on").notNull();
			table.dateTime("expires_on").notNull();
			table.dateTime("used_on").nullable();
			table.string("requested_ip", 45).nullable();
			table.foreign("user_id", "npmpro_password_token_user_fk").references("user.id").onDelete("CASCADE");
			table.unique(["token_hash"], { indexName: "npmpro_password_token_hash" });
			table.index(["user_id"], "npmpro_password_token_user");
		});
	}
	logger.info(`[${migrateName}] npmpro_password_token table created`);
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
