import { readStoredGeoip } from "../lib/monitoring-config.js";
import { global as logger } from "../logger.js";
import accessListModel from "../models/access_list.js";
import { geoipConfFailsOpen, geoipRefusal, geoipStatus } from "./geoip-nginx.js";
import { notify } from "./notify.js";

/**
 * Why access lists have country rules that nginx does not apply: `missing` while no Country database is usable (rule
 * 12), `nginx` while one is usable but geoip.conf on disk is the fail-open variant (nginx -t refused the database line,
 * or the sync has not run yet); null when no list has a mode or the rules apply
 *
 * @returns {Promise<Object|null>}  the state source
 */
const countryRulesProblem = async () => {
	const lists = await accessListModel.query().whereNot("npmpro_geo_mode", "off").resultSize();
	if (lists === 0) return null;
	if (!(await geoipStatus()).available) return { reason: "missing" };
	if (!(await geoipConfFailsOpen())) return null;
	const error = geoipRefusal();
	return error ? { reason: "nginx", error } : { reason: "nginx" };
};

/**
 * Tells the notification layer whether the GeoIP databases are in order: the `geoip.failed` state is bad with the
 * reason `missing` or `nginx` while access lists have country rules that nginx does not apply (they win), else with
 * the reason `download` while the last update stored an error, else ok. Never throws, a notification problem must not
 * fail the caller.
 *
 * @param   {Object}  [options]
 * @param   {Object}  [options.log]
 * @returns {Promise<void>}
 */
const reportGeoipState = async ({ log = logger } = {}) => {
	try {
		const { last_error: error } = await readStoredGeoip();
		let source = (await countryRulesProblem()) ?? {};
		if (!source.reason && typeof error === "string" && error !== "") source = { reason: "download", error };
		await notify.reportState("geoip.failed", "geoip", {
			state: source.reason ? "bad" : "ok",
			source,
		});
	} catch (caught) {
		log.warn(`GeoIP notification failed: ${String(caught?.message ?? caught).slice(0, 200)}`);
	}
};

export { reportGeoipState };
