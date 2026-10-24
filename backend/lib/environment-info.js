import { RUNTIME_RULES, userSetNames } from "./runtime-rules.js";

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
	item("users", "TZ"),

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

	flag("goaccess", "GOA"),
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

	item("certificates-account", "ACME_SERVER", LETSENCRYPT_SERVER),
	secretItem("certificates-account", "ACME_EMAIL"),
	secretItem("certificates-account", "ACME_EAB_KID"),
	secretItem("certificates-account", "ACME_EAB_HMAC_KEY"),
	item("certificates-account", "NODE_TLS_REJECT_UNAUTHORIZED"),
];

const ENVIRONMENT_NAMES = ENVIRONMENT_ITEMS.map((entry) => entry.name);

const ENV_OF_RUNTIME = new Map(RUNTIME_RULES.map((rule) => [`${rule.group}/${rule.key}`, rule.env]));

/**
 * The runtime settings an env var locks, for the Environment page: one entry per locked key
 *
 * @param   {{group: string, key: string, env?: string}[]}  runtimeLocked  env: the variable that locks it (locked_by),
 *          else the key's own env var
 * @returns {{group: string, key: string, env: string}[]}
 */
const lockedRuntimeOf = (runtimeLocked) =>
	(runtimeLocked ?? [])
		.map(({ group, key, env }) => ({ group, key, env: env ?? ENV_OF_RUNTIME.get(`${group}/${key}`) }))
		.filter((entry) => entry.env !== undefined);

/**
 * The Environment page data. A secret item has no `value` key, whether it is set or not.
 *
 * @param   {Object}  env            process.env or a test object
 * @param   {{group: string, key: string, env?: string}[]}  runtimeLocked  runtime settings locked by env, with the
 *          variable that locks each
 * @returns {{groups: {id: string, items: Object[]}[], locked_runtime: {group: string, key: string, env: string}[]}}
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

export { ENVIRONMENT_GROUPS, ENVIRONMENT_ITEMS, ENVIRONMENT_NAMES, environmentInfo };
