import { discovery } from "openid-client";
import { oidc as logger } from "../logger.js";
import settingModel from "../models/setting.js";
import { mergeOidcConfig } from "./oidc-rules.js";
import { defaultSecretBox } from "./secret-box.js";

const discoveryCache = new Map();
let warnedSecret = false;

const readStoredOidc = async () => (await settingModel.query().where("id", "oidc").first())?.meta ?? {};

/**
 * Effective OIDC configuration: stored settings, decrypted secret, env overrides
 *
 * @returns {Promise<{values: Object, locked: string[], active: boolean, secretError: boolean}>}
 */
const getOidcConfig = async () => {
	const { client_secret: encrypted, ...stored } = await readStoredOidc();
	let secretError = false;
	if (encrypted) {
		try {
			stored.client_secret = defaultSecretBox.decrypt(encrypted);
		} catch (err) {
			secretError = true;
			if (!warnedSecret) logger.warn(`OIDC client secret cannot be decrypted: ${err.message}`);
			warnedSecret = true;
		}
	}
	const merged = mergeOidcConfig(stored, process.env);
	if (secretError && !merged.locked.includes("client_secret")) merged.active = false;
	return { ...merged, secretError };
};

const getDiscovery = (values) => {
	const key = `${values.issuer_url}\n${values.client_id}`;
	if (!discoveryCache.has(key)) {
		const pending = discovery(new URL(values.issuer_url), values.client_id, values.client_secret).catch((err) => {
			discoveryCache.delete(key);
			throw err;
		});
		discoveryCache.set(key, pending);
	}
	return discoveryCache.get(key);
};

const clearDiscoveryCache = () => {
	discoveryCache.clear();
	warnedSecret = false;
};

export { clearDiscoveryCache, getDiscovery, getOidcConfig, readStoredOidc };
