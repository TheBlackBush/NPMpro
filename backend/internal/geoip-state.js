import { readStoredGeoip } from "../lib/monitoring-config.js";
import { global as logger } from "../logger.js";
import { notify } from "./notify.js";

/**
 * Tells the notification layer whether the GeoIP databases are in order: the `geoip.failed` state is bad with the
 * reason `download` while the last update stored an error, else ok. Never throws, a notification problem must not fail
 * the caller.
 *
 * @param   {Object}  [options]
 * @param   {Object}  [options.log]
 * @returns {Promise<void>}
 */
const reportGeoipState = async ({ log = logger } = {}) => {
	try {
		const { last_error: error } = await readStoredGeoip();
		const bad = typeof error === "string" && error !== "";
		await notify.reportState("geoip.failed", "geoip", {
			state: bad ? "bad" : "ok",
			source: bad ? { reason: "download", error } : {},
		});
	} catch (caught) {
		log.warn(`GeoIP notification failed: ${String(caught?.message ?? caught).slice(0, 200)}`);
	}
};

export { reportGeoipState };
