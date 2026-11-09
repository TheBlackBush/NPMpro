// The relations a proxy host config is rendered from. Imports nothing: internal/nginx.js and internal/access-list.js
// need it, and they must not reach internal/certificate.js (stapling-recovery reads internalNginx at load).
const PROXY_HOST_EXPAND = ["certificate", "access_lists.[clients,items]", "locations.access_lists.[clients,items]"];
const PROXY_HOST_GRAPH = `[${PROXY_HOST_EXPAND.join(",")}]`;

export { PROXY_HOST_EXPAND, PROXY_HOST_GRAPH };
