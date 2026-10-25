import { GEOIP_ENV_KEYS, MONITORING_ENV_KEYS } from "./monitoring-rules.js";
import { ENV_KEYS as OIDC_ENV_KEYS } from "./oidc-rules.js";
import { RUNTIME_RULES, SETTING_LOCK_REASONS, userSetNames } from "./runtime-rules.js";

const ENVIRONMENT_GROUPS = ["network", "users", "nginx", "modules", "goaccess", "database", "certificates-account"];

const GOACLA_DEFAULT =
	"--agent-list --real-os --double-decode --anonymize-ip --anonymize-level=1 --keep-last=30 --with-output-resolver --no-query-string";
const LETSENCRYPT_SERVER = "https://acme-v02.api.letsencrypt.org/directory";

const item = (group, name, fallback = "", secret = false) => ({
	group,
	name,
	default: secret ? null : fallback,
	secret,
	description_key: `environment.${group}.${name}`,
});

const flag = (group, name, fallback = "false") => item(group, name, fallback);
const secretItem = (group, name) => item(group, name, null, true);
// also a setting that applies after a restart (Settings section id): set by env it locks the setting, else the value
// shown is the one from the section the container started with
const settingItem = (group, name, fallback, section) => ({ ...item(group, name, fallback), setting: section });

/**
 * The startup (container) variables shown on the read-only Environment page. Variables that are also runtime
 * settings are not listed here (they are shown in their settings section). A variable is secret when its value is a
 * credential, personal data, or when it was not clear that it is safe to show: its value is then never returned.
 * The names must be listed in NPMPRO_STARTUP_ENVS in rootfs/usr/local/bin/envs.sh (checked by a test), so that values
 * filled in by its defaults do not look user-set.
 */
const ENVIRONMENT_ITEMS = [
	item("network", "NPM_PORT", "81"),
	item("network", "HTTP_PORT", "80"),
	item("network", "HTTPS_PORT", "443"),
	item("network", "IPV4_BINDING", "0.0.0.0"),
	item("network", "IPV6_BINDING", "[::]"),
	item("network", "NPM_IPV4_BINDING", "0.0.0.0"),
	item("network", "NPM_IPV6_BINDING", "[::]"),
	flag("network", "NPM_LISTEN_LOCALHOST"),
	flag("network", "DISABLE_IPV6"),
	flag("network", "DISABLE_HTTP"),
	flag("network", "DISABLE_H3_QUIC"),
	flag("network", "LISTEN_PROXY_PROTOCOL"),
	flag("network", "LISTEN_PROXY_PROTOCOL_HTTP"),
	flag("network", "LISTEN_PROXY_PROTOCOL_HTTPS"),
	flag("network", "ENABLE_MPTCP"),
	flag("network", "NGINX_QUIC_BPF"),
	flag("network", "NC_AIO"),
	item("network", "NC_DOMAIN"),

	item("users", "PUID", "0"),
	item("users", "PGID", "0"),
	settingItem("users", "TZ", "UTC", "advanced"),

	flag("nginx", "NGINX_LOG_NOT_FOUND"),
	item("nginx", "NGINX_WORKER_PROCESSES", "auto"),
	item("nginx", "NGINX_WORKER_CONNECTIONS", "512"),
	flag("nginx", "NGINX_FORCE_X25519MLKEM768"),
	flag("nginx", "NGINX_DISABLE_TLS12"),
	flag("nginx", "NGINX_TRUST_SECPR1", "true"),
	flag("nginx", "NGINX_TRUST_RSA_PKCS1"),

	flag("modules", "NGINX_LOAD_NJS_MODULE"),
	flag("modules", "NGINX_LOAD_LDAP_MODULE"),
	flag("modules", "NGINX_LOAD_NTLM_MODULE"),
	flag("modules", "NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE"),
	flag("modules", "PHP83"),
	flag("modules", "PHP84"),
	flag("modules", "PHP85"),
	item("modules", "PHP83_APKS"),
	item("modules", "PHP84_APKS"),
	item("modules", "PHP85_APKS"),
	item("modules", "PHP_APKS"),

	settingItem("goaccess", "GOA", "false", "monitoring"),
	item("goaccess", "GOACLA", GOACLA_DEFAULT),

	item("database", "DB_MYSQL_HOST"),
	item("database", "DB_MYSQL_PORT", "3306"),
	item("database", "DB_MYSQL_NAME"),
	secretItem("database", "DB_MYSQL_USER"),
	secretItem("database", "DB_MYSQL_PASSWORD"),
	item("database", "DB_POSTGRES_HOST"),
	item("database", "DB_POSTGRES_PORT", "5432"),
	item("database", "DB_POSTGRES_NAME"),
	secretItem("database", "DB_POSTGRES_USER"),
	secretItem("database", "DB_POSTGRES_PASSWORD"),
	secretItem("database", "INITIAL_ADMIN_EMAIL"),
	secretItem("database", "INITIAL_ADMIN_PASSWORD"),
	item("database", "INITIAL_DEFAULT_PAGE"),
	// read by entrypoint.sh, before envs.sh
	flag("database", "ENABLE_PRERUN"),

	item("certificates-account", "ACME_SERVER", LETSENCRYPT_SERVER),
	secretItem("certificates-account", "ACME_EMAIL"),
	secretItem("certificates-account", "ACME_EAB_KID"),
	secretItem("certificates-account", "ACME_EAB_HMAC_KEY"),
	item("certificates-account", "NODE_TLS_REJECT_UNAUTHORIZED"),
];

const ENVIRONMENT_NAMES = ENVIRONMENT_ITEMS.map((entry) => entry.name);

// the settings sections in menu order (runtime groups and the oidc, monitoring and geoip rows)
const LOCK_GROUP_ORDER = ["oidc", "certificates", "network", "forward-auth", "logs", "monitoring", "geoip", "advanced"];

const ENV_OF_RUNTIME = new Map(RUNTIME_RULES.map((rule) => [`${rule.group}/${rule.key}`, rule.env]));

/**
 * The runtime settings an env var locks, for the Environment page: one entry per locked key
 *
 * @param   {{group: string, key: string, env?: string, reason?: string|null}[]}  runtimeLocked  env: the variable that
 *          locks it (locked_by), else the key's own env var; reason: why another setting's variable locks it
 *          (locked_reason), null for a lock by its own variable
 * @returns {{group: string, key: string, env: string, reason: string|null}[]}
 */
const lockedRuntimeOf = (runtimeLocked) =>
	(runtimeLocked ?? [])
		.map(({ group, key, env, reason }) => ({
			group,
			key,
			env: env ?? ENV_OF_RUNTIME.get(`${group}/${key}`),
			reason: reason ?? null,
		}))
		// a lock caused by a setting (GoAccess report from the UI) is not set by an environment variable
		.filter((entry) => entry.env !== undefined && !SETTING_LOCK_REASONS.includes(entry.reason))
		.map((entry, index) => ({ entry, index }))
		// in the order of the settings menu, keeping the order inside a group
		.sort(
			(a, b) =>
				LOCK_GROUP_ORDER.indexOf(a.entry.group) - LOCK_GROUP_ORDER.indexOf(b.entry.group) || a.index - b.index,
		)
		.map(({ entry }) => entry);

/**
 * The OIDC, monitoring and GeoIP settings an env var locks, in the form of the runtime ones
 *
 * @param   {Object}  env  process.env or a test object
 * @param   {Object}  locked
 * @param   {string[]}  [locked.oidc]        mergeOidcConfig().locked
 * @param   {string[]}  [locked.monitoring]  mergeMonitoringConfig().locked
 * @param   {string[]}  [locked.geoip]       mergeGeoipConfig().locked
 * @returns {{group: string, key: string, env: string, reason: string|null}[]}
 */
const settingLocksOf = (env, { oidc = [], monitoring = [], geoip = [] } = {}) => {
	const entries = [];
	const add = (group, keys, names) => {
		for (const key of keys) {
			if (names[key]) entries.push({ group, key, env: names[key], reason: null });
		}
	};
	add("oidc", oidc, OIDC_ENV_KEYS);
	for (const key of monitoring) {
		if (key === "traffic_enabled" && env.LOGROTATE === "true") {
			// LOGROTATE=true turns traffic statistics on (mergeMonitoringConfig); without LOGROTATE from the user,
			// envs.sh set it for GOA=true, which is an env lock only when the user set GOA (else the GoAccess report
			// setting keeps it on: not listed)
			const userSet = userSetNames(env, ["LOGROTATE", "GOA"]);
			if (userSet.has("LOGROTATE") || env.GOA !== "true") {
				entries.push({ group: "monitoring", key, env: "LOGROTATE", reason: "write-log-files" });
			} else if (userSet.has("GOA")) {
				entries.push({ group: "monitoring", key, env: "GOA", reason: "write-log-files" });
			}
		} else {
			add("monitoring", [key], MONITORING_ENV_KEYS);
		}
	}
	add("geoip", geoip, GEOIP_ENV_KEYS);
	return entries;
};

/**
 * The Environment page data. A secret item has no `value` key, whether it is set or not.
 *
 * @param   {Object}  env            process.env or a test object
 * @param   {{group: string, key: string, env?: string, reason?: string|null}[]}  runtimeLocked  runtime settings
 *          locked by env, with the variable that locks each and the reason of an indirect lock
 * @returns {{groups: {id: string, items: Object[]}[], locked_runtime: {group: string, key: string, env: string, reason: string|null}[]}}
 */
const environmentInfo = (env, runtimeLocked) => {
	const userSet = userSetNames(env, ENVIRONMENT_NAMES);
	const groups = ENVIRONMENT_GROUPS.map((id) => ({
		id,
		items: ENVIRONMENT_ITEMS.filter((entry) => entry.group === id).map((entry) => {
			const set = userSet.has(entry.name);
			if (entry.secret) {
				return { name: entry.name, default: null, is_default: !set, secret: true, set };
			}
			if (entry.setting) {
				// a startup setting: without the variable, the value from the settings section the container runs with
				const value = env[entry.name] || entry.default;
				return {
					name: entry.name,
					value,
					default: entry.default,
					is_default: value === entry.default,
					secret: false,
					set,
					setting: entry.setting,
				};
			}
			const value = set ? env[entry.name] : entry.default;
			return {
				name: entry.name,
				value,
				default: entry.default,
				is_default: !set || value === entry.default,
				secret: false,
				set,
			};
		}),
	}));
	return { groups, locked_runtime: lockedRuntimeOf(runtimeLocked) };
};

export { ENVIRONMENT_GROUPS, ENVIRONMENT_ITEMS, ENVIRONMENT_NAMES, environmentInfo, LOCK_GROUP_ORDER, settingLocksOf };
