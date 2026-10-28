import { migrate as logger } from "../logger.js";

const migrateName = "backup_schedules";

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
	if (await knex.schema.hasTable("npmpro_backup_schedule")) {
		return;
	}
	await knex.schema.createTable("npmpro_backup_schedule", (table) => {
		table.increments().primary();
		table.dateTime("created_on").notNull();
		table.dateTime("modified_on").notNull();
		table.integer("owner_user_id").notNull().unsigned();
		table.string("name", 60).notNull();
		table.boolean("enabled").notNull().defaultTo(true);
		table.string("frequency", 10).notNull();
		table.integer("every_hours").nullable();
		table.string("time", 5).nullable();
		table.integer("weekday").nullable();
		table.integer("month_day").nullable();
		table.text("types").notNull();
		table.string("protection", 12).notNull();
		table.text("passphrase").nullable();
		table.integer("keep").notNull();
		table.dateTime("next_run_at").nullable();
		table.dateTime("last_run_at").nullable();
		table.string("last_status", 10).nullable();
		table.text("last_error").nullable();
		table.string("last_file", 255).nullable();
		table.bigInteger("last_size").nullable();
		table.integer("last_duration_ms").nullable();
		table.unique(["name"], { indexName: "npmpro_backup_schedule_name" });
	});

	logger.info(`[${migrateName}] npmpro_backup_schedule table created`);
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
