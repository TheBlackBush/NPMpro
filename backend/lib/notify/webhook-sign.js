import { createHmac, randomBytes } from "node:crypto";

const PREFIX = "whsec_";

/**
 * @returns {String}  a signing secret: "whsec_" and the base64 of 32 random bytes (the spec allows 24 to 64)
 */
const newSecret = () => `${PREFIX}${randomBytes(32).toString("base64")}`;

const MIN_KEY_BYTES = 24;

// the key is the bytes of the base64 part after the prefix, not its text; a bad secret is a caller bug
const keyOf = (secret) => {
	if (typeof secret !== "string" || !secret.startsWith(PREFIX)) {
		throw new TypeError("A webhook secret starts with whsec_");
	}
	const key = Buffer.from(secret.slice(PREFIX.length), "base64");
	if (key.length < MIN_KEY_BYTES) throw new TypeError(`A webhook secret holds at least ${MIN_KEY_BYTES} bytes`);
	return key;
};

const assertInputs = (id, timestamp) => {
	if (typeof id !== "string" || id.length === 0 || id.includes(".")) throw new TypeError("A webhook id has no dot");
	if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("A webhook timestamp is whole seconds");
};

/**
 * The Standard Webhooks signature header: "v1,<base64 HMAC-SHA256 of id.timestamp.body>" for each secret, space
 * separated (two entries while a previous secret is valid). The body is signed as the exact string that is sent.
 *
 * @param   {Object}    args
 * @param   {String}    args.id         the message id (no ".")
 * @param   {Number}    args.timestamp  Unix seconds
 * @param   {String}    args.body
 * @param   {String[]}  args.secrets
 * @returns {String}
 */
const signatureHeader = ({ id, timestamp, body, secrets }) => {
	assertInputs(id, timestamp);
	return secrets
		.map(
			(secret) =>
				`v1,${createHmac("sha256", keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest("base64")}`,
		)
		.join(" ");
};

/**
 * The five request headers of a webhook delivery (lower case names)
 *
 * @param   {Object}    args
 * @param   {String}    args.id
 * @param   {Number}    args.timestamp
 * @param   {String}    args.body
 * @param   {String[]}  args.secrets
 * @param   {String}    args.version  the app version, for the user agent
 * @returns {Object}
 */
const webhookHeaders = ({ id, timestamp, body, secrets, version }) => ({
	"content-type": "application/json",
	"user-agent": `NPMpro-Webhooks/${version}`,
	"webhook-id": id,
	"webhook-timestamp": String(timestamp),
	"webhook-signature": signatureHeader({ id, timestamp, body, secrets }),
});

export { newSecret, signatureHeader, webhookHeaders };
