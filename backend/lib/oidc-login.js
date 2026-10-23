import { validateDefaultPermissions } from "./oidc-rules.js";

const OIDC_ERROR_CODES = [
	"not_configured",
	"provider_error",
	"no_email",
	"email_not_verified",
	"no_user",
	"domain_not_allowed",
	"user_disabled",
];

/**
 * A login refusal with a code from OIDC_ERROR_CODES. The message stays server side.
 */
class OidcLoginError extends Error {
	constructor(code, message) {
		super(message || code);
		this.name = "OidcLoginError";
		this.code = OIDC_ERROR_CODES.includes(code) ? code : "provider_error";
	}
}

/**
 * Maps any error to a code that is safe to put in the login URL
 *
 * @param   {Error}   err
 * @returns {string}
 */
const oidcErrorCode = (err) => (err instanceof OidcLoginError ? err.code : "provider_error");

/**
 * @param   {string}  code
 * @returns {string}  login page path with the error code
 */
const oidcErrorUrl = (code) => `/login?oidc_error=${OIDC_ERROR_CODES.includes(code) ? code : "provider_error"}`;

/**
 * Checks the claims the login needs
 *
 * @param   {Object}  claims  id token claims merged with userinfo
 * @param   {Object}  values  effective OIDC settings
 * @returns {string|null}     error code or null when the claims are usable
 */
const claimsErrorCode = (claims, values) => {
	if (typeof claims?.email !== "string" || claims.email.trim() === "") return "no_email";
	if (values.require_verified_email && claims.email_verified !== true) return "email_not_verified";
	return null;
};

const PERMISSION_VALUES = {
	visibility: ["all", "user"],
	proxy_hosts: ["hidden", "view", "manage"],
	redirection_hosts: ["hidden", "view", "manage"],
	dead_hosts: ["hidden", "view", "manage"],
	streams: ["hidden", "view", "manage"],
	access_lists: ["hidden", "view", "manage"],
	certificates: ["hidden", "view", "manage"],
};

/**
 * Permission row values for an auto-created user
 *
 * @param   {Object}  permissions  auto_create.permissions from the effective settings
 * @returns {{permissions: Object|null, error: string|null}}
 */
const newUserPermissions = (permissions) => {
	const result = {};
	for (const [key, allowed] of Object.entries(PERMISSION_VALUES)) {
		const value = permissions?.[key];
		if (!allowed.includes(value)) return { permissions: null, error: `Invalid value for ${key}` };
		result[key] = value;
	}
	const error = validateDefaultPermissions(result);
	return error ? { permissions: null, error } : { permissions: result, error: null };
};

export { claimsErrorCode, newUserPermissions, OIDC_ERROR_CODES, OidcLoginError, oidcErrorCode, oidcErrorUrl };
