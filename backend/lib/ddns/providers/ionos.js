import { DdnsProviderError } from "../errors.js";
import { collectZones, failAnswer, malformed, statusRefusal } from "./zone-common.js";

const DEFAULT_ENDPOINT = "https://api.hosting.ionos.com";
const TRAILING_SLASHES = /\/+$/u;
const HINT = "An API key of the IONOS DNS API, on an account that IONOS allows to use it";

// a missing field is empty, never the text "undefined"
const keyOf = (fields) => `${fields.dns_ionos_prefix ?? ""}.${fields.dns_ionos_secret ?? ""}`;
// the prefix is not secret, but the whole key is: the secret and the joined key are scrubbed
const secretsOf = (fields) =>
	[fields.dns_ionos_secret, keyOf(fields)].filter(
		(value) => typeof value === "string" && value !== "" && value !== ".",
	);

/**
 * The API origin: https only, origin and path only (no userinfo, query or hash). The outbound guard checks the
 * host on every call.
 *
 * @param   {*} value  the optional endpoint of the credential
 * @returns {String}
 */
const baseOf = (value) => {
	const text = typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULT_ENDPOINT;
	let url;
	try {
		url = new URL(text);
	} catch {
		throw new DdnsProviderError({ code: "not-https", message: "The IONOS endpoint is not a URL", retry: false });
	}
	if (url.protocol !== "https:") {
		throw new DdnsProviderError({
			code: "not-https",
			message: "The IONOS endpoint must be an https URL",
			retry: false,
		});
	}
	return `${url.origin}${url.pathname.replace(TRAILING_SLASHES, "")}`;
};

/** Zone listing only: IONOS has no DDNS updater here. The answer is one plain array, with no paging */
export default {
	id: "ionos",
	label: "IONOS",
	credentialProvider: "ionos",
	testRefusal: statusRefusal({ 401: "wrong-key" }),
	listZones: ({ fields, fetch, maxPages }) =>
		collectZones({
			maxPages,
			fetchPage: async () => {
				const secrets = secretsOf(fields);
				const res = await fetch(`${baseOf(fields.dns_ionos_endpoint)}/dns/v1/zones`, {
					headers: { "X-API-Key": keyOf(fields), Accept: "application/json" },
				});
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				// a secondary zone takes no record through this key
				return { names: res.json.map((zone) => (zone?.type === "SLAVE" ? "" : zone?.name)), more: false };
			},
		}),
};
