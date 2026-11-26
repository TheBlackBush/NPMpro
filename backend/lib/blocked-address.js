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

const GROUPS = 8;
const HEX = 16;
const BYTE_RANGE = 256;

/**
 * The IPv4 address an IPv6 address carries in its last 32 bits when it is IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible
 * (::a.b.c.d) or IPv4-translated (::ffff:0:a.b.c.d), in any spelling (dotted or hex groups); null for any other
 *
 * @param   {String}  ip  an IPv6 address without brackets
 * @returns {String|null}
 */
const embeddedIpv4 = (ip) => {
	let host;
	try {
		host = new URL(`http://[${ip.split("%")[0]}]/`).hostname.slice(1, -1);
	} catch {
		return null;
	}
	const [head, tail] = host.split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups = (
		tail === undefined
			? left
			: [...left, ...Array.from({ length: GROUPS - left.length - right.length }, () => "0"), ...right]
	).map((group) => Number.parseInt(group, HEX));
	if (groups.length !== GROUPS || groups.slice(0, 4).some((group) => group !== 0)) return null;
	const [, , , , g4, g5, high, low] = groups;
	const compatible = g4 === 0 && g5 === 0;
	const mapped = g4 === 0 && g5 === 0xffff;
	const translated = g4 === 0xffff && g5 === 0;
	if (!(compatible || mapped || translated)) return null;
	return [Math.floor(high / BYTE_RANGE), high % BYTE_RANGE, Math.floor(low / BYTE_RANGE), low % BYTE_RANGE].join(".");
};

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
	const embedded = family === 6 ? embeddedIpv4(ip) : null;
	if (embedded && isBlockedAddress(embedded)) return true;
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
