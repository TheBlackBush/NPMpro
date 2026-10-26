import { readdir, rm } from "node:fs/promises";
import { setup as logger } from "../logger.js";
import accessListModel from "../models/access_list.js";
import deadModel from "../models/dead_host.js";
import proxyModel from "../models/proxy_host.js";
import redirectionModel from "../models/redirection_host.js";
import settingModel from "../models/setting.js";
import streamModel from "../models/stream.js";
import internalAccessList from "./access-list.js";
import internalNginx from "./nginx.js";
import internalProxyHostAccessList from "./proxy-host-access-list.js";
import { runtimeExclusive } from "./runtime-queue.js";

const HOST_CONFIG_DIRS = ["proxy_host", "redirection_host", "dead_host", "stream"];
const ACCESS_DIR = "/data/access";
const ACCESS_FILE = /^\d+$/u;

// the host types with the graph their configs are rendered from
const HOST_TYPES = [
	[proxyModel, "proxy_host", "[access_lists.[clients,items],certificate,locations.access_lists.[clients,items]]"],
	[redirectionModel, "redirection_host", "certificate"],
	[deadModel, "dead_host", "certificate"],
	[streamModel, "stream", "certificate"],
];

/**
 * Removes host configs that a full regeneration did not write: configs of hosts that were deleted or disabled, and the
 * configs launch.sh moved aside (*.conf.stale) because nginx rejected them
 *
 * @param   {Set<String>}  written  the config files the regeneration wrote
 * @returns {Promise}
 */
const removeLeftoverConfigs = async (written) => {
	for (const dir of HOST_CONFIG_DIRS) {
		const names = await readdir(`/data/nginx/${dir}`).catch(() => []);
		for (const name of names) {
			const file = `/data/nginx/${dir}/${name}`;
			if (name.endsWith(".conf.stale") || (name.endsWith(".conf") && !written.has(file))) {
				await rm(file, { force: true });
			}
		}
	}
};

/**
 * regenerateAllHosts for a caller that already runs in the runtime settings queue (a restore): calling the queued
 * variant from there would wait for itself
 *
 * @param   {Array<{model: Object, hostType: String, host: Object}>}  hosts
 * @returns {Promise}
 */
const regenerateAllHostsNow = async (hosts) => {
	const written = new Set();
	for (const { hostType, host } of hosts) {
		await internalProxyHostAccessList.build(hostType, host);
		await internalNginx.deleteConfig(hostType, host);
		// launch.sh and the startup apply fetched the OCSP responses, the reload afterwards fetches the rest once
		await internalNginx.generateConfig(hostType, host, { fetchMissingOcsp: false });
		written.add(internalNginx.getConfigName(hostType, host.id));
	}
	await removeLeftoverConfigs(written);

	try {
		await internalNginx.test();
	} catch (err) {
		logger.warn(`The regenerated configs do not pass nginx -t, checking the hosts one by one: ${err.message}`);
		for (const { hostType, host } of hosts) await internalNginx.deleteConfig(hostType, host);
		for (const { model, hostType, host } of hosts) {
			await internalNginx.configureNow(model, hostType, host, { skipReload: true, fetchMissingOcsp: false });
		}
		return;
	}
	const ok = { npmpro_nginx_online: true, npmpro_nginx_err: "" };
	for (const model of new Set(hosts.map(({ model }) => model))) {
		const ids = hosts.filter((entry) => entry.model === model).map(({ host }) => host.id);
		if (ids.length > 0) await model.query().whereIn("id", ids).patch(ok);
	}
};

/**
 * Full regeneration: writes every config (the previous ones stay in use until the reload), then one nginx -t. Only
 * when that fails, the hosts are checked one by one like a single save, so the broken ones end up as .err.
 *
 * @param   {Array<{model: Object, hostType: String, host: Object}>}  hosts
 * @returns {Promise}
 */
const regenerateAllHosts = (hosts) => runtimeExclusive(() => regenerateAllHostsNow(hosts));

/**
 * @returns {Promise<Array<{model: Object, hostType: String, host: Object}>>}  every enabled host with its graph
 */
const loadEnabledHosts = async () => {
	const hosts = [];
	for (const [model, hostType, graph] of HOST_TYPES) {
		for (const host of await model.query().where("enabled", 1).withGraphFetched(graph)) {
			hosts.push({ model, hostType, host });
		}
	}
	return hosts;
};

/**
 * Writes the htpasswd file of every access list and removes the files of lists that no longer exist
 *
 * @returns {Promise}
 */
const rebuildAccessListFiles = async () => {
	const lists = await accessListModel.query().withGraphFetched("items");
	for (const list of lists) await internalAccessList.build(list);
	const ids = new Set(lists.map((list) => String(list.id)));
	for (const name of await readdir(ACCESS_DIR).catch(() => [])) {
		if (ACCESS_FILE.test(name) && !ids.has(name)) await rm(`${ACCESS_DIR}/${name}`, { force: true });
	}
};

/**
 * Writes the default site config from its setting
 *
 * @returns {Promise}
 */
const regenerateDefaultSite = async () =>
	internalNginx.generateConfig("default", await settingModel.query().where({ id: "default-site" }).first());

export {
	HOST_TYPES,
	loadEnabledHosts,
	rebuildAccessListFiles,
	regenerateAllHosts,
	regenerateAllHostsNow,
	regenerateDefaultSite,
};
