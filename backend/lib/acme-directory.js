import dns from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";
import errs from "./error.js";
import { blockedError, createGuardedAgent, isBlockedAddress } from "./outbound-guard.js";

// fetch comes from the npm undici package like the dispatchers: Node's built-in fetch rejects an Agent of another
// undici version (UND_ERR_INVALID_ARG).
// The one read of an ACME directory: the profile check of a save, the profile list, the EAB requirement and whether
// a CA can be reached before it registers. A URL typed in the UI is guarded (D6); an ACME_SERVER env value is not.

const DIRECTORY_TIMEOUT = 10_000;
const CACHE_MS = 5 * 60_000;
const BRACKETS = /^\[|\]$/gu;
const PROFILE_NAME = /^[A-Za-z0-9._-]{1,64}$/u;
const MAX_DESCRIPTION = 500;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CACHE_ENTRIES = 32;

const cache = new Map();
const agents = new Map();

// tests (NPMPRO_TEST_ROOT set) read through the global dispatcher (undici MockAgent) with NPMPRO_TEST_OUTBOUND=mock;
// the host check still runs. Never honoured outside the test root, like NPMPRO_TEST_ARGON2 (lib/argon2.js).
const testDispatcher = () => Boolean(process.env.NPMPRO_TEST_ROOT) && process.env.NPMPRO_TEST_OUTBOUND === "mock";

/**
 * @param   {{guarded: boolean, verify: boolean}}  options
 * @returns {Agent|undefined}  undefined: the global dispatcher (a verified trusted read, or the tests)
 */
const dispatcherFor = ({ guarded, verify }) => {
	if (testDispatcher() || (!guarded && verify)) return;
	const key = `${guarded}:${verify}`;
	if (!agents.has(key)) {
		agents.set(
			key,
			guarded
				? createGuardedAgent({ rejectUnauthorized: verify })
				: new Agent({ connect: { rejectUnauthorized: false } }),
		);
	}
	return agents.get(key);
};

const lookupAll = (host) =>
	new Promise((resolve, reject) => {
		// node:dns at call time, so a test's dns.lookup is the one used
		dns.lookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
	});

/**
 * Refuses a URL whose host is, or resolves to, an address the outbound guard blocks; a name that does not resolve
 * passes (the read then reports the CA as not reachable)
 *
 * @param   {string}  url
 * @returns {Promise<void>}  rejects with the guard's EBLOCKED error
 */
const assertAllowedHost = async (url) => {
	const host = new URL(url).hostname.replace(BRACKETS, "");
	if (isIP(host) !== 0) {
		if (isBlockedAddress(host)) throw blockedError(host);
		return;
	}
	let addresses;
	try {
		addresses = await lookupAll(host);
	} catch {
		return;
	}
	if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) throw blockedError(host);
};

const isBlocked = (err) => {
	for (let cause = err; cause; cause = cause.cause) if (cause.code === "EBLOCKED") return true;
	return false;
};

const blockedValidation = (url, err) =>
	new errs.ValidationError(
		`The address of ${new URL(url).hostname} is not allowed (this host, link-local or multicast)`,
		"error.acme-blocked",
		{ cause: err },
	);

const unreachable = (error) => ({
	reachable: false,
	directory: false,
	external_account_required: false,
	profiles: {},
	error: String(error),
});

const directoryOf = (body) => {
	const meta = body !== null && typeof body === "object" ? body.meta : undefined;
	const profiles = meta?.profiles !== null && typeof meta?.profiles === "object" ? meta.profiles : {};
	return {
		reachable: true,
		directory: typeof body?.newNonce === "string",
		external_account_required: meta?.externalAccountRequired === true,
		profiles: Object.fromEntries(
			Object.entries(profiles)
				.filter(([name]) => PROFILE_NAME.test(name))
				.map(([name, text]) => [name, typeof text === "string" ? text.slice(0, MAX_DESCRIPTION) : ""]),
		),
	};
};

/**
 * The body as JSON, read as a stream and refused (null) beyond MAX_BODY_BYTES or when it is no JSON
 *
 * @param   {Response}  res
 * @returns {Promise<{body: *, tooLarge: boolean}>}
 */
const readBody = async (res) => {
	const reader = res.body?.getReader();
	if (!reader) return { body: null, tooLarge: false };
	const chunks = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel().catch(() => {});
			return { body: null, tooLarge: true };
		}
		chunks.push(value);
	}
	try {
		return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")), tooLarge: false };
	} catch {
		return { body: null, tooLarge: false };
	}
};

const remember = (key, result) => {
	const now = Date.now();
	for (const [name, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(name);
	cache.delete(key);
	cache.set(key, { at: now, result });
	while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
};

/**
 * @param   {string}   url
 * @param   {Object}   [options]
 * @param   {boolean}  [options.verify]   false: the CA's TLS certificate is not verified (server_tls_verify)
 * @param   {boolean}  [options.guarded]  false only for the operator's ACME_SERVER (isTrustedServer)
 * @param   {boolean}  [options.fresh]    skip the 5 minute cache (a save's check, a registration)
 * @returns {Promise<{reachable: boolean, directory: boolean, external_account_required: boolean,
 *           profiles: Object<string, string>, error?: string}>}
 */
const readAcmeDirectory = async (url, { verify = true, guarded = true, fresh = false } = {}) => {
	const key = `${url}|${verify}|${guarded}`;
	const hit = cache.get(key);
	if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return structuredClone(hit.result);
	if (guarded) {
		try {
			await assertAllowedHost(url);
		} catch (err) {
			throw blockedValidation(url, err);
		}
	}
	let result;
	try {
		const res = await fetch(url, {
			headers: { accept: "application/json" },
			redirect: "manual",
			signal: AbortSignal.timeout(DIRECTORY_TIMEOUT),
			dispatcher: dispatcherFor({ guarded, verify }),
		});
		if (res.status >= 500) {
			await res.body?.cancel().catch(() => {});
			result = unreachable(`HTTP ${res.status}`);
		} else if (res.ok) {
			const { body, tooLarge } = await readBody(res);
			result = tooLarge ? unreachable("TOO_LARGE") : directoryOf(body);
		} else {
			await res.body?.cancel().catch(() => {});
			result = directoryOf(null);
		}
	} catch (err) {
		if (isBlocked(err)) throw blockedValidation(url, err);
		result = unreachable(err.cause?.code ?? err.name ?? "error");
	}
	if (result.reachable) remember(key, result);
	return structuredClone(result);
};

const clearAcmeDirectoryCache = () => cache.clear();
const cacheSize = () => cache.size;

export { assertAllowedHost, cacheSize, clearAcmeDirectoryCache, dispatcherFor, readAcmeDirectory };
