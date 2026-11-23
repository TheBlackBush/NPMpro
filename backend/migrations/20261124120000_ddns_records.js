import { migrate as logger } from "../logger.js";

const migrateName = "ddns_records";

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
	if (!(await knex.schema.hasTable("npmpro_ddns_record"))) {
		await knex.schema.createTable("npmpro_ddns_record", (table) => {
			table.increments().primary();
			table.dateTime("created_on").notNull();
			table.dateTime("modified_on").notNull();
			table.integer("owner_user_id").unsigned().notNull();
			// no cascade: a credential that a record uses cannot be deleted
			table.integer("dns_credential_id").unsigned().nullable();
			table.string("provider", 64).notNull();
			// the full record name, punycode; 253 so the unique index fits MySQL utf8mb4
			table.string("name", 253).notNull();
			table.string("zone", 253).notNull();
			// address: A/AAAA that follows the public IP; alias: a CNAME to the fixed target
			table.string("kind", 16).notNull().defaultTo("address");
			// the CNAME target of an alias (lower case, punycode, no trailing dot); null for an address record
			table.string("target", 253).nullable();
			table.string("ip_version", 8).notNull().defaultTo("ipv4");
			table.string("ipv6_suffix", 64).nullable();
			table.integer("ttl").nullable();
			table.boolean("enabled").notNull().defaultTo(true);
			table.string("state", 16).notNull().defaultTo("pending");
			table.string("last_ipv4", 45).nullable();
			table.string("last_ipv6", 45).nullable();
			table.dateTime("last_checked_on").nullable();
			table.dateTime("last_changed_on").nullable();
			table.dateTime("next_try_on").nullable();
			table.integer("failures").notNull().defaultTo(0);
			table.text("error").nullable();
			// JSON: provider ids and the Cloudflare proxied flag
			table.text("meta").nullable();
			// the sealed URL of the custom provider (used from PR 6)
			table.text("secret").nullable();
			table
				.foreign("dns_credential_id", "npmpro_ddns_record_credential_fk")
				.references("npmpro_dns_credential.id");
			table.unique(["name"], { indexName: "npmpro_ddns_record_name" });
			table.index(["dns_credential_id"], "npmpro_ddns_record_credential");
		});
	}
	logger.info(`[${migrateName}] npmpro_ddns_record table created`);

	if (!(await knex.schema.hasTable("npmpro_ddns_history"))) {
		await knex.schema.createTable("npmpro_ddns_history", (table) => {
			table.increments().primary();
			table.integer("ddns_record_id").unsigned().notNull();
			table.dateTime("created_on").notNull();
			// changed, created, failed, recovered
			table.string("kind", 16).notNull();
			table.string("ip_version", 8).nullable();
			table.string("old_ip", 45).nullable();
			table.string("new_ip", 45).nullable();
			table.text("message").nullable();
			table
				.foreign("ddns_record_id", "npmpro_ddns_history_record_fk")
				.references("npmpro_ddns_record.id")
				.onDelete("CASCADE");
			table.index(["ddns_record_id", "id"], "npmpro_ddns_history_record");
		});
	}
	logger.info(`[${migrateName}] npmpro_ddns_history table created`);
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
