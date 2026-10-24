import errs from "../lib/error.js";
import { mergeMonitoringConfig } from "../lib/monitoring-rules.js";
import { global as logger } from "../logger.js";

const EDITABLE = ["traffic_enabled", "retention_days", "show_ips", "unique_visitors", "visitors_cap"];

/**
 * Copies the editable keys of a validated body that are not locked
 */
const pickEditable = (body, locked, keys) =>
	Object.fromEntries(keys.filter((key) => key in body && !locked.includes(key)).map((key) => [key, body[key]]));

/**
 * Runs the given functions one after another, also when an earlier one failed
 *
 * @returns {(fn: Function) => Promise}
 */
const createSerializer = () => {
	let chain = Promise.resolve();
	return (fn) => {
		const run = chain.then(fn, fn);
		chain = run.catch(() => {});
		return run;
	};
};

/**
 * Builds the monitoring settings update. Each update (read stored, hooks, save) runs as one unit,
 * so concurrent updates cannot overwrite each other.
 *
 * @param   {Object}   deps
 * @param   {Function} deps.readStored  () => stored meta
 * @param   {Function} deps.saveStored  (meta) => void
 * @param   {Function} deps.deleteIps   () => void
 * @param   {Object}   deps.hooks       read on every update: onTrafficEnabledChange(enabled), onShowIpsOff(),
 *                                      onShowIpsOn() (optional, after the save; a failure is only logged),
 *                                      onUniqueVisitorsOff() (before the save, deletes the stored visitor hashes),
 *                                      onUniqueVisitorsOn() (optional, after the save; a failure is only logged)
 * @param   {Object}   [deps.env]
 * @returns {(body: Object) => Promise<Object>}  resolves to the saved meta
 */
const createMonitoringUpdater = ({ readStored, saveStored, deleteIps, hooks, env = process.env }) => {
	const serialize = createSerializer();

	const update = async (body) => {
		const stored = await readStored();
		const { values: before, locked } = mergeMonitoringConfig(stored, env);
		const next = { ...stored, ...pickEditable(body ?? {}, locked, EDITABLE) };
		const after = mergeMonitoringConfig(next, env).values;
		const trafficChanged = after.traffic_enabled !== before.traffic_enabled;

		if (trafficChanged) {
			try {
				await hooks.onTrafficEnabledChange(after.traffic_enabled);
			} catch (err) {
				throw new errs.ValidationError(`Could not switch the access log: ${err.message}`, undefined, {
					cause: err,
				});
			}
		}
		// Switches the access log back when a later step fails, so nginx keeps matching the stored setting
		const revertTraffic = async () => {
			if (!trafficChanged) {
				return;
			}
			try {
				await hooks.onTrafficEnabledChange(before.traffic_enabled);
			} catch (revertErr) {
				logger.error(`Could not switch the access log back after a failed update: ${revertErr.message}`);
			}
		};

		if (before.show_ips && !after.show_ips) {
			try {
				await deleteIps();
				await hooks.onShowIpsOff();
			} catch (err) {
				await revertTraffic();
				throw new errs.ValidationError(
					`Could not delete the stored IP addresses, the setting was not changed: ${err.message}`,
					undefined,
					{ cause: err },
				);
			}
		}

		if (before.unique_visitors && !after.unique_visitors) {
			try {
				await hooks.onUniqueVisitorsOff();
			} catch (err) {
				await revertTraffic();
				throw new errs.ValidationError(
					`Could not delete the stored visitor hashes, the setting was not changed: ${err.message}`,
					undefined,
					{ cause: err },
				);
			}
		}

		try {
			await saveStored(next);
		} catch (err) {
			await revertTraffic();
			throw err;
		}
		if (!before.show_ips && after.show_ips && hooks.onShowIpsOn) {
			try {
				await hooks.onShowIpsOn();
			} catch (err) {
				logger.error(`Could not switch visitor IPs back on in the traffic reader: ${err.message}`);
			}
		}
		if (!before.unique_visitors && after.unique_visitors && hooks.onUniqueVisitorsOn) {
			try {
				await hooks.onUniqueVisitorsOn();
			} catch (err) {
				logger.error(`Could not switch unique visitors on in the traffic reader: ${err.message}`);
			}
		}
		return next;
	};

	return (body) => serialize(() => update(body));
};

export { createMonitoringUpdater, createSerializer, pickEditable };
