import { createHash } from "node:crypto";

/**
 * A 53-bit number for a cleaned path (a safe integer, the first 53 bits of its SHA-1). The per day cap sets keep this
 * number instead of the string; a collision only means a path is not counted against the cap, never a wrong stored
 * path.
 *
 * @param   {string}  path
 * @returns {number}
 */
const pathHash = (path) => {
	const digest = createHash("sha1").update(path).digest();
	return digest.readUInt32BE(0) * 2 ** 21 + (digest.readUInt32BE(4) >>> 11);
};

export { pathHash };
