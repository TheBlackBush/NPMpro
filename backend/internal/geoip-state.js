import { readStoredGeoip } from "../lib/monitoring-config.js";
import { global as logger } from "../logger.js";
import accessListModel from "../models/access_list.js";
import { geoipConfFailsOpen, geoipStatus } from "./geoip-nginx.js";
import { notify } from "./notify.js";

/**
 * Whether access lists have country rules that nginx does not apply: no Country database is usable (rule 12), or the
 * geoip.conf on disk is the fail-open variant (nginx -t refused the database variant)
 *
 * @returns {Promise<boolean>}
 */
const countryRulesMissing = async () => {
	const lists = await accessListModel.query().whereNot("npmpro_geo_mode", "off").resultSize();
	if (lists === 0) return false;
	return !(await geoipStatus()).available || (await geoipConfFailsOpen());
};

/**
 * Tells the notification layer whether the GeoIP databases are in order: the `geoip.failed` state is bad with the
 * reason `missing` while access lists have country rules that nginx cannot apply (it wins), else with the reason
 * `download` while the last update stored an error, else ok. Never throws, a notification problem must not fail the
 * caller.
 *
 * @param   {Object}  [options]
 * @param   {Object}  [options.log]
 * @returns {Promise<void>}
 */
const reportGeoipState = async ({ log = logger } = {}) => {
	try {
		const { last_error: error } = await readStoredGeoip();
		let source = {};
		if (await countryRulesMissing()) source = { reason: "missing" };
		else if (typeof error === "string" && error !== "") source = { reason: "download", error };
		await notify.reportState("geoip.failed", "geoip", {
			state: source.reason ? "bad" : "ok",
			source,
		});
	} catch (caught) {
		log.warn(`GeoIP notification failed: ${String(caught?.message ?? caught).slice(0, 200)}`);
	}
};

export { reportGeoipState };
