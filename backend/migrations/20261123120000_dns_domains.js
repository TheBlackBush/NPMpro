import { migrate as logger } from "../logger.js";

const migrateName = "dns_domains";

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
	if (!(await knex.schema.hasTable("npmpro_dns_domain"))) {
		await knex.schema.createTable("npmpro_dns_domain", (table) => {
			table.increments().primary();
			table.dateTime("created_on").notNull();
			table.dateTime("modified_on").notNull();
			// the owner is the credential's: a domain belongs to exactly one credential
			table.integer("dns_credential_id").unsigned().notNull();
			// lower case ASCII (punycode), no trailing dot; 253 so the unique index fits MySQL utf8mb4
			table.string("name", 253).notNull();
			// typed in the UI or fetched from the provider (PR 4)
			table.string("source", 16).notNull().defaultTo("typed");
			table
				.foreign("dns_credential_id", "npmpro_dns_domain_credential_fk")
				.references("npmpro_dns_credential.id")
				.onDelete("CASCADE");
			table.unique(["dns_credential_id", "name"], { indexName: "npmpro_dns_domain_credential_name" });
			table.index(["name"], "npmpro_dns_domain_name");
		});
	}
	logger.info(`[${migrateName}] npmpro_dns_domain table created`);
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
