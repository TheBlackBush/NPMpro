import { migrate as logger } from "../logger.js";

const migrateName = "audit_log_index";
const INDEX = "audit_log_created_on_id";

/**
 * Migrate: the audit log page reads the newest rows, and it is the one table that keeps growing
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	// MySQL DDL is not transactional: the index may already exist from an earlier, interrupted run
	try {
		await knex.schema.alterTable("audit_log", (table) => table.index(["created_on", "id"], INDEX));
	} catch (err) {
		logger.info(`[${migrateName}] ${INDEX} not created (${err.message})`);
	}

	logger.info(`[${migrateName}] audit_log Table altered`);
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
