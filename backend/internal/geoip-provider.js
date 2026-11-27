import { GEOIP_DIR, geoip } from "../lib/geoip/instance.js";
import { writeProviderMarker } from "../lib/geoip/marker.js";
import { getGeoipConfig, logIgnoredGeoipEnv } from "../lib/monitoring-config.js";
import { global as logger } from "../logger.js";

/**
 * Makes the readers and the GoAccess marker follow the effective provider: logs an ignored GEOIP_PROVIDER once, points
 * the readers at the provider's files, writes the marker (a failure is logged, never thrown) and reloads the readers.
 *
 * @param   {Object}  [options]
 * @param   {Object}  [options.log]
 * @returns {Promise<string>}  the provider id
 */
const applyGeoipProvider = async ({ log = logger } = {}) => {
	const config = await getGeoipConfig();
	logIgnoredGeoipEnv(config, log);
	const { provider } = config.values;
	geoip.setProvider(provider);
	try {
		await writeProviderMarker(GEOIP_DIR, provider);
	} catch (err) {
		log.warn(`GeoIP: could not write the provider marker: ${err.message}`);
	}
	await geoip.reload();
	return provider;
};

export { applyGeoipProvider };
