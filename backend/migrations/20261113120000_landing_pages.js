import { migrate as logger } from "../logger.js";

const migrateName = "landing_pages";

// the page choice of each place with its default, and its custom HTML (nullable: MySQL gives a TEXT column no default,
// and rows restored from older backups have none). 404 of a proxy host: "upstream", the upstream's own answer.
const PAGE_COLUMNS = {
	proxy_host: [
		["npmpro_page_not_found", "upstream"],
		["npmpro_page_upstream", "global"],
		["npmpro_page_maintenance", "global"],
	],
	dead_host: [["npmpro_page", "global"]],
	access_list: [["npmpro_denied_page", "global"]],
};

/**
 * Migrate: the landing page choices of proxy hosts, 404 hosts and access lists, and the proxy host's maintenance switch
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	// MySQL DDL is not transactional, so every column is checked on its own and a rerun is safe
	if (!(await knex.schema.hasColumn("proxy_host", "npmpro_maintenance"))) {
		await knex.schema.alterTable("proxy_host", (table) => {
			table.integer("npmpro_maintenance").notNull().unsigned().defaultTo(0);
		});
	}
	for (const [tableName, columns] of Object.entries(PAGE_COLUMNS)) {
		for (const [column, value] of columns) {
			if (!(await knex.schema.hasColumn(tableName, column))) {
				await knex.schema.alterTable(tableName, (table) => {
					table.string(column, 16).notNull().defaultTo(value);
				});
			}
			if (!(await knex.schema.hasColumn(tableName, `${column}_html`))) {
				await knex.schema.alterTable(tableName, (table) => {
					table.text(`${column}_html`, "mediumtext").nullable();
				});
			}
		}
		logger.info(`[${migrateName}] ${tableName} page columns added`);
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
