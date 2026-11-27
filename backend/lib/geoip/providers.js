const PROVIDER_IDS = ["dbip", "maxmind"];
const DBIP_EDITIONS = ["Country", "ASN"];
const MAXMIND_EDITIONS = ["GeoLite2-Country", "GeoLite2-ASN", "GeoLite2-City"];

const DBIP_FILES = { Country: "dbip-country-lite.mmdb", ASN: "dbip-asn-lite.mmdb" };

const PROVIDERS = Object.freeze({
	dbip: {
		editions: DBIP_EDITIONS,
		country: "Country",
		asn: "ASN",
		file: (edition) => DBIP_FILES[edition],
		// DBIP-Country-Lite, DBIP-ASN-Lite (compat=GeoLite2-ASN)
		typeMatches: (edition, type) => String(type).startsWith(`DBIP-${edition}-Lite`),
		needsCredentials: false,
	},
	maxmind: {
		editions: MAXMIND_EDITIONS,
		country: "GeoLite2-Country",
		asn: "GeoLite2-ASN",
		file: (edition) => `${edition}.mmdb`,
		typeMatches: (edition, type) => String(type).includes(edition.replace("GeoLite2-", "")),
		needsCredentials: true,
	},
});

const providerOf = (id) => PROVIDERS[id] ?? PROVIDERS.dbip;
const countryFileOf = (id) => providerOf(id).file(providerOf(id).country);
const asnFileOf = (id) => providerOf(id).file(providerOf(id).asn);

/**
 * The selected editions of the active provider: values.editions for maxmind, values.dbip_editions for dbip
 *
 * @param   {Object}  values  effective GeoIP values
 * @returns {string[]}
 */
const selectedEditions = (values) => (values.provider === "maxmind" ? values.editions : values.dbip_editions);

const validId = (id) => (PROVIDER_IDS.includes(id) ? id : undefined);

/**
 * env (valid) > stored (valid) > maxmind with credentials > dbip
 *
 * @param   {Object}   args
 * @param   {string}   [args.envValue]     raw GEOIP_PROVIDER, trimmed and lower-cased here
 * @param   {string}   [args.stored]       the stored provider
 * @param   {boolean}  args.credentials    MaxMind credentials are set
 * @returns {string}
 */
const effectiveProvider = ({ envValue, stored, credentials }) =>
	validId(
		String(envValue ?? "")
			.trim()
			.toLowerCase(),
	) ??
	validId(stored) ??
	(credentials ? "maxmind" : "dbip");

export {
	asnFileOf,
	countryFileOf,
	DBIP_EDITIONS,
	effectiveProvider,
	MAXMIND_EDITIONS,
	PROVIDER_IDS,
	PROVIDERS,
	providerOf,
	selectedEditions,
};
