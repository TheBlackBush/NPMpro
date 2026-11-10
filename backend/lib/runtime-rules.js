import { isDeepStrictEqual } from "node:util";
import { isSet, KEY_SIZES, RUNTIME_RULES, serverOf, WHITESPACE } from "./runtime-rule-table.js";

const RUNTIME_GROUPS = ["certificates", "network", "nginx", "forward-auth", "logs", "advanced"];

/**
 * Why a key is locked by another setting's env var: key-size (key_type follows ACME_KEY_SIZE, the size is an ECDSA
 * curve or an RSA size), ocsp-stapling-off (Must-Staple is off because ACME_OCSP_STAPLING turns stapling off),
 * must-staple (OCSP stapling is required by ACME_MUST_STAPLE), goaccess (GoAccess, turned on by GOA, reads the log
 * files), goaccess-setting (the same with GoAccess turned on by the GoAccess report setting: not an env lock, left out
 * of the Environment page), force-mlkem (post-quantum only, turned on by NGINX_FORCE_X25519MLKEM768, turns TLS 1.2
 * and the NIST P curves off), force-mlkem-setting (the same with post-quantum only turned on by the setting)
 */
const LOCK_REASONS = [
	"key-size",
	"ocsp-stapling-off",
	"must-staple",
	"goaccess",
	"goaccess-setting",
	"force-mlkem",
	"force-mlkem-setting",
];
// reasons of locks that no env var set by the user causes
const SETTING_LOCK_REASONS = ["goaccess-setting", "force-mlkem-setting"];

/**
 * The settings that apply at the next container start (TZ, GOA): envs.sh reads them from the startup settings file
 */
const isRestartRule = (rule) => rule.applies === "restart";

// NPMPRO_RUNTIME_ENVS in envs.sh; the restart settings are startup variables there (NPMPRO_STARTUP_ENVS) and stay
// on the Environment page
const RUNTIME_ENV_NAMES = RUNTIME_RULES.filter((rule) => !isRestartRule(rule)).map((rule) => rule.env);
const RULE_ENV_NAMES = RUNTIME_RULES.map((rule) => rule.env);

/**
 * @param   {string}  group
 * @returns {Object[]}  the rules of the group, in table order
 */
const rulesOf = (group) => RUNTIME_RULES.filter((rule) => rule.group === group);

const isRuntimeGroup = (group) => RUNTIME_GROUPS.includes(group);

/**
 * The given env var names the user set (non-empty after trimming). envs.sh exports a default for most runtime env
 * vars, so it records the runtime names set before its defaults in NPMPRO_USER_ENV; without that list every non-empty
 * value counts as set.
 *
 * @param   {Object}    env
 * @param   {string[]}  names
 * @returns {Set<string>}
 */
const userSetNames = (env, names) => {
	const listed =
		typeof env.NPMPRO_USER_ENV === "string" ? new Set(env.NPMPRO_USER_ENV.split(WHITESPACE).filter(Boolean)) : null;
	return new Set(
		names.filter((name) => isSet(env[name]) && env[name].trim() !== "" && (listed === null || listed.has(name))),
	);
};

/**
 * @param   {Object}  env
 * @returns {Set<string>}  the env vars of the runtime settings (restart ones included) the user set
 */
const userSetEnvNames = (env) => userSetNames(env, RULE_ENV_NAMES);

const defaultOf = (rule, env, values, opts) =>
	typeof rule.default === "function" ? rule.default(env, values, opts) : rule.default;

/**
 * Stored runtime settings of one group with the env vars the user set layered on top (env wins per field)
 *
 * @param   {string}  group
 * @param   {Object}  stored            settings meta of the group row
 * @param   {Object}  env               process.env or a test object
 * @param   {Object}  [opts]
 * @param   {Function} [opts.fileExists] (path) => boolean, for the Anubis images default
 * @returns {{values: Object, locked: string[], locked_by: Object, locked_reason: Object, invalid: {key: string, source: "env"|"stored"|"server"}[]}}
 *          locked_by names the env var that locks each locked key (the key's own one, or the one that forces it:
 *          ACME_KEY_SIZE for key_type, ACME_OCSP_STAPLING / ACME_MUST_STAPLE for each other, GOA for write_log_files);
 *          locked_reason holds the keys locked by another setting's env var (an indirect lock) with why
 *          (LOCK_REASONS), a key locked by its own env var is not in it;
 *          invalid lists the values that could not be used (the caller logs them once); "server": a stored profile
 *          whose profile_server (the ACME server it was checked against) is not the current ACME_SERVER
 */
const mergeRuntimeConfig = (group, stored, env, opts = {}) => {
	const userSet = userSetEnvNames(env);
	const meta = stored ?? {};
	const values = {};
	const locked = [];
	const lockedBy = {};
	const lockedReason = {};
	const invalid = [];
	// reason: null for a lock by the key's own env var, else a LOCK_REASONS entry
	const lock = (key, name, reason = null) => {
		if (!locked.includes(key)) locked.push(key);
		lockedBy[key] = name;
		if (reason === null) delete lockedReason[key];
		else lockedReason[key] = reason;
	};

	for (const rule of rulesOf(group)) {
		if (userSet.has(rule.env)) {
			const value = rule.parseEnv(env[rule.env]);
			if (value !== undefined) {
				values[rule.key] = value;
				lock(rule.key, rule.env);
				continue;
			}
			invalid.push({ key: rule.key, source: "env" });
		}
		const own = meta[rule.key];
		if (group === "certificates" && rule.key === "profile" && own && meta.profile_server !== serverOf(env)) {
			// checked against another ACME server (ACME_SERVER changed since the save): it may not be offered there
			invalid.push({ key: rule.key, source: "server" });
			values[rule.key] = defaultOf(rule, env, values, opts);
			continue;
		}
		if (own !== undefined && own !== null) {
			if (rule.validate(own, values) === null) {
				values[rule.key] = own;
				continue;
			}
			invalid.push({ key: rule.key, source: "stored" });
		}
		values[rule.key] = defaultOf(rule, env, values, opts);
	}

	if (group === "certificates") {
		// A key size set alone runs with the envs.sh key type default (ecdsa), so only a curve passes envs.sh there;
		// the key type is locked to match the size (an rsa size alone, refused by envs.sh, locks rsa)
		if (locked.includes("key_size") && !locked.includes("key_type")) {
			values.key_type = KEY_SIZES.rsa.includes(values.key_size) ? "rsa" : "ecdsa";
			lock("key_type", "ACME_KEY_SIZE", "key-size");
		}
		if (locked.includes("ocsp_stapling") && !values.ocsp_stapling && !locked.includes("must_staple")) {
			// OCSP stapling switched off by env: must-staple certificates would fail without it
			values.must_staple = false;
			lock("must_staple", "ACME_OCSP_STAPLING", "ocsp-stapling-off");
		} else if (values.must_staple && !values.ocsp_stapling) {
			// envs.sh:793 must-staple forces OCSP stapling on
			values.ocsp_stapling = true;
			if (locked.includes("must_staple") && !locked.includes("ocsp_stapling")) {
				lock("ocsp_stapling", lockedBy.must_staple, "must-staple");
			}
		}
	}
	// envs.sh:827 GoAccess needs the log files
	if (group === "logs" && env.GOA === "true") {
		values.write_log_files = true;
		// GOA is what keeps it on, also when LOGROTATE is set; without GOA from the user it runs from the GoAccess
		// report setting (startup settings file), not from an env var
		lock("write_log_files", "GOA", userSet.has("GOA") ? "goaccess" : "goaccess-setting");
	}
	// envs.sh: post-quantum only turns TLS 1.2 and the NIST P curves off
	if (group === "nginx" && values.force_mlkem) {
		const reason = userSet.has("NGINX_FORCE_X25519MLKEM768") ? "force-mlkem" : "force-mlkem-setting";
		for (const key of ["tls12", "secp_curves"]) {
			values[key] = false;
			lock(key, "NGINX_FORCE_X25519MLKEM768", reason);
		}
	}

	return { values, locked, locked_by: lockedBy, locked_reason: lockedReason, invalid };
};

/**
 * process.env with the runtime settings of the given groups in env form, for every runtime env var the user did not
 * set. Groups missing from configs keep the env as it is.
 *
 * @param   {Object}  env      process.env or a test object
 * @param   {Object}  configs  { [group]: { values } }
 * @returns {Object}  a new object
 */
const buildEffectiveEnv = (env, configs) => {
	const out = { ...env };
	const userSet = userSetEnvNames(env);
	for (const rule of RUNTIME_RULES) {
		const config = configs?.[rule.group];
		// a restart setting keeps the value the container started with
		if (!config || userSet.has(rule.env) || isRestartRule(rule)) continue;
		const value = rule.toEnv(config.values[rule.key]);
		if (value === undefined) {
			delete out[rule.env];
		} else {
			out[rule.env] = value;
		}
	}
	return out;
};

/**
 * The value a restart setting runs with: the env var as envs.sh exported it at the start, else the default
 *
 * @param   {Object}  rule
 * @param   {Object}  env
 * @returns {*}
 */
const runningValueOf = (rule, env) => {
	const raw = env[rule.env];
	const value = isSet(raw) && raw.trim() !== "" ? rule.parseEnv(raw) : undefined;
	return value === undefined ? defaultOf(rule, env, {}) : value;
};

/**
 * The restart settings of a group whose value differs from the one the container runs with (the container needs a
 * restart to apply them); keys locked by env never differ
 *
 * @param   {string}    group
 * @param   {Object}    values  merged values
 * @param   {string[]}  locked
 * @param   {Object}    env     process.env (the values envs.sh exported at the start)
 * @returns {string[]}
 */
const restartPendingOf = (group, values, locked, env) =>
	rulesOf(group)
		.filter(
			(rule) =>
				isRestartRule(rule) &&
				!(locked ?? []).includes(rule.key) &&
				values?.[rule.key] !== undefined &&
				!isDeepStrictEqual(values[rule.key], runningValueOf(rule, env)),
		)
		.map((rule) => rule.key);

const STARTUP_SETTINGS_HEADER =
	"# Written by NPMpro when a startup setting is saved in Settings. envs.sh reads it (never sources it) for the variables the env does not set.\n";

/**
 * The startup settings file (rootfs/usr/local/bin/startup-settings.sh reads it): NAME=value per restart setting
 * whose env var the user did not set
 *
 * @param   {Object}  valuesByGroup  { [group]: merged values }
 * @param   {Object}  env
 * @returns {string}
 */
const renderStartupSettings = (valuesByGroup, env) => {
	const userSet = userSetEnvNames(env);
	const lines = RUNTIME_RULES.filter(isRestartRule)
		.filter((rule) => !userSet.has(rule.env) && valuesByGroup?.[rule.group]?.[rule.key] !== undefined)
		.map((rule) => `${rule.fileName ?? rule.env}=${rule.toEnv(valuesByGroup[rule.group][rule.key])}\n`);
	return STARTUP_SETTINGS_HEADER + lines.join("");
};

// the groups that have restart settings: the startup settings file holds the values of all of them
const RESTART_GROUPS = [...new Set(RUNTIME_RULES.filter(isRestartRule).map((rule) => rule.group))];

/**
 * @param   {Object}  env
 * @returns {string}  the ACME directory URL (ACME_SERVER, Let's Encrypt when unset)
 */
const acmeServerOf = (env) => serverOf(env);

/**
 * @param   {string}  group
 * @returns {Object}  { key: applies } for the group
 */
const appliesOf = (group) => Object.fromEntries(rulesOf(group).map((rule) => [rule.key, rule.applies]));

export { RUNTIME_RULES, UPSTREAM } from "./runtime-rule-table.js";
export {
	acmeServerOf,
	appliesOf,
	buildEffectiveEnv,
	isRestartRule,
	isRuntimeGroup,
	LOCK_REASONS,
	mergeRuntimeConfig,
	RESTART_GROUPS,
	RUNTIME_ENV_NAMES,
	RUNTIME_GROUPS,
	renderStartupSettings,
	restartPendingOf,
	rulesOf,
	SETTING_LOCK_REASONS,
	userSetEnvNames,
	userSetNames,
};
