import crypto from "node:crypto";

// An API token is npmpro_<lookup id>_<secret>: the lookup id (8 random bytes, hex) finds the row, the secret (32
// random bytes, base64url) is checked against its SHA-256. A 256-bit random secret cannot be guessed, so a fast hash is
// enough, and the check runs on every request.

const TOKEN_PREFIX = "npmpro_";
const TOKEN_FORM = /^npmpro_(?<lookupId>[0-9a-f]{16})_(?<secret>[\w-]{43})$/u;
const BEARER = /^Bearer +(?<value>\S*) *$/iu;
const BEARER_SCHEME = /^Bearer(?: |$)/iu;

/** @returns {string} the SHA-256 of a secret, hex */
const hashSecret = (secret) => crypto.createHash("sha256").update(secret, "utf8").digest("hex");

/** @returns {{token: string, lookupId: string, secretHash: string}} a new token; only secretHash is stored */
const generateApiToken = () => {
	const lookupId = crypto.randomBytes(8).toString("hex");
	const secret = crypto.randomBytes(32).toString("base64url");
	return { token: `${TOKEN_PREFIX}${lookupId}_${secret}`, lookupId, secretHash: hashSecret(secret) };
};

/** @returns {?{lookupId: string, secret: string}} the parts of a token text, null for any other text */
const parseApiToken = (text) => {
	const match = typeof text === "string" ? TOKEN_FORM.exec(text) : null;
	return match ? { lookupId: match.groups.lookupId, secret: match.groups.secret } : null;
};

/** @returns {boolean} whether the secret's hash is the stored one, compared in constant time */
const secretMatches = (secret, storedHex) => {
	const given = Buffer.from(hashSecret(secret), "hex");
	const stored = Buffer.from(String(storedHex ?? ""), "hex");
	return given.length === stored.length && crypto.timingSafeEqual(given, stored);
};

/**
 * @param   {string|undefined} header  the Authorization header
 * @returns {?string} null without a bearer; the token text, or "" for a bearer header without a single token
 */
const bearerOf = (header) => {
	if (typeof header !== "string" || !BEARER_SCHEME.test(header.trim())) return null;
	return BEARER.exec(header.trim())?.groups.value ?? "";
};

export { bearerOf, generateApiToken, hashSecret, parseApiToken, secretMatches, TOKEN_PREFIX };
