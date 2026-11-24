import { DdnsProviderError } from "../errors.js";
import { presetSecrets } from "../presets.js";
import { refuseWildcard } from "./record-common.js";
import { failAnswer } from "./zone-common.js";

const ENDPOINT = "https://dynupdate.no-ip.com/nic/update";
const HINT = "Check the user name and password of the No-IP account and that the host belongs to it";
// No-IP asks for "Company NameOfProgram/OSVersion-ReleaseVersion maintainer-contact@example.com"
const USER_AGENT = "NPMpro DynamicDNS/Linux-1 noreply@example.com";
const GOOD = /^(?:good|nochg)(?:\s|$)/u;
const WHITESPACE = /\s/u;
const LINE_BREAK = /\r?\n/u;
// the answers that stop the record for good until the account is looked at
const STOPPED = new Set(["nohost", "badauth", "badagent", "!donator", "abuse"]);
const MESSAGES = {
	nohost: "The host does not belong to this account",
	badauth: "The user name or the password is wrong",
	badagent: "No-IP disabled this client",
	"!donator": "The feature is not available for this account",
	abuse: "The account is blocked for abuse",
	911: "No-IP has a server error; no update for 30 minutes",
};

/**
 * No-IP: one GET with the host and the address, the account's user name and password as Basic auth. The failure shows
 * in the body (a wrong password is a 401 with `badauth`). `911` is retried only after the backoff and `abuse`,
 * `badagent` and the other account answers are not retried.
 */
export default {
	id: "noip",
	label: "No-IP",
	credentialProvider: null,
	recordTypes: ["A", "AAAA"],
	proxied: false,
	ipv6: true,
	adminOnly: false,
	wildcards: false,
	aliases: false,
	zoneless: true,
	preset: true,
	read: () => Promise.resolve(null),
	async write({ name, type, ip, fields, fetch, meta }) {
		refuseWildcard(name);
		const secrets = presetSecrets(fields);
		if (typeof fields.username !== "string" || fields.username === "" || typeof fields.password !== "string") {
			throw new DdnsProviderError({
				code: "forbidden",
				message: "The user name or the password is missing",
				retry: false,
			});
		}
		const query = [
			`hostname=${encodeURIComponent(name)}`,
			`${type === "AAAA" ? "myipv6" : "myip"}=${encodeURIComponent(ip)}`,
		].join("&");
		const basic = Buffer.from(`${fields.username}:${fields.password}`).toString("base64");
		const res = await fetch(`${ENDPOINT}?${query}`, {
			headers: { Authorization: `Basic ${basic}`, "User-Agent": USER_AGENT, Accept: "text/plain" },
		});
		const first = res.text.split(LINE_BREAK)[0].trim();
		if (res.status >= 200 && res.status < 300 && GOOD.test(first)) return { meta: { ...meta }, created: false };
		const code = first.split(WHITESPACE)[0];
		if (STOPPED.has(code) || code === "911") {
			throw new DdnsProviderError({
				providerStatus: res.status,
				code: code === "911" ? "failed" : "forbidden",
				message: `${MESSAGES[code]} (${code})`,
				retry: code === "911",
				secrets,
			});
		}
		failAnswer(res, { hint: HINT, secrets });
	},
};
