import { applyCrowdsecFiles } from "../lib/crowdsec/files.js";
import { importCrowdsecFile } from "../lib/crowdsec/import.js";
import { getCrowdsecConfig, hasStoredCrowdsec } from "../lib/crowdsec/store.js";
import { global as logger } from "../logger.js";
import internalNginx from "./nginx.js";
import { runtimeExclusive } from "./runtime-queue.js";

/**
 * At every start: the one-time import, then crowdsec.conf and the two includes written from the row and checked with
 * nginx -t (the reload at the end of prepareApp loads them). A failed nginx -t puts the previous files back (the
 * bouncer stays as nginx loaded it) and is returned for the startup block. Never throws.
 *
 * @param   {Object} [deps]
 * @param   {Object} [deps.nginx]  { test }
 * @param   {Object} [deps.log]
 * @returns {Promise<{ values: Object, locked: string[], nginxError: string|null } | null>}  null when the row could
 *          not be read
 */
const startCrowdsec = async ({ nginx = internalNginx, log = logger } = {}) => {
	try {
		if (!(await hasStoredCrowdsec())) await importCrowdsecFile({ log });
		const cfg = await getCrowdsecConfig();
		if (cfg.invalid.length > 0) log.warn(`CrowdSec: ignored invalid values of ${cfg.invalid.join(", ")}`);
		if (cfg.secretError)
			log.warn("CrowdSec: a saved key cannot be decrypted, enter it again in Settings, CrowdSec");
		let nginxError = null;
		try {
			await runtimeExclusive(() => applyCrowdsecFiles(cfg.values, () => nginx.test()));
		} catch (err) {
			nginxError = err.message;
			log.error(`CrowdSec: the settings did not pass nginx -t and were not applied: ${err.message}`);
		}
		return { values: cfg.values, locked: cfg.locked, nginxError };
	} catch (err) {
		log.error(`Could not apply the CrowdSec settings at startup: ${err.message}`);
		return null;
	}
};

export { startCrowdsec };
