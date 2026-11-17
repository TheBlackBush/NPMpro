import { migrate as logger } from "../logger.js";

const migrateName = "api_tokens";

const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];

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

	// MySQL DDL is not transactional, so every step tolerates a partially applied earlier run
	if (!(await knex.schema.hasTable("npmpro_api_token"))) {
		await knex.schema.createTable("npmpro_api_token", (table) => {
			table.increments().primary();
			table.integer("user_id").notNull().unsigned();
			table.string("name", 100).notNull();
			table.string("lookup_id", 16).notNull();
			table.string("secret_hash", 64).notNull();
			table.string("visibility", 10).notNull();
			for (const section of SECTIONS) table.string(section, 10).notNull();
			table.boolean("is_admin").notNull().defaultTo(false);
			table.boolean("allow_delete").notNull().defaultTo(false);
			table.boolean("expiry_audited").notNull().defaultTo(false);
			// epoch seconds: the same value on every engine and time zone, and past 2038
			table.bigInteger("expires_on").nullable().defaultTo(null);
			table.bigInteger("last_used_on").nullable().defaultTo(null);
			table.bigInteger("created_on").notNull();
			table.unique(["lookup_id"], { indexName: "npmpro_api_token_lookup_id" });
			table.unique(["user_id", "name"], { indexName: "npmpro_api_token_user_name" });
			table.index(["user_id"], "npmpro_api_token_user_id");
		});
	}
	logger.info(`[${migrateName}] npmpro_api_token table created`);

	if (!(await knex.schema.hasColumn("audit_log", "npmpro_api_token_id"))) {
		await knex.schema.alterTable("audit_log", (table) => {
			table.integer("npmpro_api_token_id").unsigned().nullable().defaultTo(null);
			table.string("npmpro_api_token_name", 100).nullable().defaultTo(null);
		});
	}
	logger.info(`[${migrateName}] audit_log token columns added`);
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
