import { global as logger } from "../logger.js";
import { buildEffectiveEnv, mergeRuntimeConfig, RUNTIME_GROUPS } from "./runtime-rules.js";

// Imported on first use, so this module loads without a database (tests)
const readSettingRow = async (group) => {
	const { default: settingModel } = await import("../models/setting.js");
	return (await settingModel.query().where("id", group).first())?.meta ?? {};
};

/**
 * Cached runtime settings per group
 *
 * @param   {Object}    [deps]
 * @param   {Function}  [deps.readStored]  (group) => stored meta
 * @param   {Object}    [deps.env]         read on every merge, defaults to process.env
 * @param   {Object}    [deps.log]         logger with warn()
 * @param   {Object}    [deps.opts]        passed to mergeRuntimeConfig
 */
const createRuntimeConfig = ({ readStored = readSettingRow, env, log = logger, opts } = {}) => {
	const envOf = () => env ?? process.env;
	const cache = new Map();
	const generations = new Map();
	const warned = new Set();

	const warnInvalid = (group, invalid) => {
		for (const { key, source } of invalid) {
			const id = `${group}.${key}.${source}`;
			if (warned.has(id)) continue;
			warned.add(id);
			const messages = {
				env: "the env value cannot be used, the stored value or the default applies",
				server: "the stored value was checked against another ACME server, the default applies",
				stored: "the stored value is invalid, the default applies",
			};
			log.warn(`Runtime setting ${group}.${key}: ${messages[source]}`);
		}
	};

	/**
	 * @param   {string}  group
	 * @returns {Promise<{values: Object, locked: string[], locked_by: Object}>}
	 */
	const getRuntimeConfig = async (group) => {
		if (cache.has(group)) return structuredClone(cache.get(group));
		const generation = generations.get(group) ?? 0;
		const { values, locked, locked_by, invalid } = mergeRuntimeConfig(
			group,
			await readStored(group),
			envOf(),
			opts,
		);
		warnInvalid(group, invalid);
		// a save (invalidate) while this read ran makes it stale: return it, but do not cache it
		if ((generations.get(group) ?? 0) === generation) cache.set(group, { values, locked, locked_by });
		return structuredClone({ values, locked, locked_by });
	};

	/**
	 * Drops the cached group (all groups without an argument); the next getRuntimeConfig() reads it again
	 *
	 * @param {string} [group]
	 */
	const invalidate = (group) => {
		for (const name of group === undefined ? RUNTIME_GROUPS : [group]) {
			cache.delete(name);
			generations.set(name, (generations.get(name) ?? 0) + 1);
		}
	};

	/**
	 * Caches the values a save stored, so effectiveEnv() never falls back to process.env for the group after a save; a
	 * read that started before it is not cached (generation)
	 *
	 * @param {string}  group
	 * @param {{values: Object, locked: string[], locked_by?: Object}}  cfg
	 */
	const prime = (group, { values, locked, locked_by = {} }) => {
		generations.set(group, (generations.get(group) ?? 0) + 1);
		cache.set(group, structuredClone({ values, locked, locked_by }));
	};

	/**
	 * Reads every group again (startup and tests)
	 *
	 * @returns {Promise<Object>}  { [group]: { values, locked, locked_by } }
	 */
	const loadRuntimeConfig = async () => {
		invalidate();
		const loaded = {};
		for (const group of RUNTIME_GROUPS) loaded[group] = await getRuntimeConfig(group);
		return loaded;
	};

	/**
	 * process.env with the loaded runtime settings for the env vars the user did not set
	 *
	 * @param   {Object}  [overrides]  { [group]: values } used instead of the cached values (an apply before the save)
	 * @returns {Object}  a new object
	 */
	const effectiveEnv = (overrides = {}) => {
		const configs = Object.fromEntries(cache);
		for (const [group, values] of Object.entries(overrides)) configs[group] = { values };
		return buildEffectiveEnv(envOf(), configs);
	};

	return { effectiveEnv, getRuntimeConfig, invalidate, loadRuntimeConfig, prime };
};

const defaultRuntimeConfig = createRuntimeConfig();
const { effectiveEnv, getRuntimeConfig, invalidate, loadRuntimeConfig, prime } = defaultRuntimeConfig;

/**
 * Whether nginx configs are beautified (advanced.config_beautifier) in the env a config is rendered with
 *
 * @param   {Object}  [env]  default effectiveEnv()
 * @returns {boolean}
 */
const beautifierOn = (env = effectiveEnv()) => env.DISABLE_NGINX_BEAUTIFIER === "false";

/**
 * Whether profile pictures are fetched from Gravatar (advanced.gravatar), read per call
 *
 * @param   {Object}  [env]  default effectiveEnv()
 * @returns {boolean}
 */
const gravatarOn = (env = effectiveEnv()) => env.DISABLE_GRAVATAR !== "true";

export {
	beautifierOn,
	createRuntimeConfig,
	effectiveEnv,
	getRuntimeConfig,
	gravatarOn,
	invalidate,
	loadRuntimeConfig,
	prime,
};
