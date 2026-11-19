import { migrate as logger } from "../logger.js";

const migrateName = "acme_accounts";

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
	if (!(await knex.schema.hasTable("npmpro_acme_account"))) {
		await knex.schema.createTable("npmpro_acme_account", (table) => {
			table.increments().primary();
			// the ACME directory URL; 255 so the unique index fits MySQL utf8mb4
			table.string("server", 255).notNull();
			table.string("email", 255).nullable().defaultTo(null);
			// sealed with the secret box, both null once the account is registered
			table.text("eab_kid").nullable().defaultTo(null);
			table.text("eab_hmac_key").nullable().defaultTo(null);
			// certbot's account id (the folder name), null until registered
			table.string("account_id", 64).nullable().defaultTo(null);
			table.string("state", 16).notNull().defaultTo("pending");
			table.text("error").nullable().defaultTo(null);
			table.dateTime("registered_on").nullable().defaultTo(null);
			table.dateTime("created_on").notNull();
			table.dateTime("modified_on").notNull();
			table.unique(["server"], { indexName: "npmpro_acme_account_server" });
		});
	}
	logger.info(`[${migrateName}] npmpro_acme_account table created`);
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
