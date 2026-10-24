import { createHmac, randomBytes } from "node:crypto";

const keyLength = 32;
const mappedPrefix = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * Turns an IPv4-mapped IPv6 address into plain IPv4, leaves everything else unchanged.
 *
 * @param   {String}  ip
 * @returns {String}
 */
const normaliseIp = (ip) => {
	const match = mappedPrefix.exec(ip);
	return match ? match[1] : ip;
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
