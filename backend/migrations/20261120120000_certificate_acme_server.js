import { migrate as logger } from "../logger.js";

const migrateName = "certificate_acme_server";

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

	// MySQL DDL is not transactional, so a rerun after a partial run must work. The column is filled at the start
	// from the renewal confs (fillCertificateServers), which are files
	if (!(await knex.schema.hasColumn("certificate", "npmpro_acme_server"))) {
		await knex.schema.alterTable("certificate", (table) => {
			// the CA that issued the certificate (an ACME directory URL), null for custom and mTLS certificates
			table.string("npmpro_acme_server", 255).nullable().defaultTo(null);
		});
	}
	logger.info(`[${migrateName}] certificate.npmpro_acme_server column added`);
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
