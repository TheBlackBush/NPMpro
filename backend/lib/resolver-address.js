import { isIPv4, isIPv6 } from "node:net";

// the nginx resolver's DNS servers: an IPv4 address or an IPv6 address in brackets, each with an optional port
const MAX_ADDRESSES = 8;
const ADDRESS = /^(?<host>[0-9]{1,3}(?:\.[0-9]{1,3}){3}|\[[0-9A-Fa-f:.]+\])(?::(?<port>[0-9]{1,5}))?$/u;

/**
 * @param   {string}  text  one address such as 1.1.1.1, 1.1.1.1:53, [2606:4700::1111] or [2606:4700::1111]:5353
 * @returns {boolean}  no host name and no bare IPv6 address
 */
const isResolverAddress = (text) => {
	const groups = typeof text === "string" ? ADDRESS.exec(text)?.groups : undefined;
	if (!groups) return false;
	const { host, port } = groups;
	if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return false;
	return host.startsWith("[") ? isIPv6(host.slice(1, -1)) : isIPv4(host);
};

/**
 * @param   {Array<string>}  list
 * @returns {string|null}  null when valid, else the message: at most 8, no duplicates, each a resolver address
 */
const resolverAddressList = (list) => {
	if (!Array.isArray(list)) return "must be a list of DNS server addresses";
	if (list.length > MAX_ADDRESSES) return `must have at most ${MAX_ADDRESSES} addresses`;
	const bad = list.find((entry) => !isResolverAddress(entry));
	if (bad !== undefined) {
		return `"${bad}" is not a DNS server address (an IPv4 address or an IPv6 address in brackets, with an optional :port)`;
	}
	const duplicate = list.find((entry, index) => list.indexOf(entry) !== index);
	return duplicate === undefined ? null : `"${duplicate}" is listed twice`;
};

export { isResolverAddress, MAX_ADDRESSES, resolverAddressList };
