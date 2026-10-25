import { global as logger } from "../logger.js";
import { isCrowdsecConfigured, parseCrowdsecConf, readCrowdsecConf } from "./crowdsec/config.js";

/**
 * Whether the Monitoring page has anything to show: traffic statistics are on (effective value, env included) or
 * the CrowdSec bouncer is configured (the condition of the CrowdSec tab). A source that cannot be read counts as off.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.getConfig    () => Promise<{values: {traffic_enabled: boolean}}> (getMonitoringConfig)
 * @param   {Function}  [deps.readConf]   () => Promise<string>  bouncer config text
 * @param   {Object}    [deps.log]
 * @returns {() => Promise<boolean>}
 */
const createMonitoringAvailable =
	({ getConfig, readConf = readCrowdsecConf, log = logger }) =>
	async () => {
		try {
			if ((await getConfig()).values.traffic_enabled) return true;
		} catch (err) {
			log.error(`Could not read the monitoring settings: ${err.message}`);
		}
		try {
			return isCrowdsecConfigured(parseCrowdsecConf(await readConf()));
		} catch (err) {
			log.error(`Could not read the CrowdSec config: ${err.message}`);
			return false;
		}
	};

export { createMonitoringAvailable };
