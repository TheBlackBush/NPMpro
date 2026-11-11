import { statSync } from "node:fs";
import { isIP } from "node:net";
import { availableParallelism } from "node:os";
import { rooted } from "./paths.js";
import { isTimeZone } from "./time-zones.js";

const LETSENCRYPT_SERVER = "https://acme-v02.api.letsencrypt.org/directory";
// envs.sh: these servers default to must-staple and OCSP stapling on
const STAPLING_SERVERS = new Set(["https://dv.acme-v02.api.pki.goog/directory", "https://acme.zerossl.com/v2/DV90"]);
const KEY_SIZES = { ecdsa: ["secp256r1", "secp384r1", "secp521r1"], rsa: ["2048", "3072", "4096"] };
const DEFAULT_KEY_SIZE = { ecdsa: "secp384r1", rsa: "4096" };
const ANUBIS_IMAGES = ["happy", "reject", "pensive"].map((name) => rooted(`/data/public/anubis/${name}.webp`));
// no whitespace and no nginx syntax characters: the value is written into the config (frontend upstreamUrlPattern,
// the proxy host schema and envs.sh use the same rule)
const UPSTREAM = /^https?:\/\/(?:(?:[^\s/:;{}#"'$\\]+|\[[a-fA-F0-9:]+\]):[0-9]+|cu_[^\s/:;{}#"'$\\]+)$/u;
const PROFILE = /^[A-Za-z0-9._-]*$/u;
const DIGITS = /^\d+$/u;
const WHITESPACE = /\s+/u;
// envs.sh TRUST_IP charset
const TRUST_IP_CHARS = /^[0-9a-fA-F.:/]+$/u;

const TIME_VALUE = /^[0-9]+(?:ms|s|m|h|d|w|M|y)?(?:[0-9]+(?:ms|s|m|h|d|w|M|y))*$/u;

const TIME_TOKEN = /([0-9]+)(ms|s|m|h|d|w|M|y)?/gu;
const TIME_UNITS = ["y", "M", "w", "d", "h", "m", "s", "ms"];

// nginx's time parser: "0", or tokens of digits plus a unit with the units strictly decreasing, each at most once;
// a bare number (seconds) is only valid as the whole value
const isNginxTime = (value) => {
	if (typeof value !== "string" || value.length > 32 || !TIME_VALUE.test(value)) return false;
	if (value === "0") return true;
	const tokens = [...value.matchAll(TIME_TOKEN)];
	let last = -1;
	for (const [, , unit] of tokens) {
		if (unit === undefined) return tokens.length === 1;
		const index = TIME_UNITS.indexOf(unit);
		if (index <= last) return false;
		last = index;
	}
	return true;
};

const isSet = (raw) => typeof raw === "string" && raw !== "";

const serverOf = (env) => (isSet(env.ACME_SERVER) ? env.ACME_SERVER : LETSENCRYPT_SERVER);

const nonEmptyFile = (path) => {
	try {
		return statSync(path).size > 0;
	} catch {
		return false;
	}
};

const parseBool = (raw) => {
	if (raw === "true") return true;
	if (raw === "false") return false;
};

const parseDigits = (raw) => (DIGITS.test(raw) ? Number.parseInt(raw, 10) : undefined);

const validateBool = (value) => (typeof value === "boolean" ? null : "must be true or false");

const validateRange = (min, max) => (value) =>
	Number.isInteger(value) && value >= min && value <= max ? null : `must be a whole number from ${min} to ${max}`;

const validateUpstream = (value) => {
	if (typeof value !== "string") return "must be a string";
	if (value === "" || UPSTREAM.test(value)) return null;
	return "must be scheme://host:port or scheme://cu_name, without a path";
};

/**
 * One trusted IP entry: an IPv4/IPv6 address or a CIDR range
 *
 * @param   {string}  entry
 * @returns {boolean}
 */
const isTrustedIp = (entry) => {
	if (typeof entry !== "string" || !TRUST_IP_CHARS.test(entry)) return false;
	const parts = entry.split("/");
	if (parts.length > 2) return false;
	const version = isIP(parts[0]);
	if (version === 0) return false;
	if (parts.length === 1) return true;
	const prefix = parseDigits(parts[1]);
	return prefix !== undefined && prefix <= (version === 4 ? 32 : 128);
};

const validateTrustedIps = (value) => {
	if (!Array.isArray(value)) return "must be a list of IP addresses or CIDR ranges";
	const bad = value.find((entry) => !isTrustedIp(entry));
	return bad === undefined ? null : `"${bad}" is not an IPv4/IPv6 address or CIDR range`;
};

const boolRule = ({ group, key, env, fallback, applies, invert = false }) => ({
	group,
	key,
	env,
	type: "boolean",
	invert,
	validate: validateBool,
	parseEnv: (raw) => {
		const value = parseBool(raw);
		return value === undefined || !invert ? value : !value;
	},
	toEnv: (value) => String(invert ? !value : value),
	default: fallback,
	applies,
});

const rangeRule = ({ group, key, env, min, max, fallback, applies }) => ({
	group,
	key,
	env,
	type: "integer",
	// envs.sh only checks for digits on some of these: a set env var is taken as it is
	validate: validateRange(min, max),
	parseEnv: parseDigits,
	toEnv: String,
	default: fallback,
	applies,
});

const ANONYMIZE_LEVELS = ["off", "1", "2", "3"];

/**
 * The value of a GoAccess option in a GOACLA string (`--name=value` or `--name value`), the last one wins
 *
 * @param   {string}  raw
 * @param   {string}  name  with the leading dashes
 * @returns {string|undefined}
 */
const goaclaOption = (raw, name) => {
	const tokens = String(raw).trim().split(WHITESPACE);
	let value;
	for (const [index, token] of tokens.entries()) {
		if (token.startsWith(`${name}=`)) value = token.slice(name.length + 1);
		else if (token === name && index + 1 < tokens.length) value = tokens[index + 1];
	}
	return value;
};

const goaclaFlag = (raw, name) => String(raw).trim().split(WHITESPACE).includes(name);

// a GoAccess option that is one flag, on by default (today's default GOACLA has all of them)
const goaclaFlagRule = (key, flag) => ({
	group: "logs",
	key,
	env: "GOACLA",
	fileName: key,
	type: "boolean",
	validate: validateBool,
	parseEnv: (raw) => goaclaFlag(raw, flag),
	toEnv: String,
	default: true,
	applies: "restart",
});

// envs.sh: CPU threads, at most 4
const defaultWorkers = () => String(Math.min(availableParallelism(), 4));

const nginxSwitch = (key, env, fallback = false, invert = false) =>
	boolRule({ group: "nginx", key, env, fallback, invert, applies: "reload" });

const upstreamRule = (name, key) => ({
	group: "forward-auth",
	key,
	env: `AUTH_REQUEST_${name}_UPSTREAM`,
	type: "string",
	validate: validateUpstream,
	parseEnv: (raw) => (UPSTREAM.test(raw) ? raw : undefined),
	toEnv: (value) => value || undefined,
	default: "",
	applies: "reload",
});

/**
 * The runtime settings. validate(value, values) returns an error message or null (values: the other merged values
 * of the group, used by key_size). parseEnv(raw) returns the setting value or undefined when the env value cannot
 * be used. toEnv(value) returns the env form, undefined meaning unset. default is a value or
 * (env, values, opts) => value.
 */
const RUNTIME_RULES = [
	{
		group: "certificates",
		key: "key_type",
		env: "ACME_KEY_TYPE",
		type: "string",
		validate: (value) => (Object.hasOwn(KEY_SIZES, value) ? null : "must be ecdsa or rsa"),
		parseEnv: (raw) => (Object.hasOwn(KEY_SIZES, raw) ? raw : undefined),
		toEnv: String,
		default: "ecdsa",
		applies: "next-certificate",
	},
	{
		group: "certificates",
		key: "key_size",
		env: "ACME_KEY_SIZE",
		type: "string",
		validate: (value, values) => {
			const type = Object.hasOwn(KEY_SIZES, values?.key_type) ? values.key_type : "ecdsa";
			return KEY_SIZES[type].includes(value) ? null : `must be ${KEY_SIZES[type].join(", ")} for ${type}`;
		},
		parseEnv: (raw) => ([...KEY_SIZES.ecdsa, ...KEY_SIZES.rsa].includes(raw) ? raw : undefined),
		toEnv: String,
		default: (_env, values) => DEFAULT_KEY_SIZE[values?.key_type] ?? DEFAULT_KEY_SIZE.ecdsa,
		applies: "next-certificate",
	},
	{
		group: "certificates",
		key: "profile",
		env: "ACME_PROFILE",
		type: "string",
		// whether the ACME server offers it is checked when it is saved
		validate: (value) =>
			typeof value === "string" && value.length <= 64 && PROFILE.test(value)
				? null
				: "must be a profile name (letters, digits, dot, dash or underscore)",
		parseEnv: (raw) => (raw === "none" ? "" : raw),
		toEnv: (value) => value || "none",
		default: (env) => (serverOf(env) === LETSENCRYPT_SERVER ? "shortlived" : ""),
		applies: "next-certificate",
	},
	boolRule({
		group: "certificates",
		key: "must_staple",
		env: "ACME_MUST_STAPLE",
		fallback: (env) => STAPLING_SERVERS.has(serverOf(env)),
		applies: "next-certificate",
	}),
	boolRule({
		group: "certificates",
		key: "server_tls_verify",
		env: "ACME_SERVER_TLS_VERIFY",
		fallback: true,
		applies: "next-certificate",
	}),
	rangeRule({
		group: "certificates",
		key: "renewal_interval",
		env: "CERTBOT_RUN_INTERVAL",
		min: 1,
		max: 499,
		fallback: 3,
		applies: "immediately",
	}),
	boolRule({
		group: "certificates",
		key: "ocsp_stapling",
		env: "ACME_OCSP_STAPLING",
		fallback: (env) => STAPLING_SERVERS.has(serverOf(env)),
		applies: "reload",
	}),
	boolRule({
		group: "certificates",
		key: "custom_ocsp_stapling",
		env: "CUSTOM_OCSP_STAPLING",
		fallback: false,
		applies: "reload",
	}),
	{
		group: "certificates",
		key: "default_certificate_id",
		env: "DEFAULT_CERT_ID",
		type: "integer",
		// whether the certificate exists is checked when it is saved
		validate: (value) => (Number.isInteger(value) && value >= 0 ? null : "must be a certificate id or 0"),
		parseEnv: parseDigits,
		toEnv: String,
		default: 0,
		applies: "reload",
	},
	rangeRule({
		group: "certificates",
		key: "ech_rotation_interval",
		env: "ECH_ROTATION_INTERVAL",
		min: 1,
		max: 24,
		fallback: 1,
		applies: "immediately",
	}),
	{
		group: "network",
		key: "trusted_ips",
		env: "TRUST_IP",
		type: "list",
		validate: validateTrustedIps,
		parseEnv: (raw) => raw.trim().split(WHITESPACE).filter(Boolean),
		toEnv: (value) => (value.length > 0 ? value.join(" ") : undefined),
		default: () => [],
		applies: "reload",
	},
	boolRule({
		group: "network",
		key: "trust_cloudflare",
		env: "TRUST_CLOUDFLARE",
		fallback: false,
		applies: "reload",
	}),
	upstreamRule("ANUBIS", "anubis_upstream"),
	upstreamRule("TINYAUTH", "tinyauth_upstream"),
	upstreamRule("OAUTH2PROXY", "oauth2proxy_upstream"),
	upstreamRule("VOIDAUTH", "voidauth_upstream"),
	upstreamRule("AUTHELIA", "authelia_upstream"),
	upstreamRule("AUTHENTIK", "authentik_upstream"),
	boolRule({
		group: "forward-auth",
		key: "anubis_custom_images",
		env: "AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES",
		fallback: (_env, _values, opts) => ANUBIS_IMAGES.every(opts?.fileExists ?? nonEmptyFile),
		applies: "reload",
	}),
	boolRule({ group: "logs", key: "write_log_files", env: "LOGROTATE", fallback: false, applies: "reload" }),
	rangeRule({
		group: "logs",
		key: "log_rotations",
		env: "LOGROTATIONS",
		min: 1,
		max: 1000,
		fallback: 3,
		applies: "immediately",
	}),
	// startup settings (applies "restart"): written to the startup settings file, read by envs.sh at the next start
	boolRule({ group: "logs", key: "goaccess", env: "GOA", fallback: false, applies: "restart" }),
	// GoAccess options: envs.sh builds GOACLA from them with fixed flags; a GOACLA from the user locks them all
	{
		group: "logs",
		key: "goaccess_keep_days",
		env: "GOACLA",
		fileName: "goaccess_keep_days",
		type: "integer",
		validate: validateRange(1, 366),
		// null: GOACLA has no --keep-last (GoAccess keeps all data)
		parseEnv: (raw) => {
			const value = goaclaOption(raw, "--keep-last");
			return value === undefined ? null : (parseDigits(value) ?? null);
		},
		toEnv: String,
		default: 30,
		applies: "restart",
	},
	{
		group: "logs",
		key: "goaccess_anonymize",
		env: "GOACLA",
		fileName: "goaccess_anonymize",
		type: "string",
		validate: (value) => (ANONYMIZE_LEVELS.includes(value) ? null : `must be ${ANONYMIZE_LEVELS.join(", ")}`),
		parseEnv: (raw) => {
			if (!goaclaFlag(raw, "--anonymize-ip")) return "off";
			const level = goaclaOption(raw, "--anonymize-level");
			// GoAccess uses level 1 without --anonymize-level
			return ANONYMIZE_LEVELS.includes(level) && level !== "off" ? level : "1";
		},
		toEnv: String,
		default: "1",
		applies: "restart",
	},
	goaclaFlagRule("goaccess_drop_query_strings", "--no-query-string"),
	goaclaFlagRule("goaccess_real_os", "--real-os"),
	goaclaFlagRule("goaccess_resolve_hosts", "--with-output-resolver"),
	{
		group: "nginx",
		key: "worker_processes",
		env: "NGINX_WORKER_PROCESSES",
		type: "string",
		validate: (value) =>
			value === "auto" ||
			(DIGITS.test(String(value)) && Number(value) >= 1 && Number(value) <= availableParallelism())
				? null
				: `must be auto or a number from 1 to ${availableParallelism()}`,
		parseEnv: (raw) => (raw === "auto" || DIGITS.test(raw) ? raw : undefined),
		toEnv: String,
		default: defaultWorkers,
		applies: "reload",
	},
	rangeRule({
		group: "nginx",
		key: "worker_connections",
		env: "NGINX_WORKER_CONNECTIONS",
		min: 64,
		max: 65535,
		fallback: 512,
		applies: "reload",
	}),
	{
		group: "nginx",
		key: "worker_shutdown_timeout",
		env: "NGINX_WORKER_SHUTDOWN_TIMEOUT",
		type: "string",
		validate: (value) =>
			isNginxTime(value) ? null : "must be 0 or an nginx time value such as 30s, 10m, 1h or 1h30m",
		parseEnv: (raw) => (isNginxTime(raw) ? raw : undefined),
		toEnv: String,
		default: "1h",
		applies: "reload",
	},
	nginxSwitch("log_not_found", "NGINX_LOG_NOT_FOUND"),
	nginxSwitch("tls12", "NGINX_DISABLE_TLS12", true, true),
	nginxSwitch("force_mlkem", "NGINX_FORCE_X25519MLKEM768"),
	nginxSwitch("secp_curves", "NGINX_TRUST_SECPR1", true),
	nginxSwitch("rsa_pkcs1", "NGINX_TRUST_RSA_PKCS1"),
	nginxSwitch("module_njs", "NGINX_LOAD_NJS_MODULE"),
	nginxSwitch("module_ldap", "NGINX_LOAD_LDAP_MODULE"),
	nginxSwitch("module_ntlm", "NGINX_LOAD_NTLM_MODULE"),
	nginxSwitch("module_vts", "NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE"),
	boolRule({
		group: "advanced",
		key: "config_beautifier",
		env: "DISABLE_NGINX_BEAUTIFIER",
		fallback: true,
		applies: "immediately",
		invert: true,
	}),
	boolRule({
		group: "advanced",
		key: "gravatar",
		env: "DISABLE_GRAVATAR",
		fallback: true,
		applies: "immediately",
		invert: true,
	}),
	{
		group: "advanced",
		key: "time_zone",
		env: "TZ",
		type: "string",
		validate: (value) => (isTimeZone(value) ? null : "must be a time zone of the image, for example Europe/Berlin"),
		// as it is: envs.sh refuses a TZ without a zoneinfo file (it also accepts posix/ and right/ names)
		parseEnv: (raw) => raw,
		toEnv: String,
		// envs.sh without TZ from the env or the startup settings file
		default: "UTC",
		applies: "restart",
	},
];

export { isSet, KEY_SIZES, RUNTIME_RULES, serverOf, UPSTREAM, WHITESPACE };
