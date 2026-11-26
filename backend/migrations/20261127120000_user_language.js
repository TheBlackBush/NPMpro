import { migrate as logger } from "../logger.js";

const migrateName = "user_language";

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
	if (!(await knex.schema.hasColumn("user", "npmpro_language"))) {
		await knex.schema.alterTable("user", (table) => {
			// the UI language of the user (one of the 13 codes): mails go out in it; null until the first sign-in
			// with the new version, then the instance default applies
			table.string("npmpro_language", 8).nullable();
		});
	}
	logger.info(`[${migrateName}] user.npmpro_language added`);
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
