// The instance CA (an ACME directory URL), the presets the UI offers and the options a request to a CA carries. A
// leaf: lib/runtime-rule-table.js imports it, so it imports nothing of the runtime settings.

const LETSENCRYPT_SERVER = "https://acme-v02.api.letsencrypt.org/directory";
const LETSENCRYPT_STAGING_SERVER = "https://acme-staging-v02.api.letsencrypt.org/directory";
const ZEROSSL_SERVER = "https://acme.zerossl.com/v2/DV90";
const GOOGLE_SERVER = "https://dv.acme-v02.api.pki.goog/directory";

// the presets of Settings, Certificates (the labels are a frontend map); eab: the CA needs an External Account Binding
const ACME_PRESETS = [
	{ id: "letsencrypt", server: LETSENCRYPT_SERVER, eab: false },
	{ id: "letsencrypt-staging", server: LETSENCRYPT_STAGING_SERVER, eab: false },
	{ id: "zerossl", server: ZEROSSL_SERVER, eab: true },
	{ id: "google", server: GOOGLE_SERVER, eab: true },
];

// envs.sh: these CAs default to must-staple and OCSP stapling on
const STAPLING_SERVERS = new Set([GOOGLE_SERVER, ZEROSSL_SERVER]);

// a directory URL typed in the UI; rootfs/usr/local/bin/startup-settings.sh accepts the same characters
const DIRECTORY_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~/-]*)?$/u;
const MAX_URL_LENGTH = 255;
const WHITESPACE = /\s+/u;
const ACME_ENV_NAMES = ["ACME_SERVER", "ACME_EMAIL", "ACME_EAB_KID", "ACME_EAB_HMAC_KEY", "ACME_PROFILE"];

/**
 * @param   {*}  value
 * @returns {boolean}  an https ACME directory URL NPMpro stores (also what envs.sh reads back at the start)
 */
const isDirectoryUrl = (value) =>
	typeof value === "string" && value.length <= MAX_URL_LENGTH && DIRECTORY_URL.test(value);

/**
 * The ACME variables the user set: non-empty, and listed in NPMPRO_USER_ENV when envs.sh ran (envs.sh exports
 * ACME_SERVER itself, from the startup settings or its default)
 *
 * @param   {Object}  env
 * @returns {Set<string>}
 */
const acmeEnvSet = (env) => {
	const listed =
		typeof env.NPMPRO_USER_ENV === "string" ? new Set(env.NPMPRO_USER_ENV.split(WHITESPACE).filter(Boolean)) : null;
	return new Set(
		ACME_ENV_NAMES.filter(
			(name) => typeof env[name] === "string" && env[name].trim() !== "" && (listed === null || listed.has(name)),
		),
	);
};

// undefined: not loaded yet (the start), null: Let's Encrypt, else the stored directory URL
let stored;

/** @returns {undefined|null|string} */
const storedAcmeServer = () => stored;

/**
 * @param {undefined|null|string} value  the `acme` setting's server; undefined forgets it (tests)
 */
const setStoredAcmeServer = (value) => {
	if (value === undefined) stored = undefined;
	else stored = isDirectoryUrl(value) && value !== LETSENCRYPT_SERVER ? value : null;
};

/**
 * The instance CA: a user-set ACME_SERVER, else the stored value, else (not loaded yet) the value envs.sh exported
 * from the startup settings, else Let's Encrypt
 *
 * @param   {Object}                 env
 * @param   {undefined|null|string}  [storedValue]
 * @returns {string}
 */
const resolveAcmeServer = (env, storedValue = stored) => {
	if (acmeEnvSet(env).has("ACME_SERVER")) return env.ACME_SERVER;
	if (storedValue === null) return LETSENCRYPT_SERVER;
	if (typeof storedValue === "string") return storedValue;
	return isDirectoryUrl(env.ACME_SERVER) ? env.ACME_SERVER : LETSENCRYPT_SERVER;
};

/**
 * @returns {boolean}  the URL is the ACME_SERVER the operator set: read without the outbound guard (D6)
 */
const isTrustedServer = (server, env) => acmeEnvSet(env).has("ACME_SERVER") && env.ACME_SERVER === server;

const isZeroSsl = (server) => {
	try {
		return new URL(server).hostname === "acme.zerossl.com";
	} catch {
		return false;
	}
};

/** @returns {string|null}  the preset id of a directory URL */
const presetOf = (server) => ACME_PRESETS.find((preset) => preset.server === server)?.id ?? null;

/**
 * What a request to a CA passes (certbot then keeps it in the renewal conf): the instance profile and must-staple on
 * the instance CA, else that CA's defaults (must-staple on the stapling CAs, no required profile)
 *
 * @param   {string}  server    the certificate's CA
 * @param   {string}  instance  the instance CA
 * @param   {Object}  values    the certificates runtime values (profile, must_staple)
 * @returns {{profile: string, must_staple: boolean}}
 */
const requestOptionsFor = (server, instance, values) =>
	server === instance
		? { profile: values.profile ?? "", must_staple: values.must_staple === true }
		: { profile: "", must_staple: STAPLING_SERVERS.has(server) };

export {
	ACME_PRESETS,
	acmeEnvSet,
	GOOGLE_SERVER,
	isDirectoryUrl,
	isTrustedServer,
	isZeroSsl,
	LETSENCRYPT_SERVER,
	LETSENCRYPT_STAGING_SERVER,
	presetOf,
	requestOptionsFor,
	resolveAcmeServer,
	STAPLING_SERVERS,
	setStoredAcmeServer,
	storedAcmeServer,
	ZEROSSL_SERVER,
};
