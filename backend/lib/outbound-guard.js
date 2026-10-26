import { lookup as dnsLookup } from "node:dns";
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

const blockedError = (host) =>
	Object.assign(new Error(`${host} resolves to an address outbound requests may not reach`), { code: "EBLOCKED" });

/**
 * A dns.lookup for net.connect that refuses a name when any of its addresses is blocked (so a name cannot mix an
 * allowed and a blocked address)
 */
const guardedLookup = (hostname, options, callback) => {
	dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
		if (err) return callback(err);
		if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
			return callback(blockedError(hostname));
		}
		if (options?.all) return callback(null, addresses);
		return callback(null, addresses[0].address, addresses[0].family);
	});
};

// for undici fetch: every connection, also after a redirect, goes through the guarded lookup
const guardedAgent = new Agent({ connect: { lookup: guardedLookup } });

export { blockedError, guardedAgent, guardedLookup, isBlockedAddress };
