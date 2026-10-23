const OIDC_DEFAULTS = {
	enabled: false,
	issuer_url: "",
	client_id: "",
	redirect_domain: "",
	scopes: "openid email profile",
	require_verified_email: true,
	skip_mfa: false,
	disable_password: false,
	auto_create: {
		enabled: false,
		allowed_domains: [],
		permissions: {
			visibility: "user",
			proxy_hosts: "view",
			redirection_hosts: "view",
			dead_hosts: "view",
			streams: "view",
			access_lists: "view",
			certificates: "view",
		},
	},
	button: { label: "OIDC", color: "#206bc4", icon: { type: "builtin", name: "key" } },
};

const ENV_KEYS = {
	issuer_url: "OIDC_ISSUER_URL",
	client_id: "OIDC_CLIENT_ID",
	client_secret: "OIDC_CLIENT_SECRET",
	redirect_domain: "OIDC_REDIRECT_DOMAIN",
	require_verified_email: "OIDC_REQUIRE_VERIFIED_EMAIL",
	skip_mfa: "OIDC_SKIP_MFA",
	disable_password: "OIDC_DISABLE_PASSWORD",
};
const BOOLEAN_KEYS = new Set(["require_verified_email", "skip_mfa", "disable_password"]);
const CONNECTION_KEYS = ["issuer_url", "client_id", "client_secret", "redirect_domain"];

/**
 * Stored settings with env vars layered on top (env wins per field)
 *
 * @param   {Object}  stored  settings meta, client_secret decrypted or absent
 * @param   {Object}  env     process.env or a test object
 * @returns {{values: Object, locked: string[], active: boolean}}
 */
const mergeOidcConfig = (stored, env) => {
	const clean = Object.fromEntries(
		Object.entries(stored).filter(([, value]) => value !== null && value !== undefined),
	);
	const values = {
		...OIDC_DEFAULTS,
		...clean,
		auto_create: {
			...OIDC_DEFAULTS.auto_create,
			...clean.auto_create,
			permissions: { ...OIDC_DEFAULTS.auto_create.permissions, ...clean.auto_create?.permissions },
		},
		button: {
			...OIDC_DEFAULTS.button,
			...clean.button,
			icon: clean.button?.icon ?? OIDC_DEFAULTS.button.icon,
		},
	};
	const locked = [];
	for (const [key, name] of Object.entries(ENV_KEYS)) {
		const raw = env[name];
		if (raw === undefined || raw === "") continue;
		if (key === "require_verified_email") {
			values[key] = raw !== "false";
		} else {
			values[key] = BOOLEAN_KEYS.has(key) ? raw === "true" : raw;
		}
		locked.push(key);
	}
	const allFromEnv = CONNECTION_KEYS.every((key) => locked.includes(key));
	const complete = CONNECTION_KEYS.every((key) => Boolean(values[key]));
	return { values, locked, active: Boolean((values.enabled || allFromEnv) && complete) };
};

const callbackUrl = (redirectDomain) => `https://${redirectDomain}/api/oidc/callback`;

const emailDomainAllowed = (email, allowedDomains) => {
	const at = String(email).lastIndexOf("@");
	if (at < 1) return false;
	const domain = email.slice(at + 1).toLowerCase();
	if (!domain) return false;
	if (!Array.isArray(allowedDomains)) return false;
	if (allowedDomains.length === 0) return true;
	return allowedDomains.some(
		(allowed) => typeof allowed === "string" && allowed.trim() !== "" && allowed.trim().toLowerCase() === domain,
	);
};

/**
 * The same rules as the permissions API (internal/user.js setPermissions)
 *
 * @returns {string|null} error message or null when valid
 */
const validateDefaultPermissions = (p) => {
	if (p.proxy_hosts !== "hidden" && p.access_lists === "hidden") {
		return "Access lists can not be hidden while proxy hosts are visible";
	}
	if (
		p.certificates === "hidden" &&
		["proxy_hosts", "redirection_hosts", "dead_hosts", "streams"].some((type) => p[type] !== "hidden")
	) {
		return "Certificates can not be hidden while hosts are visible";
	}
	return null;
};

const stringClaim = (value) => (typeof value === "string" ? value.trim() : "");

const userNameFromClaims = (claims) =>
	stringClaim(claims.name) || stringClaim(claims.preferred_username) || String(claims.email).trim().split("@")[0];

export {
	callbackUrl,
	ENV_KEYS,
	emailDomainAllowed,
	mergeOidcConfig,
	OIDC_DEFAULTS,
	userNameFromClaims,
	validateDefaultPermissions,
};
