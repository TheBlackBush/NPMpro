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
	enabledLocations(host).some((location) => providerOf(location.npmpro_auth_request) === provider);

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
		(entry) => providerOf(entry.npmpro_auth_request) === provider && entry.npmpro_auth_request_upstream,
	);
	return location?.npmpro_auth_request_upstream ?? "";
};

/**
 * The proxy hosts whose config follows the provider's default upstream: they use the provider (host or location)
 * and set no upstream of their own for it
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

export { AUTH_REQUEST_PROVIDERS, forwardAuthHost, ownUpstream, providerOf, proxyHostsForProvider, usesProvider };
