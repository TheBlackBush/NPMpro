import { refuseWildcard, relativeName } from "./record-common.js";
import { failAnswer } from "./zone-common.js";

const ZONE = "duckdns.org";
const ENDPOINT = "https://www.duckdns.org/update";
const HINT = "The token and the subdomain must belong to the same DuckDNS account";
const LINE_BREAK = /\r?\n/u;

const secretsOf = (fields) => [fields.dns_duckdns_token].filter((value) => typeof value === "string" && value !== "");

/**
 * DuckDNS has no zones to list and no call that reads a record: the zone is always duckdns.org, `read` answers null
 * and the engine writes whenever the DNS answer differs. The token travels in the query string, so every call gets it
 * as a secret and the URL never reaches a message.
 */
export default {
	id: "duckdns",
	label: "DuckDNS",
	credentialProvider: "duckdns",
	recordTypes: ["A", "AAAA"],
	proxied: false,
	ipv6: true,
	adminOnly: false,
	wildcards: false,
	aliases: false,
	zoneless: true,
	zone: ZONE,
	read: () => Promise.resolve(null),
	/** One GET: the first line of the answer is OK for a success; KO, an empty body or anything else is a failure */
	async write({ name, type, ip, fields, fetch, meta }) {
		refuseWildcard(name);
		const secrets = secretsOf(fields);
		const sub = relativeName(ZONE, name);
		const query = [
			`domains=${encodeURIComponent(sub)}`,
			`token=${encodeURIComponent(fields.dns_duckdns_token ?? "")}`,
			`${type === "AAAA" ? "ipv6" : "ip"}=${encodeURIComponent(ip)}`,
			"verbose=true",
		].join("&");
		const res = await fetch(`${ENDPOINT}?${query}`, { headers: { Accept: "text/plain" } });
		const first = res.text.split(LINE_BREAK)[0].trim();
		if (res.status >= 200 && res.status < 300 && first === "OK") return { meta: { ...meta }, created: false };
		// the status codes are not documented: the body decides (KO is a refusal, which a retry cannot fix)
		failAnswer(res, { hint: HINT, secrets, refused: first === "KO" });
	},
};
