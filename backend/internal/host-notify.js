import { global as logger } from "../logger.js";
import { notify } from "./notify.js";

// The notification emit points of the host configs: the config error state of a host after each write of its nginx
// status, and its removal when the host is deleted. Nothing here throws into the host code.

const EVENT = "host.config_error";

const guarded = async (what, work) => {
	try {
		await work();
	} catch (error) {
		logger.warn(`Host notifications: ${what} failed: ${String(error?.message ?? error).slice(0, 200)}`);
	}
};

/**
 * Reports the config state of a host after its status was written
 *
 * @param {String}  hostType  proxy_host, redirection_host, dead_host or stream
 * @param {Object}  host
 * @param {Object}  status    { npmpro_nginx_online, npmpro_nginx_err }
 */
const reportHostConfig = (hostType, host, status) =>
	guarded("the config state", () =>
		notify.reportState(EVENT, `${hostType}:${host.id}`, {
			state: status.npmpro_nginx_online ? "ok" : "bad",
			source: { ...host, type: hostType, error: status.npmpro_nginx_err },
		}),
	);

/** A deleted host has no config state left */
const clearHostConfig = (hostType, id) =>
	guarded("clearing the config state", () => notify.clearMatching(EVENT, `${hostType}:${id}`));

export { clearHostConfig, reportHostConfig };
