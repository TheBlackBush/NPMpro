// The forward authentication (auth_request) providers a proxy host or location can use
const AUTH_REQUEST_PROVIDERS = ["anubis", "tinyauth", "oauth2proxy", "voidauth", "authelia", "authentik"];

// forward-auth runtime setting key => provider
const UPSTREAM_KEYS = Object.fromEntries(AUTH_REQUEST_PROVIDERS.map((provider) => [`${provider}_upstream`, provider]));

/**
 * The provider of an npmpro_auth_request value ("authentik-send-basic-auth" is Authentik)
 *
 * @param   {string}  value
 * @returns {string}
 */
const providerOf = (value) => (value === "authentik-send-basic-auth" ? "authentik" : value);

/**
 * A location's Auth Request with "global" (Same as host) replaced by the host's value
 *
 * @param   {Object}  host
 * @param   {Object}  location
 * @returns {string}
 */
const locationAuthRequest = (host, location) =>
	location.npmpro_auth_request === "global"
		? (host.npmpro_auth_request ?? "none")
		: (location.npmpro_auth_request ?? "none");

const enabledLocations = (host) => (host.locations ?? []).filter((location) => location.npmpro_enabled !== false);

/**
 * Whether the host or one of its enabled locations uses the provider
 *
 * @param   {Object}  host  a proxy host row with its locations
 * @param   {string}  provider
 * @returns {boolean}
 */
const usesProvider = (host, provider) =>
	providerOf(host.npmpro_auth_request) === provider ||
	enabledLocations(host).some((location) => providerOf(locationAuthRequest(host, location)) === provider);

/**
 * The upstream the host itself sets for the provider: the host's own field when the host uses it, else the first
 * enabled location using it that has one; "" when the Forward authentication default applies
 *
 * @param   {Object}  host
 * @param   {string}  provider
 * @returns {string}
 */
const ownUpstream = (host, provider) => {
	if (providerOf(host.npmpro_auth_request) === provider && host.npmpro_auth_request_upstream) {
		return host.npmpro_auth_request_upstream;
	}
	const location = enabledLocations(host).find(
		(entry) =>
			entry.npmpro_auth_request !== "global" &&
			providerOf(entry.npmpro_auth_request) === provider &&
			entry.npmpro_auth_request_upstream,
	);
	return location?.npmpro_auth_request_upstream ?? "";
};

/**
 * Every provider for which the host and its enabled locations set two different upstreams of their own (a global
 * location has none). nginx takes one upstream per provider and host, so the others would be ignored.
 *
 * @param   {Object}  host  a proxy host row or payload with its locations
 * @returns {{ provider: string, upstreams: string[] }[]}
 */
const upstreamConflicts = (host) => {
	const conflicts = [];
	for (const provider of AUTH_REQUEST_PROVIDERS) {
		const own = [host, ...enabledLocations(host).filter((location) => location.npmpro_auth_request !== "global")]
			.filter((item) => providerOf(item.npmpro_auth_request) === provider && item.npmpro_auth_request_upstream)
			.map((item) => item.npmpro_auth_request_upstream);
		const upstreams = [...new Set(own)];
		if (upstreams.length > 1) conflicts.push({ provider, upstreams });
	}
	return conflicts;
};

/**
 * The first conflict of upstreamConflicts, or null
 *
 * @param   {Object}  host
 * @returns {{ provider: string, upstreams: string[] }|null}
 */
const upstreamConflict = (host) => upstreamConflicts(host)[0] ?? null;

/**
 * The proxy hosts whose config follows the provider's default upstream: they use the provider (host or location) and
 * set no upstream of their own for it
 *
 * @param   {Object[]}  hosts
 * @param   {string}    provider
 * @returns {Object[]}
 */
const proxyHostsForProvider = (hosts, provider) =>
	hosts.filter((host) => usesProvider(host, provider) && !ownUpstream(host, provider));

/**
 * Whether a forward-auth save with the changed keys affects the proxy host's config: a changed default upstream of a
 * provider it uses without its own upstream, or the Anubis custom images switch when it uses Anubis
 *
 * @param   {Object}    host
 * @param   {string[]}  changed
 * @returns {boolean}
 */
const forwardAuthHost = (host, changed) =>
	changed.some((key) => {
		if (key === "anubis_custom_images") return usesProvider(host, "anubis");
		const provider = UPSTREAM_KEYS[key];
		return provider !== undefined && proxyHostsForProvider([host], provider).length > 0;
	});

export {
	AUTH_REQUEST_PROVIDERS,
	forwardAuthHost,
	locationAuthRequest,
	ownUpstream,
	proxyHostsForProvider,
	upstreamConflict,
	upstreamConflicts,
	usesProvider,
};
