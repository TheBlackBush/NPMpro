import { lockedByOf } from "../lib/environment-info.js";
import {
	getGeoipConfig,
	getMonitoringConfig,
	readStoredGeoip,
	readStoredMonitoring,
} from "../lib/monitoring-config.js";
import { mergeGeoipConfig, sanitizeGeoipMeta } from "../lib/monitoring-rules.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { deleteIps } from "../lib/traffic/store.js";
import { global as logger } from "../logger.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import { applyGeoipProvider } from "./geoip-provider.js";
import { reportGeoipState } from "./geoip-state.js";
import { createMonitoringUpdater, pickEditable } from "./monitoring-update.js";

const noop = async () => {};

// Filled in by the traffic reader (access log switch) and the GeoIP updater
const hooks = {
	onTrafficEnabledChange: noop,
	onDeleteStats: () => Promise.reject(new Error("traffic statistics are not available")),
	onShowIpsOff: noop,
	onShowIpsOn: noop,
	onUniqueVisitorsOff: noop,
	onUniqueVisitorsOn: noop,
	onGeoipCredentialsChange: noop,
	runGeoipUpdate: async () => ({ ok: false, error: "GeoIP updater not available" }),
};

/**
 * Replaces the given hooks, unknown names are ignored
 *
 * onTrafficEnabledChange(enabled) runs before the new value is saved: when it throws, nothing is saved;
 * when the save fails afterwards, it runs again with the previous value.
 * onDeleteStats() deletes all stored statistics: it runs before the save, after onTrafficEnabledChange(false), only
 * when the body has delete_stats: true (a throw saves nothing).
 * onShowIpsOff() runs after the saved IPs were deleted. onShowIpsOn() runs after show_ips was saved as on. onGeoipCredentialsChange() runs after saving.
 * onUniqueVisitorsOff() runs before the save when unique_visitors goes off (a throw saves nothing). onUniqueVisitorsOn() runs after unique_visitors was saved as on.
 * runGeoipUpdate() returns { ok, updated, error }.
 *
 * @param {Object} next
 */
const setMonitoringHooks = (next) => {
	for (const name of Object.keys(hooks)) {
		if (typeof next?.[name] === "function") hooks[name] = next[name];
	}
};

/**
 * @param {string} id
 * @param {string} name
 * @param {Object} meta
 */
const saveStored = async (id, name, meta) => {
	const existing = await settingModel.query().where("id", id).first();
	if (existing) {
		await settingModel.query().where("id", id).patch({ meta });
	} else {
		await settingModel.query().insert({ id, name, description: name, value: id, meta });
	}
};

const geoipView = (cfg) => {
	const { license_key: key, ...values } = cfg.values;
	return {
		account_id: values.account_id,
		editions: values.editions,
		provider: values.provider,
		dbip_editions: values.dbip_editions,
		license_key_set: Boolean(key) || cfg.secretError,
		locked: cfg.locked,
		locked_by: lockedByOf("geoip", cfg.locked),
		secret_error: cfg.secretError,
		last_update: values.last_update ?? null,
		last_check: values.last_check ?? null,
		last_error: values.last_error ?? null,
	};
};

const updateMonitoringStored = createMonitoringUpdater({
	readStored: readStoredMonitoring,
	saveStored: (meta) => saveStored("monitoring", "Monitoring", meta),
	deleteIps,
	hooks,
});

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

const internalMonitoringSetting = {
	/**
	 * @param   {Access}  access
	 * @returns {Promise<Object>}
	 */
	getMonitoring: async (access) => {
		access.canAdmin();
		const cfg = await getMonitoringConfig();
		return { ...cfg.values, locked: cfg.locked, locked_by: lockedByOf("monitoring", cfg.locked) };
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  body  validated against the PUT schema
	 * @returns {Promise<Object>}  the same as getMonitoring()
	 */
	updateMonitoring: async (access, body) => {
		access.canAdmin();
		const next = await updateMonitoringStored(body);

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: { id: "monitoring", ...next, ...(body?.delete_stats === true ? { deleted_stats: true } : {}) },
		});
		return internalMonitoringSetting.getMonitoring(access);
	},

	/**
	 * Never includes the license key
	 *
	 * @param   {Access}  access
	 * @returns {Promise<Object>}
	 */
	getGeoip: async (access) => {
		access.canAdmin();
		return geoipView(await getGeoipConfig());
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  body  validated against the PUT schema
	 * @returns {Promise<Object>}  the same as getGeoip()
	 */
	updateGeoip: async (access, body) => {
		access.canAdmin();
		const stored = await readStoredGeoip();
		const before = await getGeoipConfig();
		const { license_key: _storedKey, ...storedPlain } = stored;
		const { locked } = mergeGeoipConfig(storedPlain, process.env);
		const next = {
			...stored,
			...pickEditable(body ?? {}, locked, ["account_id", "editions", "provider", "dbip_editions"]),
		};
		if (next.editions) next.editions = [...new Set(next.editions)];
		if (next.dbip_editions) next.dbip_editions = [...new Set(next.dbip_editions)];
		const newKey = typeof body?.license_key === "string" ? body.license_key.trim() : "";
		if (newKey !== "" && !locked.includes("license_key")) {
			next.license_key = defaultSecretBox.encrypt(newKey);
		}
		// a switch of the effective provider starts clean: the old provider's error does not belong to the new one
		const { license_key: _nextKey, ...nextPlain } = next;
		const nextProvider = mergeGeoipConfig(nextPlain, process.env, { keySaved: Boolean(next.license_key) }).values
			.provider;
		const switched = nextProvider !== before.values.provider;
		if (switched) next.last_error = null;
		await saveStored("geoip", "GeoIP", next);

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: { id: "geoip", ...sanitizeGeoipMeta(next) },
		});

		if (switched) {
			// the setting is stored: a failing swap of the readers never fails the save, the download still starts
			try {
				await applyGeoipProvider();
				await reportGeoipState();
			} catch (err) {
				logger.warn(`GeoIP: switching the provider failed: ${String(err?.message ?? err).slice(0, 200)}`);
			}
		}

		const after = await getGeoipConfig();
		if (
			switched ||
			!sameList(before.values.dbip_editions, after.values.dbip_editions) ||
			before.values.account_id !== after.values.account_id ||
			before.values.license_key !== after.values.license_key ||
			!sameList(before.values.editions, after.values.editions)
		) {
			// the download can take minutes: run it in the background, the outcome is stored by recordGeoipResult
			void Promise.resolve()
				.then(() => hooks.onGeoipCredentialsChange())
				.catch((err) => logger.error(`GeoIP update after saving the settings failed: ${err.message}`));
		}
		return geoipView(after);
	},

	/**
	 * @param   {Access}  access
	 * @returns {Promise<{ok: boolean, updated?: string[], error?: string}>}  updated lists the replaced editions
	 */
	updateGeoipNow: async (access) => {
		access.canAdmin();
		const result = await hooks.runGeoipUpdate();
		return result;
	},

	/**
	 * Stores the outcome of a GeoIP update (internal use by the updater, no access check)
	 *
	 * @param {{ok: boolean, error?: string, updated?: string[], provider?: string}} result
	 */
	recordGeoipResult: async ({ ok, error, updated, provider }) => {
		// a run of the provider that was switched away while it ran must not write onto the new one
		if (provider !== undefined && provider !== (await getGeoipConfig()).values.provider) {
			logger.info(`GeoIP: the result of the ${provider} run is dropped, the provider was switched meanwhile`);
			return;
		}
		const stored = await readStoredGeoip();
		const now = new Date().toISOString();
		const next = { ...stored, last_error: ok ? null : String(error ?? "Unknown error"), last_check: now };
		if (ok || updated?.length > 0) next.last_update = now;
		await saveStored("geoip", "GeoIP", next);
		await reportGeoipState();
	},
};

export { setMonitoringHooks };
export default internalMonitoringSetting;
