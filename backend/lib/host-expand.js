// The relations a proxy host is fetched with and rendered from. A leaf file on purpose: access-list.js, proxy-host.js,
// regenerate.js and runtime-hosts.js import it, and access-list.js sits in the cycle internal/nginx.js ->
// proxy-host-access-list.js -> access-list.js -> internal/nginx.js, which must not reach internal/certificate.js.
const PROXY_HOST_EXPAND = ["certificate", "access_lists.[clients,items]", "locations.access_lists.[clients,items]"];
const PROXY_HOST_GRAPH = `[${PROXY_HOST_EXPAND.join(",")}]`;

export { PROXY_HOST_EXPAND, PROXY_HOST_GRAPH };
