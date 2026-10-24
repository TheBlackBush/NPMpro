import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

const keyLength = 32;

const groupsOf = (part) => (part === "" ? [] : part.split(":"));

/** The eight 16 bit groups of a valid IPv6 address (an IPv4 tail becomes the last two groups). */
const expandIpv6 = (ip) => {
	let text = ip;
	const lastColon = text.lastIndexOf(":");
	const tail = text.slice(lastColon + 1);
	if (tail.includes(".")) {
		const [a, b, c, d] = tail.split(".").map(Number);
		text = `${text.slice(0, lastColon + 1)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
	}
	const [head, rest] = text.split("::");
	const left = groupsOf(head);
	const right = rest === undefined ? [] : groupsOf(rest);
	const zeros = new Array(8 - left.length - right.length).fill("0");
	return [...left, ...(rest === undefined ? [] : zeros), ...right].map((g) => Number.parseInt(g, 16));
};

/**
 * The value a visitor is counted by: IPv4 as is, IPv4-mapped IPv6 (also `::ffff:cb00:7107`) as plain IPv4,
 * other IPv6 as its /64 network in a fixed form (`2001:db8:1:2::/64`: lower case, no leading zeros, zone id
 * dropped), since one device often changes its address within the /64 during a day.
 * Anything that is not an IP address is returned unchanged.
 *
 * @param   {String}  ip
 * @returns {String}
 */
const normaliseIp = (ip) => {
	const plain = String(ip).split("%")[0];
	if (isIP(plain) === 4) return plain;
	if (isIP(plain) !== 6) return ip;
	const g = expandIpv6(plain.toLowerCase());
	if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
		return [Math.floor(g[6] / 256), g[6] % 256, Math.floor(g[7] / 256), g[7] % 256].join(".");
	}
	return `${g
		.slice(0, 4)
		.map((n) => n.toString(16))
		.join(":")}::/64`;
};

/**
 * @param   {Buffer}  key
 * @returns {(ip: String) => String} 32 lowercase hex characters
 */
const createVisitorHasher = (key) => (ip) =>
	createHmac("sha256", key).update(normaliseIp(ip)).digest().subarray(0, 16).toString("hex");

const readKey = (meta, box) => {
	if (typeof meta?.visitor_key !== "string") return null;
	try {
		const key = Buffer.from(String(box.decrypt(meta.visitor_key)), "base64");
		return key.length === keyLength ? key : null;
	} catch {
		return null;
	}
};

/**
 * Loads the visitor key from the traffic meta, or creates and stores a new one.
 * `created` is true when a new key replaced a missing or unusable one.
 *
 * @param   {Object}  options
 * @param   {() => Promise<Object|undefined>}  options.readMeta
 * @param   {(meta: Object) => Promise<void>}  options.writeMeta
 * @param   {{encrypt: Function, decrypt: Function}}  options.box
 * @returns {Promise<{key: Buffer, created: Boolean}>}
 */
const loadVisitorKey = async ({ readMeta, writeMeta, box }) => {
	const meta = await readMeta();
	const existing = readKey(meta, box);
	if (existing) return { key: existing, created: false };
	const key = randomBytes(keyLength);
	await writeMeta({ ...meta, visitor_key: box.encrypt(key.toString("base64")) });
	return { key, created: true };
};

export { createVisitorHasher, loadVisitorKey, normaliseIp };
