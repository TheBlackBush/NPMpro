import db from "../db.js";
import { scrubSecrets } from "../lib/ddns/errors.js";
import { safeError } from "../lib/notify/queue.js";
import { global as logger } from "../logger.js";
import { notify } from "./notify.js";

// The notification emit points of the host configs: the config error state of a host after each write of its nginx
// status, and its removal when the host is deleted. Nothing here throws into the host code, and the reports never
// delay a configure: they run one after another in the background, in the order they were asked for.

const EVENT = "host.config_error";
const USERINFO = /^(?<userinfo>[^@/\s]+)@/u;
const CREDENTIAL_VALUE = /(?:password|passwd|secret|token|api[_-]?key)\s*[=:\s]\s*["']?(?<value>[^\s"';]+)/giu;

let tail = Promise.resolve();

const guarded = async (what, work) => {
	try {
		await work();
	} catch (error) {
		logger.warn(`Host notifications: ${what} failed: ${String(error?.message ?? error).slice(0, 200)}`);
	}
};

// a lookup that fails gives no values: the text is still cut and its URLs cleaned
const guardedValue = async (work) => {
	try {
		return await work();
	} catch (error) {
		logger.warn(`Host notifications: a lookup failed: ${String(error?.message ?? error).slice(0, 200)}`);
		return [];
	}
};

const userinfoOf = (forward) => {
	const found = typeof forward === "string" ? USERINFO.exec(forward) : null;
	if (!found) return [];
	const { userinfo } = found.groups;
	return [userinfo, userinfo.split(":").slice(1).join(":")];
};

const credentialsIn = (text) =>
	typeof text === "string" ? [...text.matchAll(CREDENTIAL_VALUE)].map((match) => match.groups.value) : [];

/**
 * The values of a host that must not reach an event: the userinfo of a forward host (and of its locations), the
 * passwords of its access lists and values that look like credentials in its advanced config
 *
 * @param   {Object}  host
 * @returns {String[]}
 */
const secretsOfHost = (host) => {
	const parts = [host, ...(Array.isArray(host.locations) ? host.locations : [])];
	const lists = [...(host.access_lists ?? []), host.access_list].filter(Boolean);
	return [
		...parts.flatMap((part) => [...userinfoOf(part.forward_host), ...credentialsIn(part.advanced_config)]),
		...lists.flatMap((list) =>
			(list.items ?? []).flatMap((item) =>
				[item.password, item.username].filter((value) => typeof value === "string"),
			),
		),
	];
};

// the stored (hashed) credentials of the access lists of a proxy host: nginx may name them in an error about its
// password file
const accessListSecrets = async (hostType, host) => {
	const ids = new Set([host.access_list_id].filter(Boolean));
	if (hostType === "proxy_host") {
		for (const id of await db()("npmpro_proxy_host_access_list")
			.where({ proxy_host_id: host.id })
			.pluck("access_list_id")) {
			ids.add(id);
		}
	}
	if (ids.size === 0) return [];
	const items = await db()("access_list_auth")
		.whereIn("access_list_id", [...ids])
		.select("username", "password");
	return items.flatMap((item) => [item.username, item.password]).filter((value) => typeof value === "string");
};

const later = (work) => {
	tail = tail.then(work, work);
	return tail;
};

/**
 * Reports the config state of a host after its status was written, in the background; the answer is when it is done
 * (tests wait on it), a caller need not
 *
 * @param {String}  hostType  proxy_host, redirection_host, dead_host or stream
 * @param {Object}  host
 * @param {Object}  status    { npmpro_nginx_online, npmpro_nginx_err }
 */
const reportHostConfig = (hostType, host, status) => {
	let base;
	let secrets;
	try {
		secrets = secretsOfHost(host);
		base = {
			id: host.id,
			type: hostType,
			domain_names: host.domain_names,
			incoming_port: host.incoming_port,
			enabled: host.enabled,
		};
	} catch (error) {
		logger.warn(`Host notifications: the config state failed: ${String(error?.message ?? error).slice(0, 200)}`);
		return Promise.resolve();
	}
	const online = Boolean(status.npmpro_nginx_online);
	const text = status.npmpro_nginx_err;
	return later(() =>
		guarded("the config state", async () => {
			// a configure that finished after its host was deleted leaves no state behind
			if (!(await db()(hostType).where({ id: host.id }).first("id"))) return;
			if (!online) secrets.push(...(await guardedValue(() => accessListSecrets(hostType, host))));
			const source = { ...base, error: online ? undefined : safeError(scrubSecrets(text, secrets)), secrets };
			await notify.reportState(EVENT, `${hostType}:${host.id}`, { state: online ? "ok" : "bad", source });
		}),
	);
};

/** A deleted host has no config state left */
const clearHostConfig = (hostType, id) =>
	later(() => guarded("clearing the config state", () => notify.clearMatching(EVENT, `${hostType}:${id}`)));

/** Resolves when every report asked for so far is done (tests) */
const settledHostReports = () => tail;

export { clearHostConfig, reportHostConfig, settledHostReports };
