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
	const warned = new Set();

	const warnInvalid = (group, invalid) => {
		for (const { key, source } of invalid) {
			const id = `${group}.${key}.${source}`;
			if (warned.has(id)) continue;
			warned.add(id);
			log.warn(
				source === "env"
					? `Runtime setting ${group}.${key}: the env value cannot be used, the stored value or the default applies`
					: `Runtime setting ${group}.${key}: the stored value is invalid, the default applies`,
			);
		}
	};

	/**
	 * @param   {string}  group
	 * @returns {Promise<{values: Object, locked: string[]}>}
	 */
	const getRuntimeConfig = async (group) => {
		if (!cache.has(group)) {
			const { values, locked, invalid } = mergeRuntimeConfig(group, await readStored(group), envOf(), opts);
			warnInvalid(group, invalid);
			cache.set(group, { values, locked });
		}
		return structuredClone(cache.get(group));
	};

	/**
	 * Drops the cached group (all groups without an argument); the next getRuntimeConfig() reads it again
	 *
	 * @param {string} [group]
	 */
	const invalidate = (group) => {
		if (group === undefined) {
			cache.clear();
		} else {
			cache.delete(group);
		}
	};

	/**
	 * Reads every group again (startup and tests)
	 *
	 * @returns {Promise<Object>}  { [group]: { values, locked } }
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

	return { effectiveEnv, getRuntimeConfig, invalidate, loadRuntimeConfig };
};

const defaultRuntimeConfig = createRuntimeConfig();
const { effectiveEnv, getRuntimeConfig, invalidate, loadRuntimeConfig } = defaultRuntimeConfig;

export { createRuntimeConfig, effectiveEnv, getRuntimeConfig, invalidate, loadRuntimeConfig };
