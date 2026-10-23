import { createHash } from "node:crypto";
import { discovery } from "openid-client";
import { oidc as logger } from "../logger.js";
import settingModel from "../models/setting.js";
import { ENV_KEYS, mergeOidcConfig } from "./oidc-rules.js";
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
	const secretFromEnv = Boolean(process.env[ENV_KEYS.client_secret]);
	let secretError = false;
	if (encrypted && !secretFromEnv) {
		try {
			stored.client_secret = defaultSecretBox.decrypt(encrypted);
		} catch (err) {
			secretError = true;
			if (!warnedSecret) logger.warn(`OIDC client secret cannot be decrypted: ${err.message}`);
			warnedSecret = true;
		}
	}
	return { ...mergeOidcConfig(stored, process.env), secretError };
};

const getDiscovery = (values) => {
	const secretHash = createHash("sha256")
		.update(String(values.client_secret ?? ""))
		.digest("hex");
	const key = `${values.issuer_url}\n${values.client_id}\n${secretHash}`;
	if (!discoveryCache.has(key)) {
		const pending = Promise.resolve().then(() =>
			discovery(new URL(values.issuer_url), values.client_id, values.client_secret),
		);
		pending.catch(() => {
			if (discoveryCache.get(key) === pending) discoveryCache.delete(key);
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
