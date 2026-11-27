import { GEOIP_DIR, geoip } from "../lib/geoip/instance.js";
import { readProviderMarker, writeProviderMarker } from "../lib/geoip/marker.js";
import { getGeoipConfig, logIgnoredGeoipEnv, readStoredGeoip } from "../lib/monitoring-config.js";
import { global as logger } from "../logger.js";
import settingModel from "../models/setting.js";
import { reportGeoipState } from "./geoip-state.js";

/**
 * A provider change found at start (the env changed) starts clean, like a switch in Settings: the old provider's
 * error is cleared and geoip.failed is evaluated again. A failure is logged, never thrown.
 *
 * @param {Object} log
 */
const clearOldProviderError = async (log) => {
	try {
		const stored = await readStoredGeoip();
		if (stored.last_error) {
			await settingModel
				.query()
				.where("id", "geoip")
				.patch({ meta: { ...stored, last_error: null } });
		}
		await reportGeoipState({ log });
	} catch (err) {
		log.warn(`GeoIP: could not clear the error of the previous provider: ${err.message}`);
	}
};

/**
 * Makes the readers and the GoAccess marker follow the effective provider: logs an ignored GEOIP_PROVIDER once, points
 * the readers at the provider's files, writes the marker (a failure is logged, never thrown) and reloads the readers.
 * When the marker named another provider, the old provider's error and alert are cleared.
 *
 * @param   {Object}  [options]
 * @param   {Object}  [options.log]
 * @returns {Promise<string>}  the provider id
 */
const applyGeoipProvider = async ({ log = logger } = {}) => {
	const config = await getGeoipConfig();
	logIgnoredGeoipEnv(config, log);
	const { provider } = config.values;
	const previous = await readProviderMarker(GEOIP_DIR);
	geoip.setProvider(provider);
	try {
		await writeProviderMarker(GEOIP_DIR, provider);
	} catch (err) {
		log.warn(`GeoIP: could not write the provider marker: ${err.message}`);
	}
	if (previous !== null && previous !== provider) await clearOldProviderError(log);
	await geoip.reload();
	return provider;
};

export { applyGeoipProvider };
