import { DdnsProviderError } from "../errors.js";
import { presetSecrets } from "../presets.js";
import { refuseWildcard, relativeName } from "./record-common.js";
import { failAnswer } from "./zone-common.js";

const ENDPOINT = "https://dynamicdns.park-your-domain.com/update";
const HINT =
	"Check the domain and its Dynamic DNS password (Advanced DNS tab), and that the host exists as an A + Dynamic DNS record";
// an answer about the account: the engine waits at least this long (an edit of the record starts over)
const REFUSED_WAIT_MS = 6 * 60 * 60_000;
const DECLARATION = /^\s*<\?xml[^>]*\?>/iu;
const ERR_COUNT = /<ErrCount>\s*(?<count>\d+)\s*<\/ErrCount>/iu;
const FIRST_ERROR = /<Err1>(?<text>[^<]*)<\/Err1>/iu;
const ENTITIES = [
	[/&lt;/gu, "<"],
	[/&gt;/gu, ">"],
	[/&quot;/gu, '"'],
	[/&apos;/gu, "'"],
	[/&amp;/gu, "&"],
];

const unescapeXml = (text) => ENTITIES.reduce((out, [pattern, to]) => out.replace(pattern, to), text);

/**
 * The answer is XML with a utf-16 declaration on a payload that is not utf-16: the declaration is dropped before it is
 * read. A document without a single ErrCount is no answer.
 *
 * @returns {{ count: number, message: string|null }|null}
 */
const readAnswer = (text) => {
	const body = text.replace(DECLARATION, "").trim();
	const count = ERR_COUNT.exec(body)?.groups.count;
	if (count === undefined || !body.startsWith("<")) return null;
	const message = FIRST_ERROR.exec(body)?.groups.text;
	return { count: Number(count), message: message ? unescapeXml(message.trim()) : null };
};

/**
 * Namecheap Dynamic DNS: one GET with the host, the domain, the domain's Dynamic DNS password and the address. IPv4
 * only (an A record), no wildcard or alias claim. The password travels in the query string, so every call gets it as a
 * secret and the URL never reaches a message. The host must exist first as an A + Dynamic DNS record at Namecheap.
 */
export default {
	id: "namecheap",
	label: "Namecheap",
	credentialProvider: null,
	recordTypes: ["A"],
	proxied: false,
	ipv6: false,
	adminOnly: false,
	wildcards: false,
	aliases: false,
	zoneless: true,
	preset: true,
	read: () => Promise.resolve(null),
	/** A 2xx answer with ErrCount 0 is a success; ErrCount above 0 is a refusal with its first message */
	async write({ name, type, ip, fields, fetch, meta }) {
		const secrets = presetSecrets(fields);
		if (type !== "A") {
			throw new DdnsProviderError({
				code: "failed",
				message: "Namecheap updates IPv4 (A) records only",
				retry: false,
			});
		}
		refuseWildcard(name);
		if (typeof fields.domain !== "string" || fields.domain === "" || secrets.length === 0) {
			throw new DdnsProviderError({
				code: "forbidden",
				message: "The domain or the password is missing",
				retry: false,
			});
		}
		const query = [
			`host=${encodeURIComponent(relativeName(fields.domain, name))}`,
			`domain=${encodeURIComponent(fields.domain)}`,
			`password=${encodeURIComponent(fields.password)}`,
			`ip=${encodeURIComponent(ip)}`,
		].join("&");
		const res = await fetch(`${ENDPOINT}?${query}`, { headers: { Accept: "text/xml, */*" } });
		const answer = res.status >= 200 && res.status < 300 ? readAnswer(res.text) : null;
		if (answer?.count === 0) return { meta: { ...meta }, created: false };
		if (answer) {
			throw new DdnsProviderError({
				providerStatus: res.status,
				code: "forbidden",
				message: `Access refused (${res.status}): ${answer.message ?? "Namecheap reported an error"}`,
				retry: false,
				retryAfterMs: REFUSED_WAIT_MS,
				secrets,
			});
		}
		failAnswer(res, { hint: HINT, secrets, refusedRetryAfterMs: REFUSED_WAIT_MS });
	},
};
