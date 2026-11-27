import { global as logger } from "../logger.js";
import settingModel from "../models/setting.js";
import { mergeGeoipConfig, mergeMonitoringConfig } from "./monitoring-rules.js";
import { defaultSecretBox } from "./secret-box.js";

let warnedSecret = false;
let warnedIgnoredEnv = false;

const readStored = async (id) => (await settingModel.query().where("id", id).first())?.meta ?? {};

const readStoredMonitoring = () => readStored("monitoring");
const readStoredGeoip = () => readStored("geoip");

/**
 * Effective monitoring configuration: stored settings with env overrides
 *
 * @returns {Promise<{values: Object, locked: string[]}>}
 */
const getMonitoringConfig = async () => mergeMonitoringConfig(await readStoredMonitoring(), process.env);

/**
 * Effective GeoIP configuration: stored settings, decrypted license key, env overrides.
 * values.license_key is plain text: callers must never return it.
 *
 * @returns {Promise<{values: Object, locked: string[], ignored: string[], secretError: boolean}>}
 */
const getGeoipConfig = async () => {
	const { license_key: encrypted, ...stored } = await readStoredGeoip();
	let secretError = false;
	if (encrypted && !process.env.GEOIP_LICENSE_KEY) {
		try {
			stored.license_key = defaultSecretBox.decrypt(encrypted);
		} catch (err) {
			secretError = true;
			if (!warnedSecret) logger.warn(`GeoIP license key cannot be decrypted: ${err.message}`);
			warnedSecret = true;
		}
	}
	return { ...mergeGeoipConfig(stored, process.env, { keySaved: Boolean(encrypted) }), secretError };
};

/**
 * Logs once per process that an invalid GEOIP_PROVIDER is ignored
 *
 * @param {{ignored: string[]}}  cfg  result of getGeoipConfig
 * @param {{warn: Function}}     [log]
 */
const logIgnoredGeoipEnv = (cfg, log = logger) => {
	if (warnedIgnoredEnv || !cfg.ignored?.includes("GEOIP_PROVIDER")) return;
	warnedIgnoredEnv = true;
	log.warn("GeoIP: GEOIP_PROVIDER must be dbip or maxmind, the value is ignored");
};

export { getGeoipConfig, getMonitoringConfig, logIgnoredGeoipEnv, readStoredGeoip, readStoredMonitoring };
