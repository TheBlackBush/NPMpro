import { DdnsProviderError } from "../errors.js";
import { presetSecrets } from "../presets.js";
import { refuseWildcard } from "./record-common.js";
import { failAnswer } from "./zone-common.js";

const ENDPOINT = "https://api.dynu.com/nic/update";
const HINT = "Check the user name and the IP update password of the Dynu account and that the host belongs to it";
const GOOD = /^(?:good|nochg)(?:\s|$)/u;
const WHITESPACE = /\s/u;
const LINE_BREAK = /\r?\n/u;
const MESSAGES = {
	nohost: "The host does not belong to this account",
	badauth: "The user name or the password is wrong, or the domain is not known",
	notfqdn: "The host name is not a full domain name",
	abuse: "The account is blocked for abuse",
	numhost: "Too many hosts in one call",
	"!donator": "The feature is not available for this account",
	911: "Dynu has a server error; try again later",
	servererror: "Dynu has a server error",
	dnserr: "Dynu has a DNS error",
	unknown: "Dynu did not understand the request",
};
const MINUTE = 60_000;
// an account answer is not worth asking again soon: the engine waits at least this long (an edit of the record starts over)
const REFUSED_WAIT_MS = 6 * 60 * MINUTE;
// Dynu suspends the client for 10 minutes after a 911
const SERVER_ERROR_WAIT_MS = 10 * MINUTE;
// the answers a later try can fix
const RETRY = new Set(["911", "servererror", "dnserr"]);
// the answers about the account (a refused sign-in, an unknown host, a blocked client): no more updates until the user
// acts, as the protocol asks of a client
const STOPPED = new Set(["nohost", "badauth", "abuse", "!donator"]);

// how long the engine leaves the record alone: 10 minutes after a 911, 6 hours after another refusal, no floor for the
// other retried answers (a stopped record waits for the user)
const waitOf = (code) => {
	if (code === "911") return SERVER_ERROR_WAIT_MS;
	return RETRY.has(code) || STOPPED.has(code) ? undefined : REFUSED_WAIT_MS;
};

/**
 * Dynu: one GET to the IP update protocol with the host name always sent (a call with the user name alone updates every
 * host of the account) and the account's user name and IP update password as Basic auth. Wildcard is a setting of the
 * Dynu panel, not a call, so no wildcard or alias record is offered.
 */
export default {
	id: "dynu",
	label: "Dynu",
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
		// the other family is blocked (`no`), so a call for one address never moves the other
		const address = encodeURIComponent(ip);
		const query = [
			`hostname=${encodeURIComponent(name)}`,
			`myip=${type === "AAAA" ? "no" : address}`,
			`myipv6=${type === "AAAA" ? address : "no"}`,
		].join("&");
		const basic = Buffer.from(`${fields.username}:${fields.password}`).toString("base64");
		const res = await fetch(`${ENDPOINT}?${query}`, {
			headers: { Authorization: `Basic ${basic}`, Accept: "text/plain" },
		});
		const first = res.text.split(LINE_BREAK)[0].trim();
		if (res.status >= 200 && res.status < 300 && GOOD.test(first)) return { meta: { ...meta }, created: false };
		const code = first.split(WHITESPACE)[0];
		if (Object.hasOwn(MESSAGES, code)) {
			throw new DdnsProviderError({
				providerStatus: res.status,
				code: RETRY.has(code) ? "failed" : "forbidden",
				message: `${MESSAGES[code]} (${code})`,
				retry: RETRY.has(code),
				retryAfterMs: waitOf(code),
				stop: STOPPED.has(code),
				secrets,
			});
		}
		failAnswer(res, { hint: HINT, secrets, refusedRetryAfterMs: REFUSED_WAIT_MS });
	},
};
