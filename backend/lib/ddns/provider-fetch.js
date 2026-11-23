import { isIP } from "node:net";
import { fetch } from "undici";
import { isPrivateLanAddress } from "../blocked-address.js";
import { assertAllowedHost, createGuardedAgent, guardedAgent, isTestOutbound, lookupAll } from "../outbound-guard.js";
import { DdnsProviderError } from "./errors.js";

// The one door for DNS provider API calls (zone lists, record reads and writes, IP echo): https only, the outbound
// guard before any byte and again at connect, no redirect followed, a timeout, and no secret in any message.

const BRACKETS = /^\[|\]$/gu;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const agents = new Map();

/**
 * @returns {Agent|undefined}  undefined: the global dispatcher (the tests)
 */
const agentFor = ({ family, privateOnly }) => {
	if (isTestOutbound()) return;
	if (!family && !privateOnly) return guardedAgent;
	const key = `${family ?? 0}:${privateOnly}`;
	if (!agents.has(key)) agents.set(key, createGuardedAgent({ family, privateOnly }));
	return agents.get(key);
};

const hasCode = (err, code) => {
	for (let cause = err; cause; cause = cause.cause) if (cause.code === code) return true;
	return false;
};

const isTimeout = (err) =>
	err?.name === "TimeoutError" || err?.name === "AbortError" || hasCode(err, "UND_ERR_CONNECT_TIMEOUT");

const timedOut = (secrets) =>
	new DdnsProviderError({ code: "timeout", message: "The provider did not answer in time", secrets });

const readText = async (res) => {
	const reader = res.body?.getReader();
	if (!reader) return "";
	const chunks = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel().catch(() => {});
			throw new DdnsProviderError({ code: "network", message: "The provider's answer is too large" });
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
};

const parseJson = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

const checkedBlocked = async (url, secrets) => {
	try {
		await assertAllowedHost(url);
	} catch (err) {
		throw new DdnsProviderError({
			code: "blocked",
			message: err.message,
			retry: false,
			secrets,
		});
	}
};

/**
 * D12: plain http is only for a host that is a private LAN address, or a name whose every address is one. The same
 * rule is enforced again by the connection's own lookup (privateOnly), so the address checked is the address used.
 */
const assertPrivateLanHost = async (url, secrets) => {
	const host = new URL(url).hostname.replace(BRACKETS, "");
	const notHttps = () =>
		new DdnsProviderError({
			code: "not-https",
			message: "Only https is allowed here (http only to a private LAN address)",
			retry: false,
			secrets,
		});
	if (isIP(host) !== 0) {
		if (!isPrivateLanAddress(host)) throw notHttps();
		return;
	}
	let addresses;
	try {
		addresses = await lookupAll(host);
	} catch (err) {
		throw new DdnsProviderError({
			code: "network",
			message: `Could not resolve ${host}: ${err.code ?? "error"}`,
			secrets,
		});
	}
	if (addresses.length === 0 || !addresses.every(({ address }) => isPrivateLanAddress(address))) throw notHttps();
};

/**
 * @param   {String}  url
 * @param   {Object}  [options]
 * @param   {String}  [options.method]
 * @param   {Object}  [options.headers]
 * @param   {*}       [options.body]
 * @param   {String[]} [options.secrets]  values scrubbed from every error message
 * @param   {number}  [options.family]    4 or 6: only that family is connected to
 * @param   {number}  [options.timeoutMs]
 * @param   {boolean} [options.allowPrivateHttp]  http allowed to a private LAN address only
 * @param   {AbortSignal} [options.deadline]  the deadline of the whole job (all pages of a list): once it fires, the
 *                                            call in flight and every later call end with code timeout
 * @returns {Promise<{status: number, headers: Headers, text: String, json: *}>}  never throws for a 4xx or 5xx
 */
const providerFetch = async (
	url,
	{
		method = "GET",
		headers = {},
		body,
		secrets = [],
		family,
		timeoutMs = 10_000,
		allowPrivateHttp = false,
		deadline,
	} = {},
) => {
	if (deadline?.aborted) throw timedOut(secrets);
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new DdnsProviderError({ code: "not-https", message: "The address is not a valid URL", retry: false });
	}
	const plainHttp = parsed.protocol === "http:";
	if (parsed.protocol !== "https:" && !(plainHttp && allowPrivateHttp)) {
		throw new DdnsProviderError({ code: "not-https", message: "Only https is allowed here", retry: false });
	}
	await checkedBlocked(url, secrets);
	if (plainHttp) await assertPrivateLanHost(url, secrets);

	try {
		const res = await fetch(url, {
			method,
			headers,
			body,
			redirect: "manual",
			signal: deadline
				? AbortSignal.any([AbortSignal.timeout(timeoutMs), deadline])
				: AbortSignal.timeout(timeoutMs),
			dispatcher: agentFor({ family, privateOnly: plainHttp }),
		});
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel().catch(() => {});
			throw new DdnsProviderError({
				providerStatus: res.status,
				code: "redirect",
				message: `The provider answered with a redirect (HTTP ${res.status})`,
				retry: false,
				secrets,
			});
		}
		const text = await readText(res);
		return { status: res.status, headers: res.headers, text, json: parseJson(text) };
	} catch (err) {
		if (err instanceof DdnsProviderError) throw err;
		if (hasCode(err, "EBLOCKED")) {
			throw new DdnsProviderError({
				code: "blocked",
				message: err.cause?.message ?? err.message,
				retry: false,
				secrets,
			});
		}
		if (isTimeout(err)) throw timedOut(secrets);
		throw new DdnsProviderError({
			code: "network",
			message: `The provider could not be reached (${err.cause?.code ?? err.name ?? "error"})`,
			secrets,
		});
	}
};

export { providerFetch };
