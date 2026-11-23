import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

// Addresses an admin-supplied URL must not reach: the container itself and link-local (cloud metadata at
// 169.254.169.254), plus unspecified, multicast and reserved ranges. Private LAN ranges stay allowed: a self-hosted
// identity provider and its icon usually live there.
const blocked = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
]) {
	blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["fe80::", 10],
	["ff00::", 8],
]) {
	blocked.addSubnet(network, prefix, "ipv6");
}

// the private LAN ranges (RFC 1918 and unique local), the only addresses a plain http provider call may reach
const privateLan = new BlockList();
for (const [network, prefix] of [
	["10.0.0.0", 8],
	["172.16.0.0", 12],
	["192.168.0.0", 16],
]) {
	privateLan.addSubnet(network, prefix, "ipv4");
}
privateLan.addSubnet("fc00::", 7, "ipv6");

const IPV4_MAPPED = /^::ffff:(?<ipv4>\d+\.\d+\.\d+\.\d+)$/iu;

/**
 * @param   {String}  address  an IP address (brackets of an IPv6 URL host are removed)
 * @returns {Boolean}          true when an outbound request must not go there (also for anything that is not an IP)
 */
const isBlockedAddress = (address) => {
	const ip = String(address).replace(/^\[|\]$/gu, "");
	const mapped = IPV4_MAPPED.exec(ip)?.groups.ipv4;
	if (mapped) return isBlockedAddress(mapped);
	const family = isIP(ip);
	if (family === 0) return true;
	return blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
};

/**
 * @param   {String}  address  an IP address (brackets of an IPv6 URL host are removed)
 * @returns {Boolean}          true for 10/8, 172.16/12, 192.168/16, fc00::/7 and IPv4-mapped forms of those; an
 *                             address the guard blocks is never private LAN
 */
const isPrivateLanAddress = (address) => {
	const ip = String(address).replace(/^\[|\]$/gu, "");
	const mapped = IPV4_MAPPED.exec(ip)?.groups.ipv4;
	if (mapped) return isPrivateLanAddress(mapped);
	const family = isIP(ip);
	if (family === 0 || isBlockedAddress(ip)) return false;
	return privateLan.check(ip, family === 6 ? "ipv6" : "ipv4");
};

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
 * only that family is asked for. dns.lookup is read at call time, so tests can stub it. The connection goes to an address this lookup returned, never to a second answer.
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

/**
 * An undici Agent whose every connection (also after a redirect) goes through the guarded lookup
 *
 * @param   {Object}   [options]
 * @param   {boolean}  [options.rejectUnauthorized]  false: the server's TLS certificate is not verified
 * @param   {number}   [options.family]              4 or 6: the lookup asks only for that family
 * @param   {boolean}  [options.privateOnly]         only private LAN addresses may be connected to
 * @returns {Agent}
 */
const createGuardedAgent = ({ rejectUnauthorized = true, family, privateOnly = false } = {}) =>
	new Agent({ connect: { lookup: makeLookup({ family, privateOnly }), rejectUnauthorized } });

// for undici fetch: every connection, also after a redirect, goes through the guarded lookup
const guardedAgent = createGuardedAgent();

export {
	assertAllowedHost,
	blockedError,
	createGuardedAgent,
	guardedAgent,
	isBlockedAddress,
	isPrivateLanAddress,
	isTestOutbound,
	lookupAll,
};
