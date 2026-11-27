import { createHmac, randomBytes } from "node:crypto";

const PREFIX = "whsec_";

/**
 * @returns {String}  a signing secret: "whsec_" and the base64 of 32 random bytes (the spec allows 24 to 64)
 */
const newSecret = () => `${PREFIX}${randomBytes(32).toString("base64")}`;

// the key is the bytes of the base64 part after the prefix, not its text
const keyOf = (secret) =>
	Buffer.from(String(secret).startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret, "base64");

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
const signatureHeader = ({ id, timestamp, body, secrets }) =>
	secrets
		.map(
			(secret) =>
				`v1,${createHmac("sha256", keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest("base64")}`,
		)
		.join(" ");

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
