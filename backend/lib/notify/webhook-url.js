import { isIP } from "node:net";
import { isBlockedAddress, isPrivateLanAddress } from "../blocked-address.js";
import { blockedError, lookupAll } from "../outbound-guard.js";

const MAX_URL_LENGTH = 2048;
const HINT_PATH_LENGTH = 40;
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
	if (parsed.username || parsed.password) return { error: "webhook-url-userinfo" };
	if (!parsed.hostname) return { error: "webhook-url-invalid" };
	return { url: value, privateOnly: parsed.protocol === "http:" };
};

/**
 * @param   {String}  url  a validated URL
 * @returns {String}  scheme, host, port and the first 40 characters of the path; never the query or fragment
 */
const urlHint = (url) => {
	const parsed = new URL(url);
	return `${parsed.protocol}//${parsed.host}${parsed.pathname.slice(0, HINT_PATH_LENGTH)}`;
};

const targetError = (code, message) => Object.assign(new Error(message), { code, message_i18n: `error.${code}` });

/**
 * Resolves the URL's host and refuses it when any address is blocked, when a name does not resolve, or (for
 * `http://`) when any address is not a private LAN address. The delivery itself connects through
 * `createGuardedAgent`, which checks again at connect time.
 *
 * @param   {String}  url
 * @returns {Promise<void>}  rejects with the guard's EBLOCKED error or a `webhook-host-unresolved` error
 */
const checkWebhookTarget = async (url) => {
	const parsed = new URL(url);
	const name = parsed.hostname.replace(BRACKETS, "");
	let addresses;
	if (isIP(name) === 0) {
		try {
			addresses = await lookupAll(name);
		} catch {
			throw targetError("webhook-host-unresolved", `${name} does not resolve`);
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

export { checkWebhookTarget, MAX_URL_LENGTH, urlHint, validateWebhookUrl };
