import { existsSync } from "node:fs";
import { stapledHost } from "../lib/default-cert.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import streamModel from "../models/stream.js";
import internalNginx from "./nginx.js";

// the relations generateConfig needs, as setup.js regenerates them
const HOST_TYPES = [
	[proxyHostModel, "proxy_host", "[access_lists.[clients,items],certificate,locations.access_lists.[clients,items]]"],
	[redirectionHostModel, "redirection_host", "certificate"],
	[deadHostModel, "dead_host", "certificate"],
	[streamModel, "stream", "certificate"],
];

/**
 * Renders the configs of the enabled hosts that match, as files for the runtime apply transaction. A host without a
 * config file (disabled, or kept as .err after nginx rejected it) is left alone, so a broken host cannot block the save.
 *
 * @param   {Function}  match  (host) => boolean
 * @param   {Object}    env    the env the templates read
 * @returns {Promise<Array<{path: string, content: string, nginx: true}>>}
 */
const renderMatchingHosts = async (match, env) => {
	const files = [];
	for (const [model, hostType, graph] of HOST_TYPES) {
		for (const host of await model.query().where("enabled", 1).withGraphFetched(graph)) {
			if (!match(host)) continue;
			const file = internalNginx.getConfigName(hostType, host.id);
			if (!existsSync(file)) continue;
			files.push({ path: file, content: await internalNginx.renderConfig(hostType, host, { env }), nginx: true });
		}
	}
	return files;
};

/**
 * renderHosts of the runtime applier: the host configs a changed reload key affects. At startup nothing is
 * re-rendered: the host configs on disk were rendered with the stored values, and when an env value the templates
 * read changed, start.sh deleted them and setup.js regenerates them with effectiveEnv() after the startup apply.
 *
 * @param   {string}  group
 * @param   {Object}  ctx  { changed, startup, env }
 * @returns {Promise<Array>}
 */
const renderRuntimeHosts = (group, { changed, startup, env }) => {
	if (startup) return Promise.resolve([]);
	if (group === "certificates") return renderMatchingHosts((host) => stapledHost(host, changed), env);
	return Promise.resolve([]);
};

export { renderMatchingHosts, renderRuntimeHosts };
