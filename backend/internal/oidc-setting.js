import { discovery } from "openid-client";
import errs from "../lib/error.js";
import { clearDiscoveryCache, getOidcConfig, readStoredOidc } from "../lib/oidc-config.js";
import { checkIcon, downloadIcon, removeIconFiles, writeIconFile } from "../lib/oidc-icon.js";
import { callbackUrl, mergeOidcConfig, OIDC_DEFAULTS, validateDefaultPermissions } from "../lib/oidc-rules.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import { applyOidcUpdate, disablePasswordRefused, sanitizeOidcRow } from "./oidc-setting-rules.js";

const DISCOVERY_TIMEOUT_SECONDS = 10;
const TEST_KEYS = ["issuer_url", "client_id", "client_secret"];

/**
 * Upserts the `oidc` setting row
 *
 * @param {Object} meta
 */
const saveStored = async (meta) => {
	const existing = await settingModel.query().where("id", "oidc").first();
	if (existing) {
		await settingModel.query().where("id", "oidc").patch({ meta });
	} else {
		await settingModel.query().insert({
			id: "oidc",
			name: "OIDC",
			description: "OIDC login",
			value: "oidc",
			meta,
		});
	}
};

/**
 * Stores a new button icon value and audit logs the change (never the file content)
 *
 * @param {Access}  access
 * @param {Object}  icon
 * @param {string}  change  "uploaded", "downloaded" or "removed"
 */
const saveIcon = async (access, icon, change) => {
	const stored = await readStoredOidc();
	await saveStored({ ...stored, button: { ...stored.button, icon } });
	await internalAuditLog.add(access, {
		action: "updated",
		object_type: "setting",
		meta: { id: "oidc", icon: change },
	});
};

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

		await saveStored(next);
		clearDiscoveryCache();
		if (stored.button?.icon?.type === "file" && next.button?.icon?.type !== "file") await removeIconFiles();

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: { id: "oidc", ...sanitizeOidcRow(next) },
		});

		return internalOidcSetting.get(access);
	},

	/**
	 * Stores an icon file for the login button
	 *
	 * @param   {Access}  access
	 * @param   {Buffer}  buffer
	 * @param   {string}  [change]  audit value, "uploaded" or "downloaded"
	 * @returns {Promise<Object>}  the same as get()
	 */
	setIcon: async (access, buffer, change = "uploaded") => {
		access.canAdmin();
		if (!buffer) throw new errs.ValidationError("No icon file was sent");
		const ext = checkIcon(buffer);
		await writeIconFile(buffer, ext);
		await saveIcon(access, { type: "file", ext, updated_on: Date.now() }, change);
		return internalOidcSetting.get(access);
	},

	/**
	 * Downloads the icon from a URL and stores it
	 *
	 * @param   {Access}  access
	 * @param   {string}  url  http or https
	 * @returns {Promise<Object>}  the same as get()
	 */
	setIconFromUrl: async (access, url) => {
		access.canAdmin();
		return internalOidcSetting.setIcon(access, await downloadIcon(url), "downloaded");
	},

	/**
	 * Removes the icon file, the button falls back to the default builtin icon
	 *
	 * @param   {Access}  access
	 * @returns {Promise<Object>}  the same as get()
	 */
	deleteIcon: async (access) => {
		access.canAdmin();
		await removeIconFiles();
		await saveIcon(access, { ...OIDC_DEFAULTS.button.icon }, "removed");
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
