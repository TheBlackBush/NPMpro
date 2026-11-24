import { DdnsProviderError } from "../errors.js";
import { collectZones, failAnswer, malformed, statusRefusal } from "./zone-common.js";

const TRAILING_SLASHES = /\/+$/u;
const TRAILING_DOT = /\.$/u;

const HINT = "The API key and api-allow-from of the PowerDNS server";

// Only the API key is a secret: the endpoint and the server id are shown in messages and must not be scrubbed
const secretsOf = (fields) => [fields.dns_pdns_api_key].filter((value) => typeof value === "string" && value !== "");

/**
 * The API base the way certbot-dns-pdns (dns-lexicon) builds it: origin and path only (no userinfo, query or
 * hash), trailing slashes stripped, "/api/v1" appended unless the path already ends with it.
 *
 * @param   {*} value  the endpoint of the credential
 * @returns {String|null}  the base URL, or null when it is not an http(s) URL
 */
const baseOf = (value) => {
	try {
		const url = new URL(String(value ?? "").trim());
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		const base = `${url.origin}${url.pathname}`.replace(TRAILING_SLASHES, "");
		return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
	} catch {
		return null;
	}
};

export default {
	id: "powerdns",
	label: "PowerDNS",
	credentialProvider: "powerdns",
	testRefusal: statusRefusal({ 401: "wrong-key" }),
	listZones: ({ fields, fetch, maxPages }) =>
		collectZones({
			maxPages,
			fetchPage: async () => {
				const secrets = secretsOf(fields);
				const base = baseOf(fields.dns_pdns_endpoint);
				if (base === null) {
					throw new DdnsProviderError({
						code: "failed",
						message: "The PowerDNS endpoint is not a URL",
						retry: false,
					});
				}
				const serverId = encodeURIComponent(fields.dns_pdns_server_id || "localhost");
				const res = await fetch(`${base}/servers/${serverId}/zones`, {
					allowPrivateHttp: true,
					headers: { "X-API-Key": fields.dns_pdns_api_key ?? "", Accept: "application/json" },
				});
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				return {
					names: res.json.map((zone) => String(zone?.name ?? "").replace(TRAILING_DOT, "")),
					more: false,
				};
			},
		}),
};
