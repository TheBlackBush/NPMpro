const GROUPS = 8;
const HEX_GROUP = /^[0-9a-f]{1,4}$/iu;
const GROUP_SIZE = 65_536n;
const HALF = 2n ** 64n;

/**
 * An IPv6 address (no zone, no embedded IPv4) as one number, or null when it is not one
 *
 * @param   {String} text
 * @returns {bigint|null}
 */
const toNumber = (text) => {
	if (typeof text !== "string" || text.length === 0 || text.length > 45) return null;
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const parse = (part) => (part === "" ? [] : part.split(":"));
	const head = parse(halves[0]);
	const tail = halves.length === 2 ? parse(halves[1]) : [];
	const missing = GROUPS - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
	const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
	if (groups.length !== GROUPS || !groups.every((group) => HEX_GROUP.test(group))) return null;
	return groups.reduce((total, group) => total * GROUP_SIZE + BigInt(`0x${group}`), 0n);
};

/** The shortest lower case spelling of an address number */
const toText = (value) => {
	const groups = [];
	for (let index = GROUPS - 1; index >= 0; index--) {
		groups.push(((value / GROUP_SIZE ** BigInt(index)) % GROUP_SIZE).toString(16));
	}
	return new URL(`http://[${groups.join(":")}]`).hostname.slice(1, -1);
};

/**
 * Whether text is an IPv6 interface id such as `::1` or `::a:b:c:d`: a valid IPv6 address with at most 64 bits set
 *
 * @param   {String} text
 * @returns {boolean}
 */
const isIpv6Suffix = (text) => {
	const value = toNumber(text);
	return value !== null && value < HALF;
};

/**
 * The first 64 bits of address and the last 64 bits of suffix
 *
 * @param   {String} address  an IPv6 address
 * @param   {String} suffix   an interface id
 * @returns {String}
 */
const withSuffix = (address, suffix) => {
	const base = toNumber(address);
	if (base === null) throw new Error("The address is not an IPv6 address");
	if (!isIpv6Suffix(suffix)) throw new Error("The suffix is not an IPv6 interface id of at most 64 bits");
	return toText((base / HALF) * HALF + toNumber(suffix));
};

/** An IPv6 address as one canonical string (to compare two spellings); other text is returned as it is */
const canonicalIpv6 = (text) => {
	const value = toNumber(text);
	return value === null ? text : toText(value);
};

export { canonicalIpv6, isIpv6Suffix, withSuffix };
