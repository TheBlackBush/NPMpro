import { maintenance } from "../lib/database/maintenance.js";
import { global as logger } from "../logger.js";
import apiTokenModel from "../models/api_token.js";
import internalAuditLog from "./audit-log.js";

const USE_INTERVAL = 60;

/** @returns {number} the time in epoch seconds */
const nowSeconds = () => Math.floor(Date.now() / 1000);

const internalApiToken = {
	/**
	 * Writes last_used_on at most once a minute; the first use is audited. A failed write never fails the request,
	 * and nothing is written while a database move holds the writes.
	 *
	 * @param {Object} row  the token row of the request
	 * @param {number} [now]
	 */
	recordUse: async (row, now = nowSeconds()) => {
		if (row.last_used_on !== null && now - row.last_used_on < USE_INTERVAL) return;
		if (maintenance.active()) return;
		try {
			const query = apiTokenModel.query().where("id", row.id);
			if (row.last_used_on === null) query.whereNull("last_used_on");
			else query.where("last_used_on", row.last_used_on);
			const changed = await query.patch({ last_used_on: now });
			if (changed === 1 && row.last_used_on === null) {
				await internalAuditLog.add(null, {
					user_id: row.user_id,
					action: "first-used",
					object_type: "api-token",
					object_id: row.id,
					meta: { name: row.name },
					api_token: row,
				});
			}
		} catch (error) {
			logger.warn(`API token ${row.id}: the last use could not be stored: ${error.message}`);
		}
	},

	/**
	 * Audits every token that has expired and was not audited yet, once each
	 *
	 * @param   {number} [now]
	 * @returns {Promise<number>} how many were audited
	 */
	auditExpired: async (now = nowSeconds()) => {
		const rows = await apiTokenModel
			.query()
			.whereNotNull("expires_on")
			.where("expires_on", "<=", now)
			.where("expiry_audited", false);
		let audited = 0;
		for (const row of rows) {
			const claimed = await apiTokenModel
				.query()
				.where("id", row.id)
				.where("expiry_audited", false)
				.patch({ expiry_audited: true });
			if (claimed !== 1) continue;
			await internalAuditLog.add(null, {
				user_id: row.user_id,
				action: "expired",
				object_type: "api-token",
				object_id: row.id,
				meta: { name: row.name },
				api_token: row,
			});
			audited += 1;
		}
		return audited;
	},
};

export { nowSeconds };
export default internalApiToken;
