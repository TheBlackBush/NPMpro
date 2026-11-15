import { migrate as logger } from "../logger.js";

const migrateName = "crowdsec_admin_ui";
// the choices of lib/crowdsec/settings.js ADMIN_UI_CHOICES, copied so that a later change there does not change what
// this migration did
const CHOICES = ["checked", "bans", "out"];

/**
 * Migrate: the CrowdSec switch "Leave the admin UI out of CrowdSec" (admin_ui_excluded) becomes the choice admin_ui:
 * on becomes bans (bans and captchas, no AppSec), off becomes checked. A row that already has a valid admin_ui keeps it,
 * an invalid one is replaced from the switch, as lib/crowdsec/settings.js adminUiOf reads it. Rows restored later from
 * older backups are read the same way by adminUiOf.
 *
 * @see https://knexjs.org/guide/migrations.html#migration-api
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	const row = await knex("setting").where("id", "crowdsec").first("meta");
	let meta;
	try {
		meta = typeof row?.meta === "string" ? JSON.parse(row.meta) : row?.meta;
	} catch {
		// a meta that is no JSON is left for the settings code to report: a migration that throws here would stop every
		// start (startup retries the migrations every second)
		logger.warn(`[${migrateName}] the crowdsec setting is no valid JSON, nothing to move`);
		return;
	}
	if (!meta || typeof meta !== "object" || !Object.hasOwn(meta, "admin_ui_excluded")) {
		logger.info(`[${migrateName}] nothing to move`);
		return;
	}
	const { admin_ui_excluded: excluded, ...rest } = meta;
	const fromSwitch = excluded === true ? "bans" : "checked";
	const next = { ...rest, admin_ui: CHOICES.includes(rest.admin_ui) ? rest.admin_ui : fromSwitch };
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
