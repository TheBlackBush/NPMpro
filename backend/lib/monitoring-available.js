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

/**
 * Sets `monitoring` on the user of GET /users/:id when it is the requesting user: false for non-admins, else the
 * result of `available()`. Other users are returned unchanged.
 *
 * @param   {Object}    user          the loaded user row
 * @param   {number}    tokenUserId   id of the requesting user
 * @param   {Function}  available     createMonitoringAvailable() result
 * @returns {Promise<Object>}  the same user object
 */
const addMonitoringFlag = async (user, tokenUserId, available) => {
	if (user?.id !== tokenUserId) return user;
	user.monitoring = Boolean(user.roles?.includes("admin")) && (await available());
	return user;
};

export { addMonitoringFlag, createMonitoringAvailable };
