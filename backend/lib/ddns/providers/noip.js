import { DdnsProviderError } from "../errors.js";
import { presetSecrets } from "../presets.js";
import { refuseWildcard } from "./record-common.js";
import { failAnswer } from "./zone-common.js";

const ENDPOINT = "https://dynupdate.no-ip.com/nic/update";
const HINT = "Check the user name and password of the No-IP account and that the host belongs to it";
// No-IP asks for "Company NameOfProgram/OSVersion-ReleaseVersion maintainer-contact@example.com"
const USER_AGENT = "NPMpro-DDNS/1.0 github.com/TheBlackBush/NPMpro";
const GOOD = /^(?:good|nochg)(?:\s|$)/u;
const WHITESPACE = /\s/u;
const LINE_BREAK = /\r?\n/u;
const MINUTE = 60_000;
// an HTTP refusal without a No-IP code: the engine waits at least this long (an edit of the record starts over)
const REFUSED_WAIT_MS = 6 * 60 * MINUTE;
// No-IP asks for no retry sooner than 30 minutes after a 911
const SERVER_ERROR_WAIT_MS = 30 * MINUTE;
// the answers about the account or the client: No-IP asks for no more updates until the user acts
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
 * No-IP: one GET with the host and the addresses, the account's user name and password as Basic auth. A record of
 * both families sends `myip` and `myipv6` in the same call. The failure shows in the body (a wrong password is a 401
 * with `badauth`). `911` leaves the record alone for 30 minutes; the account answers (`nohost`, `badauth`, `badagent`,
 * `!donator`, `abuse`) stop the record until the user acts, as No-IP's response rules ask.
 * A record of IPv6 alone is refused at save: No-IP documents no way to keep the IPv4 part unchanged.
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
	ipv6Alone: false,
	// a record of both families makes one call with both addresses, not one per family
	oneCall: true,
	read: () => Promise.resolve(null),
	async write({ name, type, ip, addresses, fields, fetch, meta }) {
		refuseWildcard(name);
		const secrets = presetSecrets(fields);
		if (typeof fields.username !== "string" || fields.username === "" || typeof fields.password !== "string") {
			throw new DdnsProviderError({
				code: "forbidden",
				message: "The user name or the password is missing",
				retry: false,
			});
		}
		const ipv4 = addresses?.ipv4 ?? (type === "AAAA" ? undefined : ip);
		const ipv6 = addresses?.ipv6 ?? (type === "AAAA" ? ip : undefined);
		const query = [
			`hostname=${encodeURIComponent(name)}`,
			...(ipv4 ? [`myip=${encodeURIComponent(ipv4)}`] : []),
			...(ipv6 ? [`myipv6=${encodeURIComponent(ipv6)}`] : []),
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
				retryAfterMs: code === "911" ? SERVER_ERROR_WAIT_MS : undefined,
				stop: code !== "911",
				secrets,
			});
		}
		failAnswer(res, { hint: HINT, secrets, refusedRetryAfterMs: REFUSED_WAIT_MS });
	},
};
