/**
 * Pure rules for the OIDC settings API (no database access, so they can be unit tested)
 */

import errs from "../lib/error.js";
import { mergeOidcConfig } from "../lib/oidc-rules.js";

/**
 * Stored or effective OIDC values without the client secret in any form
 *
 * @param   {Object}  [meta]
 * @returns {Object}  meta without client_secret, plus client_secret_set
 */
const sanitizeOidcRow = (meta) => {
	const { client_secret: secret, ...rest } = meta ?? {};
	return { ...rest, client_secret_set: Boolean(secret) };
};

/**
 * Trim, lower-case, drop empty and dedupe
 *
 * @param   {string[]}  domains
 * @returns {string[]}
 */
const normalizeDomains = (domains) => [
	...new Set(
		(domains ?? [])
			.filter((domain) => typeof domain === "string")
			.map((domain) => domain.trim().toLowerCase())
			.filter(Boolean),
	),
];

/**
 * New stored meta from the current stored meta and a validated PUT body
 *
 * @param   {Object}    stored   current meta (client_secret encrypted)
 * @param   {Object}    body     validated request body
 * @param   {string[]}  locked   keys set by env vars, ignored in the body
 * @param   {Function}  encrypt  encrypts a plain client secret
 * @returns {Object}
 */
const applyOidcUpdate = (stored, body, locked, encrypt) => {
	const next = structuredClone(stored ?? {});
	for (const [key, value] of Object.entries(body ?? {})) {
		if (locked.includes(key)) continue;
		if (key === "client_secret") {
			if (typeof value === "string" && value !== "") next.client_secret = encrypt(value);
		} else if (key === "auto_create") {
			const autoCreate = { ...next.auto_create, ...value };
			if (value.permissions) autoCreate.permissions = { ...next.auto_create?.permissions, ...value.permissions };
			if (value.allowed_domains) autoCreate.allowed_domains = normalizeDomains(value.allowed_domains);
			next.auto_create = autoCreate;
		} else if (key === "button") {
			next.button = { ...next.button, ...value };
		} else {
			next[key] = value;
		}
	}
	// the stored client secret is only ever sent to the identity provider it was entered for
	const moved = ["issuer_url", "client_id"].some(
		(key) => !locked.includes(key) && stored?.[key] && (next[key] ?? "") !== stored[key],
	);
	const newSecret = typeof body?.client_secret === "string" && body.client_secret !== "";
	if (moved && stored?.client_secret && !newSecret && !locked.includes("client_secret")) {
		throw new errs.ValidationError(
			"Enter the client secret again when the issuer URL or client ID changes",
			"error.oidc-secret-required",
		);
	}
	return next;
};

/**
 * Whether password login ends up disabled for this stored meta: OIDC active and disable_password on
 *
 * @param   {Object}   meta          stored meta (client_secret in any form, only its presence counts)
 * @param   {Object}   env           process.env or a test object
 * @param   {boolean}  secretUsable  false when the stored secret cannot be decrypted
 * @returns {boolean}
 */
const passwordLoginDisabled = (meta, env, secretUsable = true) => {
	const { client_secret: secret, ...rest } = meta ?? {};
	const { values, active } = mergeOidcConfig(secretUsable && secret ? { ...rest, client_secret: secret } : rest, env);
	return active && values.disable_password === true;
};

/**
 * Password login may only be disabled from a session that signed in with OIDC. Refused from any other session:
 * turning disable_password on, and any save that makes password login disabled in effect (for example enabling
 * OIDC while a stored disable_password is on). Re-sending an already disabled value is allowed, and a
 * disable_password locked by env is the admin's choice, so it is never refused.
 *
 * @param   {Object}    body
 * @param   {string[]}  locked
 * @param   {string}    authMethod  "oidc" or "password"
 * @param   {Object}    state
 * @param   {boolean}   state.current   disable_password value before this save
 * @param   {boolean}   [state.before]  password login disabled in effect before this save
 * @param   {boolean}   [state.after]   password login disabled in effect after this save
 * @returns {boolean}
 */
const disablePasswordRefused = (body, locked, authMethod, { current, before = false, after = false }) => {
	if (authMethod === "oidc" || locked.includes("disable_password")) return false;
	const turningOn = body?.disable_password === true && current !== true;
	return turningOn || (!before && after);
};

export { applyOidcUpdate, disablePasswordRefused, normalizeDomains, passwordLoginDisabled, sanitizeOidcRow };
