import { migrate as logger } from "../logger.js";

const migrateName = "certificate_valid_from";

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
	if (!(await knex.schema.hasColumn("certificate", "npmpro_valid_from"))) {
		await knex.schema.alterTable("certificate", (table) => {
			// the start of the validity: the expiry window of a notification is a third of the lifetime at most;
			// null on old rows (the warning days alone apply) until the next renewal writes it
			table.dateTime("npmpro_valid_from").nullable();
		});
	}
	logger.info(`[${migrateName}] certificate.npmpro_valid_from added`);
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
