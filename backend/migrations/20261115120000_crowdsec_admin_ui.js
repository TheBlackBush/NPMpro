import { migrate as logger } from "../logger.js";

const migrateName = "crowdsec_admin_ui";

/**
 * Migrate: the CrowdSec switch "Leave the admin UI out of CrowdSec" (admin_ui_excluded) becomes the choice admin_ui:
 * on becomes bans (bans and captchas, no AppSec), off becomes checked. A row that already has admin_ui keeps it. Rows
 * restored later from older backups are read the same way by lib/crowdsec/settings.js adminUiOf.
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	const row = await knex("setting").where("id", "crowdsec").first("meta");
	const meta = typeof row?.meta === "string" ? JSON.parse(row.meta) : row?.meta;
	if (!meta || !Object.hasOwn(meta, "admin_ui_excluded")) {
		logger.info(`[${migrateName}] nothing to move`);
		return;
	}
	const { admin_ui_excluded: excluded, ...rest } = meta;
	const next = { ...rest, admin_ui: rest.admin_ui ?? (excluded === true ? "bans" : "checked") };
	await knex("setting")
		.where("id", "crowdsec")
		.update({ meta: JSON.stringify(next) });
	logger.info(`[${migrateName}] the admin UI choice is ${next.admin_ui}`);
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
