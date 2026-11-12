import { migrate as logger } from "../logger.js";

const migrateName = "oidc_identity_link";
const INDEX = "npmpro_user_oidc_identity";
// an index that is already there: SQLite and Postgres say "already exists", MySQL "Duplicate key name"
const INDEX_EXISTS = /exists|duplicate/iu;

/**
 * Migrate: the OIDC identity (issuer and subject) each user is linked to
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	// MySQL DDL is not transactional, so a rerun must be safe
	if (!(await knex.schema.hasColumn("user", "npmpro_oidc_subject"))) {
		await knex.schema.alterTable("user", (table) => {
			table.string("npmpro_oidc_issuer", 255).nullable();
			table.string("npmpro_oidc_subject", 255).nullable();
			table.dateTime("npmpro_oidc_linked_on").nullable();
		});
		logger.info(`[${migrateName}] user link columns added`);
	}

	// several unlinked users (NULL pairs) are allowed by the unique index on every supported database
	try {
		await knex.schema.alterTable("user", (table) => {
			table.unique(["npmpro_oidc_issuer", "npmpro_oidc_subject"], { indexName: INDEX });
		});
		logger.info(`[${migrateName}] ${INDEX} created`);
	} catch (err) {
		if (!INDEX_EXISTS.test(String(err.message))) throw err;
	}
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
