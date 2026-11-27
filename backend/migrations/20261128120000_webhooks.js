import { migrate as logger } from "../logger.js";

const migrateName = "webhooks";

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
	if (!(await knex.schema.hasTable("npmpro_webhook"))) {
		await knex.schema.createTable("npmpro_webhook", (table) => {
			table.increments().primary();
			table.dateTime("created_on").notNull();
			table.dateTime("modified_on").notNull();
			table.string("name", 100).notNull();
			// sealed, never returned
			table.text("url").notNull();
			// scheme, host, port and the first 40 characters of the path, no query
			table.string("url_hint", 253).notNull();
			// sealed whsec_ + base64 of 32 random bytes
			table.text("secret").notNull();
			// sealed; signed with too until previous_secret_until
			table.text("previous_secret").nullable();
			table.dateTime("previous_secret_until").nullable();
			// JSON text: a list of event ids, or ["*"]
			table.text("events").notNull();
			table.boolean("enabled").notNull().defaultTo(true);
			table.boolean("verify_tls").notNull().defaultTo(true);
			// gone (410), failing or restore
			table.string("disabled_reason", 16).nullable();
			table.dateTime("failing_since").nullable();
			table.dateTime("last_success_on").nullable();
			table.unique(["name"], { indexName: "npmpro_webhook_name" });
		});
	}
	logger.info(`[${migrateName}] npmpro_webhook table created`);
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
