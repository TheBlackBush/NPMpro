import { PROXY_HOST_GRAPH } from "../lib/host-expand.js";
import { createHostRenderer } from "../lib/runtime-hosts.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import streamModel from "../models/stream.js";
import internalNginx from "./nginx.js";

// the relations renderConfig needs, as setup.js regenerates them
const HOST_TYPES = [
	[proxyHostModel, "proxy_host", PROXY_HOST_GRAPH],
	[redirectionHostModel, "redirection_host", "certificate"],
	[deadHostModel, "dead_host", "certificate"],
	[streamModel, "stream", "certificate"],
];

const { proxyHostsUsingDefault, renderRuntimeHosts } = createHostRenderer({
	hostTypes: HOST_TYPES,
	getConfigName: internalNginx.getConfigName,
	renderConfig: internalNginx.renderConfig,
});

export { HOST_TYPES, proxyHostsUsingDefault, renderRuntimeHosts };
