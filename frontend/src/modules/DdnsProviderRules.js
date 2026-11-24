// What the Dynamic DNS record window shows for a provider: which fields, which choices, which note. The twin of the
// provider flags of GET /nginx/ddns/providers (zoneless, preset, aliases, wildcards, ipv6, minTtl, adminOnly). Pure.

const IP_VERSION_ALL = Object.freeze(["ipv4", "ipv6", "both"]);
// No-IP documents no way to keep the IPv4 part unchanged, so "IPv6 alone" is refused (the backend's ipv6Alone flag,
// which the provider list does not carry)
const IPV6_ALONE_REFUSED = Object.freeze(["noip"]);
const CUSTOM = "custom";
// the choice of a saved DNS credential, whose provider decides the rest
const CREDENTIAL = "credential";

// the account details each preset asks for, in the order the window shows them (the twin of PRESET_FIELDS in
// backend/lib/ddns/presets.js)
const PRESET_FIELDS = Object.freeze({
	namecheap: Object.freeze(["domain", "password"]),
	noip: Object.freeze(["username", "password"]),
	dynu: Object.freeze(["username", "password"]),
});

const isCustom = (provider) => provider?.id === CUSTOM;
const isPreset = (provider) => provider?.preset === true;

/**
 * The providers a record can be added with that take no DNS credential (the presets and the custom one); the custom
 * one only for administrators
 *
 * @param   {Array<Object>}  providers  GET /nginx/ddns/providers
 * @param   {boolean}        isAdmin
 * @returns {Array<Object>}
 */
const credentiallessChoices = (providers, isAdmin) =>
	(providers ?? []).filter(
		(provider) => provider.credentialProvider === null && (isAdmin === true || !provider.adminOnly),
	);

/**
 * Whether a record takes its details in the record itself (a preset or the custom provider) and no DNS credential
 *
 * @param   {string | undefined}  providerId  the window's provider choice
 * @returns {boolean}
 */
const withoutCredential = (providerId) =>
	typeof providerId === "string" && providerId !== "" && providerId !== CREDENTIAL;

/**
 * The provider choice a saved record starts with in the window: its own id when it takes no credential, else
 * CREDENTIAL (the credential chooses the provider)
 *
 * @param   {{ provider?: string } | null | undefined}  stored
 * @param   {Array<Object>}  providers
 * @returns {string}
 */
const providerIdOf = (stored, providers) => {
	const found = (providers ?? []).find((provider) => provider.id === stored?.provider);
	return found?.credentialProvider === null ? found.id : CREDENTIAL;
};

/**
 * What the window shows for a provider (null: no provider chosen yet, everything a credential provider may take)
 *
 * @param   {Object | null | undefined}  provider  an entry of GET /nginx/ddns/providers
 * @returns {{ alias: boolean, ttl: boolean, zone: boolean, wildcard: boolean, ipVersions: string[],
 *             fields: string[] }}
 *          fields: the account fields of a preset, or ["url", "method", "expect"] for the custom provider
 */
const providerFieldsOf = (provider) => {
	if (!provider) {
		return { alias: true, ttl: true, zone: true, wildcard: false, ipVersions: [...IP_VERSION_ALL], fields: [] };
	}
	const zoneless = provider.zoneless === true;
	let ipVersions = [...IP_VERSION_ALL];
	if (provider.ipv6 === false) ipVersions = ["ipv4"];
	else if (IPV6_ALONE_REFUSED.includes(provider.id)) ipVersions = ["ipv4", "both"];
	let fields = [];
	if (isCustom(provider)) fields = ["url", "method", "expect"];
	else if (isPreset(provider)) fields = [...(PRESET_FIELDS[provider.id] ?? [])];
	return {
		alias: provider.aliases === true && !zoneless,
		ttl: !zoneless,
		zone: !zoneless,
		wildcard: provider.wildcards === true && !zoneless,
		ipVersions,
		fields,
	};
};

/**
 * The note shown under a provider's fields: its translation id and values; null when it has none
 *
 * @param   {Object | null | undefined}  provider
 * @returns {{ id: string, values?: Object } | null}
 */
const providerNoteOf = (provider) => {
	if (!provider) return null;
	if (provider.id === "duckdns") return { id: "ddns.note.duckdns", values: { zone: provider.zone ?? "duckdns.org" } };
	if (provider.id === "desec") return { id: "ddns.note.desec", values: { min: provider.minTtl ?? 3600 } };
	if (provider.id === "ovh") return { id: "ddns.note.ovh" };
	if (isCustom(provider)) return { id: "ddns.note.custom" };
	if (isPreset(provider)) return { id: `ddns.note.${provider.id}` };
	return null;
};

export {
	CREDENTIAL,
	CUSTOM,
	credentiallessChoices,
	IPV6_ALONE_REFUSED,
	isCustom,
	isPreset,
	PRESET_FIELDS,
	providerFieldsOf,
	providerIdOf,
	providerNoteOf,
	withoutCredential,
};
