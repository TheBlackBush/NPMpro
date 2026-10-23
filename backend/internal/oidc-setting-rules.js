/**
 * Pure rules for the OIDC settings API (no database access, so they can be unit tested)
 */

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
	return next;
};

/**
 * Password login may only be disabled from a session that signed in with OIDC.
 * A locked disable_password is ignored in the body, so it is never refused.
 *
 * @param   {Object}    body
 * @param   {string[]}  locked
 * @param   {string}    authMethod  "oidc" or "password"
 * @returns {boolean}
 */
const disablePasswordRefused = (body, locked, authMethod) =>
	body?.disable_password === true && !locked.includes("disable_password") && authMethod !== "oidc";

export { applyOidcUpdate, disablePasswordRefused, normalizeDomains, sanitizeOidcRow };
