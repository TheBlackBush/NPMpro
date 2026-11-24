import { collectZones, failAnswer, malformed } from "./zone-common.js";

const LIMIT = 500;
const HINT = "An API key with access to the domain API, on an account that GoDaddy allows to use it";

// the key and secret as the sso-key header joins them; a missing field is empty, never the text "undefined"
const pairOf = (fields) => `${fields.dns_godaddy_key ?? ""}:${fields.dns_godaddy_secret ?? ""}`;
const secretsOf = (fields) =>
	[fields.dns_godaddy_key, fields.dns_godaddy_secret, pairOf(fields)].filter(
		(value) => typeof value === "string" && value !== "" && value !== ":",
	);

/**
 * Zone listing only: GoDaddy has no DDNS updater here. A page is a bare array; the next one starts after the
 * last domain name (marker), and a page shorter than the limit is the end. A 401 may come with an empty body.
 */
export default {
	id: "godaddy",
	label: "GoDaddy",
	credentialProvider: "godaddy",
	listZones: ({ fields, fetch }) => {
		let marker = "";
		return collectZones({
			fetchPage: async () => {
				const secrets = secretsOf(fields);
				const query = `limit=${LIMIT}${marker === "" ? "" : `&marker=${encodeURIComponent(marker)}`}`;
				const res = await fetch(`https://api.godaddy.com/v1/domains?${query}`, {
					headers: {
						Authorization: `sso-key ${pairOf(fields)}`,
						Accept: "application/json",
					},
				});
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				const names = res.json.map((zone) => zone?.domain);
				const last = names.at(-1);
				marker = typeof last === "string" ? last : "";
				return { names, more: names.length >= LIMIT && marker !== "" };
			},
		});
	},
};
