import dns from "node:dns";
import { isIP } from "node:net";
import { Agent, buildConnector } from "undici";
import { isBlockedAddress, isPrivateLanAddress } from "./blocked-address.js";

const blockedError = (host) =>
	Object.assign(new Error(`${host} resolves to an address outbound requests may not reach`), { code: "EBLOCKED" });

/**
 * @returns {Boolean}  true when outbound reads go through the global undici dispatcher (a MockAgent): only in the
 *                     test root with NPMPRO_TEST_OUTBOUND=mock, never honoured in the image (like NPMPRO_TEST_ARGON2)
 */
const isTestOutbound = () => Boolean(process.env.NPMPRO_TEST_ROOT) && process.env.NPMPRO_TEST_OUTBOUND === "mock";

const BRACKETS = /^\[|\]$/gu;

const lookupAll = (host) =>
	new Promise((resolve, reject) => {
		// node:dns at call time, so a test's dns.lookup is the one used
		dns.lookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
	});

/**
 * Refuses a host (or the host of a URL) that is, or resolves to, an address the guard blocks; a name that does not
 * resolve passes (the request then fails on its own)
 *
 * @param   {String}  hostOrUrl
 * @returns {Promise<void>}  rejects with the guard's EBLOCKED error
 */
const assertAllowedHost = async (hostOrUrl) => {
	const text = String(hostOrUrl);
	const host = (text.includes("://") ? new URL(text).hostname : text).replace(BRACKETS, "");
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

/**
 * A dns.lookup for net.connect that refuses a name when any of its addresses is blocked (so a name cannot mix an
 * allowed and a blocked address). With privateOnly every address must also be a private LAN address, and with family
 * only that family is asked for. dns.lookup is read at call time, so tests can stub it. The connection goes to an
 * address this lookup returned, never to a second answer.
 */
const makeLookup =
	({ privateOnly = false, family } = {}) =>
	(hostname, options, callback) => {
		const done = typeof options === "function" ? options : callback;
		const asked = typeof options === "function" ? {} : options;
		dns.lookup(hostname, { ...asked, ...(family ? { family } : {}), all: true }, (err, addresses) => {
			if (err) return done(err);
			if (
				addresses.length === 0 ||
				addresses.some(
					({ address }) => isBlockedAddress(address) || (privateOnly && !isPrivateLanAddress(address)),
				)
			) {
				return done(blockedError(hostname));
			}
			if (asked?.all) return done(null, addresses);
			return done(null, addresses[0].address, addresses[0].family);
		});
	};

// a host written as an IP address that the agent may not connect to (net.connect never looks such a host up)
const refusesLiteral = (host, privateOnly) =>
	isIP(host) !== 0 && (isBlockedAddress(host) || (privateOnly && !isPrivateLanAddress(host)));

/**
 * An undici Agent that refuses a blocked address before it connects: a host written as an IP address is checked
 * before the connection is opened, a name goes through the guarded lookup. Both apply to every connection, also after
 * a redirect.
 *
 * @param   {Object}   [options]
 * @param   {boolean}  [options.rejectUnauthorized]  false: the server's TLS certificate is not verified
 * @param   {number}   [options.family]              4 or 6: the lookup asks only for that family
 * @param   {boolean}  [options.privateOnly]         only private LAN addresses may be connected to (names and IPs)
 * @param   {string}   [options.servername]          the TLS server name (SNI), for a connection to an IP address
 * @param   {Object}   [seams]
 * @param   {Function} [seams.build]                 tests: builds the connector (undici's buildConnector)
 * @returns {Agent}
 */
const createGuardedAgent = (
	{ rejectUnauthorized = true, family, privateOnly = false, servername } = {},
	{ build = buildConnector } = {},
) => {
	const connect = build({
		lookup: makeLookup({ family, privateOnly }),
		rejectUnauthorized,
		...(servername ? { servername } : {}),
	});
	return new Agent({
		connect: (opts, callback) => {
			const host = String(opts.hostname ?? "").replace(BRACKETS, "");
			if (refusesLiteral(host, privateOnly)) return callback(blockedError(host), null);
			return connect(opts, callback);
		},
	});
};

// for undici fetch: every connection, also after a redirect, is checked before it opens
const guardedAgent = createGuardedAgent();

export { assertAllowedHost, blockedError, createGuardedAgent, guardedAgent, isTestOutbound, lookupAll };
