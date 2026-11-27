import { isIP } from "node:net";
import { isBlockedAddress, isPrivateLanAddress } from "../blocked-address.js";
import { blockedError, lookupAll } from "../outbound-guard.js";

const MAX_URL_LENGTH = 2048;
const HINT_PATH_LENGTH = 40;
const HINT_HOST_LENGTH = 200;
const PARTIAL_ESCAPE = /%[0-9A-Fa-f]?$/u;
// a resolver answer that says the name does not exist: a settings problem, not a passing outage
const NO_SUCH_NAME = new Set(["ENOTFOUND", "ENODATA"]);
const EMPTY_USERINFO = /^[a-z]+:\/\/[^/?#]*@/iu;
const BRACKETS = /^\[|\]$/gu;

/**
 * @param   {String}  text
 * @returns {{url: String, privateOnly: Boolean}|{error: String}}  `https://` any host; `http://` only to private LAN
 *                                                                 addresses (privateOnly); no user info; at most 2048 characters
 */
const validateWebhookUrl = (text) => {
	const value = String(text ?? "").trim();
	if (value.length === 0 || value.length > MAX_URL_LENGTH) return { error: "webhook-url-invalid" };
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		return { error: "webhook-url-invalid" };
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { error: "webhook-url-scheme" };
	// any user info, also an empty one ("https://:@host")
	if (parsed.username || parsed.password || EMPTY_USERINFO.test(value)) {
		return { error: "webhook-url-userinfo" };
	}
	if (!parsed.hostname) return { error: "webhook-url-invalid" };
	return { url: parsed.href, privateOnly: parsed.protocol === "http:" };
};

/**
 * @param   {String}  pathname
 * @returns {String}  the first 40 characters of the path that the hint shows, never cut inside a percent escape
 */
const hintPath = (pathname) => pathname.slice(0, HINT_PATH_LENGTH).replace(PARTIAL_ESCAPE, "");

/**
 * @param   {String}  url  a validated URL
 * @returns {String}  scheme, host and port (the first 200 characters), and the first 40 characters of the path; never
 *                    the query or fragment; at most 248 characters (the column holds 253)
 */
const urlHint = (url) => {
	const parsed = new URL(url);
	return `${parsed.protocol}//${parsed.host.slice(0, HINT_HOST_LENGTH)}${hintPath(parsed.pathname)}`;
};

const targetError = (code, message) => Object.assign(new Error(message), { code, message_i18n: `error.${code}` });

/**
 * Resolves the URL's host and refuses it when any address is blocked, when a name does not resolve, or (for
 * `http://`) when any address is not a private LAN address. The delivery itself connects through
 * `createGuardedAgent`, which checks again at connect time.
 *
 * @param   {String}  url
 * @returns {Promise<void>}  rejects with the guard's EBLOCKED error a `webhook-host-unresolved` error, or a `webhook-host-lookup-failed` error with `temporary: true` (a resolver outage)
 */
const checkWebhookTarget = async (url) => {
	const parsed = new URL(url);
	const name = parsed.hostname.replace(BRACKETS, "");
	let addresses;
	if (isIP(name) === 0) {
		try {
			addresses = await lookupAll(name);
		} catch (err) {
			if (NO_SUCH_NAME.has(err?.code)) throw targetError("webhook-host-unresolved", `${name} does not resolve`);
			throw Object.assign(
				targetError("webhook-host-lookup-failed", `${name} could not be looked up (${err?.code ?? "error"})`),
				{ temporary: true },
			);
		}
		if (addresses.length === 0) throw targetError("webhook-host-unresolved", `${name} does not resolve`);
	} else {
		addresses = [{ address: name, family: isIP(name) }];
	}
	const plain = parsed.protocol === "http:";
	if (addresses.some(({ address }) => isBlockedAddress(address) || (plain && !isPrivateLanAddress(address)))) {
		throw blockedError(name);
	}
};

export { checkWebhookTarget, hintPath, MAX_URL_LENGTH, urlHint, validateWebhookUrl };
