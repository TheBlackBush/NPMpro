import { BlockList, isIP } from "node:net";

// The address checks of the outbound guard, in a module that imports only node:net: the runtime rule table uses them
// and is loaded by the frontend tests, where the backend's packages are not installed.

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

export { isBlockedAddress, isPrivateLanAddress };
