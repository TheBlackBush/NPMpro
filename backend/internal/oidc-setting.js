import { discovery } from "openid-client";
import errs from "../lib/error.js";
import { clearDiscoveryCache, getOidcConfig, readStoredOidc } from "../lib/oidc-config.js";
import { callbackUrl, mergeOidcConfig, OIDC_DEFAULTS, validateDefaultPermissions } from "../lib/oidc-rules.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import { applyOidcUpdate, disablePasswordRefused, sanitizeOidcRow } from "./oidc-setting-rules.js";

const DISCOVERY_TIMEOUT_SECONDS = 10;
const TEST_KEYS = ["issuer_url", "client_id", "client_secret"];

const internalOidcSetting = {
	/**
	 * Effective OIDC settings, never including the client secret
	 *
	 * @param   {Access}  access
	 * @returns {Promise<Object>}
	 */
	get: async (access) => {
		access.canAdmin();
		const cfg = await getOidcConfig();
		const { client_secret: secret, ...values } = cfg.values;
		return {
			...sanitizeOidcRow(values),
			client_secret_set: Boolean(secret) || cfg.secretError,
			locked: cfg.locked,
			active: cfg.active,
			secret_error: cfg.secretError,
			callback_url: cfg.values.redirect_domain ? callbackUrl(cfg.values.redirect_domain) : "",
			session_auth_method: access.token.getAuthMethod(),
		};
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  body  validated against the PUT schema
	 * @returns {Promise<Object>}  the same as get()
	 */
	update: async (access, body) => {
		access.canAdmin();
		const stored = await readStoredOidc();
		const { client_secret: _secret, ...storedPlain } = stored;
		const { values: current, locked } = mergeOidcConfig(storedPlain, process.env);

		if (disablePasswordRefused(body, locked, access.token.getAuthMethod(), current.disable_password)) {
			throw new errs.ValidationError(
				"Password login can only be disabled from a session that signed in with OIDC",
				"error.oidc-disable-password-session",
			);
		}

		const next = applyOidcUpdate(stored, body, locked, (secret) => defaultSecretBox.encrypt(secret));

		const permissionError = validateDefaultPermissions({
			...OIDC_DEFAULTS.auto_create.permissions,
			...next.auto_create?.permissions,
		});
		if (permissionError) throw new errs.ValidationError(permissionError);

		const existing = await settingModel.query().where("id", "oidc").first();
		if (existing) {
			await settingModel.query().where("id", "oidc").patch({ meta: next });
		} else {
			await settingModel.query().insert({
				id: "oidc",
				name: "OIDC",
				description: "OIDC login",
				value: "oidc",
				meta: next,
			});
		}
		clearDiscoveryCache();

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: { id: "oidc", ...sanitizeOidcRow(next) },
		});

		return internalOidcSetting.get(access);
	},

	/**
	 * Runs discovery with the effective configuration, or with the submitted unsaved
	 * issuer, client id and secret. Not cached.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  body  { issuer_url?, client_id?, client_secret? }
	 * @returns {Promise<{ok: true, issuer: string, authorization_endpoint: string}|{ok: false, message: string}>}
	 */
	test: async (access, body) => {
		access.canAdmin();
		const cfg = await getOidcConfig();
		const values = { ...cfg.values };
		for (const key of TEST_KEYS) {
			if (!cfg.locked.includes(key) && typeof body?.[key] === "string" && body[key] !== "")
				values[key] = body[key];
		}
		if (!(values.issuer_url && values.client_id)) {
			return { ok: false, message: "Issuer URL and client ID are required" };
		}
		try {
			const config = await discovery(
				new URL(values.issuer_url),
				values.client_id,
				values.client_secret,
				undefined,
				{
					timeout: DISCOVERY_TIMEOUT_SECONDS,
				},
			);
			const metadata = config.serverMetadata();
			return { ok: true, issuer: metadata.issuer, authorization_endpoint: metadata.authorization_endpoint };
		} catch (err) {
			return { ok: false, message: err.message };
		}
	},
};

export default internalOidcSetting;
