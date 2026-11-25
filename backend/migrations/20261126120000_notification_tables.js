import { migrate as logger } from "../logger.js";

const migrateName = "notification_tables";

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
	if (!(await knex.schema.hasTable("npmpro_notification_state"))) {
		await knex.schema.createTable("npmpro_notification_state", (table) => {
			table.increments().primary();
			// <event>:<object>; 191 so the unique index fits MySQL utf8mb4
			table.string("key", 191).notNull();
			table.string("event", 64).notNull();
			table.string("object_id", 64).notNull();
			// ok or a bad value (bad, soon, expired)
			table.string("state", 16).notNull();
			table.dateTime("since").notNull();
			table.dateTime("last_sent_on").nullable();
			// JSON text: the last whitelisted data, for reminders
			table.text("data").nullable();
			table.unique(["key"], { indexName: "npmpro_notification_state_key" });
		});
	}
	logger.info(`[${migrateName}] npmpro_notification_state table created`);

	if (!(await knex.schema.hasTable("npmpro_notification_delivery"))) {
		await knex.schema.createTable("npmpro_notification_delivery", (table) => {
			table.increments().primary();
			table.dateTime("created_on").notNull();
			table.dateTime("modified_on").notNull();
			// the envelope id, the same on every retry and redelivery
			table.string("message_id", 40).notNull();
			table.string("event", 64).notNull();
			// mail or webhook
			table.string("channel", 16).notNull();
			// the webhook id; null for mail
			table.integer("target_id").nullable();
			table.string("recipient", 254).nullable();
			// mail: alerts:<address>, rows due together go into one mail
			table.string("group_key", 191).nullable();
			// the envelope or the mail input (JSON text), cleared when sent
			table.text("payload").nullable();
			// pending, sending, sent, failed or dropped
			table.string("status", 16).notNull();
			table.integer("attempts").notNull().defaultTo(0);
			table.dateTime("next_try_on").nullable();
			table.integer("http_status").nullable();
			table.integer("duration_ms").nullable();
			table.string("error", 300).nullable();
			table.string("response", 2048).nullable();
			table.index(["status", "next_try_on"], "npmpro_notification_delivery_due");
			table.index(["channel", "target_id", "id"], "npmpro_notification_delivery_target");
			table.index(["message_id"], "npmpro_notification_delivery_message");
		});
	}
	logger.info(`[${migrateName}] npmpro_notification_delivery table created`);
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
