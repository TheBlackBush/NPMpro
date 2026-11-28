import { PROXY_HOST_GRAPH } from "../lib/host-expand.js";
import { createHostRenderer } from "../lib/runtime-hosts.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import streamModel from "../models/stream.js";
import { ensureGeoipListsFor } from "./geoip-nginx.js";
import internalNginx from "./nginx.js";

// the relations renderConfig needs, as setup.js regenerates them
const HOST_TYPES = [
	[proxyHostModel, "proxy_host", PROXY_HOST_GRAPH],
	[redirectionHostModel, "redirection_host", "certificate"],
	[deadHostModel, "dead_host", "certificate"],
	[streamModel, "stream", "certificate"],
];

const renderer = createHostRenderer({
	hostTypes: HOST_TYPES,
	getConfigName: internalNginx.getConfigName,
	renderConfig: internalNginx.renderConfig,
});
const { proxyHostsUsingDefault } = renderer;

/**
 * renderHosts of the runtime applier (lib/runtime-hosts.js), with the GeoIP includes the rendered configs need
 * before the apply's nginx -t (it runs in the runtime settings queue)
 *
 * @param   {string}  group
 * @param   {Object}  ctx
 * @returns {Promise<Array>}
 */
const renderRuntimeHosts = async (group, ctx) => {
	const files = await renderer.renderRuntimeHosts(group, ctx);
	await ensureGeoipListsFor(files.map(({ content }) => content));
	return files;
};

export { HOST_TYPES, proxyHostsUsingDefault, renderRuntimeHosts };
