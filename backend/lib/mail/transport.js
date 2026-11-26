import { isIP } from "node:net";
import nodemailer from "nodemailer";
import { clean } from "../notify/catalogue.js";
import { safeError } from "../notify/queue.js";
import { validateEmailValues } from "./settings-rules.js";
import { checkSmtpTarget } from "./smtp-target.js";

const NETWORK_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"EPIPE",
	"ETIMEDOUT",
	"EAI_AGAIN",
]);
const RETRY_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "EDNS"]);
const TEMPORARY_FIRST = 400;
const PERMANENT_FIRST = 500;
const PERMANENT_LAST = 599;
const TIMEOUT_MS = { connection: 10_000, greeting: 10_000, socket: 30_000 };

/** A failed send: retry says whether the queue may try again; the message is scrubbed and may be shown */
class MailError extends Error {
	name = "MailError";
	public = true;
	status = 400;
	constructor(message, { retry = false, code, message_i18n, message_values } = {}) {
		super(message);
		this.retry = retry;
		if (code) this.code = code;
		if (message_i18n) this.message_i18n = message_i18n;
		if (message_values) this.message_values = message_values;
	}
}

/**
 * "retry" or "fail" for an error of Nodemailer or of the guard. The reply class decides first (4xx retry, 5xx fail),
 * never Nodemailer's own permanent flag; a socket error retries for a network cause or none, a certificate or TLS
 * failure (also an ESOCKET) fails.
 *
 * @param   {Error}  err
 * @returns {"retry"|"fail"}
 */
const classifySmtpError = (err) => {
	const reply = Number(err?.responseCode);
	if (reply >= TEMPORARY_FIRST && reply < PERMANENT_FIRST) return "retry";
	if (reply >= PERMANENT_FIRST && reply <= PERMANENT_LAST) return "fail";
	// a socket error without a cause retries (the retries are bounded); a certificate or TLS cause fails
	if (err?.code === "ESOCKET") return !err.originalCode || NETWORK_CODES.has(err.originalCode) ? "retry" : "fail";
	return RETRY_CODES.has(err?.code) ? "retry" : "fail";
};

/**
 * @param   {Object}  values   the values of mergeEmail
 * @param   {Object}  target   the checked address
 * @param   {String}  target.address
 * @param   {String}  [target.ehloName]
 * @returns {Object}  a Nodemailer transporter (no pool, no logging)
 */
const BRACKETS = /^\[|\]$/gu;

const createMailTransport = (values, { address, ehloName }) =>
	nodemailer.createTransport({
		host: address,
		port: values.port,
		secure: values.security === "tls",
		requireTLS: values.security === "starttls",
		ignoreTLS: values.security === "none",
		// SNI carries a name only (RFC 6066): with an IP as Host the certificate is checked against that IP
		tls: {
			...(isIP(String(values.host ?? "").replace(BRACKETS, "")) === 0 ? { servername: values.host } : {}),
			rejectUnauthorized: values.verify_tls,
		},
		...(values.username ? { auth: { user: values.username, pass: values.password } } : {}),
		// without a name Nodemailer says EHLO with its own default
		...(ehloName ? { name: ehloName } : {}),
		connectionTimeout: TIMEOUT_MS.connection,
		greetingTimeout: TIMEOUT_MS.greeting,
		socketTimeout: TIMEOUT_MS.socket,
		logger: false,
		debug: false,
	});

// the certificate checks of Node and OpenSSL that fail a server with Verify on (self-signed, expired, another name)
const CERTIFICATE_CODES = new Set([
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_GET_ISSUER_CERT",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"CERT_UNTRUSTED",
	"CERT_REJECTED",
	"ERR_TLS_CERT_ALTNAME_INVALID",
]);
// TLS spoken to a plain port (or the other way round): the record layer cannot read the answer
const TLS_MISMATCH_CODES = new Set([
	"ERR_SSL_WRONG_VERSION_NUMBER",
	"ERR_SSL_PACKET_LENGTH_TOO_LONG",
	"ERR_SSL_RECORD_LAYER_FAILURE",
	"ERR_SSL_UNSUPPORTED_PROTOCOL",
	"ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
	"EPROTO",
]);
// STARTTLS or None on an implicit TLS port: the server waits for TLS and never greets
const GREETING_TIMEOUT = "Greeting never received";
const LOGIN_REFUSED = 535;

/**
 * The text a person can act on for a failure: a translated key with its values and the same text in English (the
 * message, also the audit row of a queued mail); never Node's or OpenSSL's own text. A failure without a known cause
 * keeps the scrubbed server reply as its text and has no key (the caller words it).
 *
 * @param   {Object}  values  the values of mergeEmail
 * @param   {Error}   err
 * @param   {string}  detail  the scrubbed text of the error
 * @returns {{text: string, message_i18n?: string, message_values?: Object}}
 */
const explainFailure = (values, err, detail) => {
	const original = err?.originalCode ?? err?.code;
	if (CERTIFICATE_CODES.has(original)) {
		return {
			text: "The certificate of the mail server is not trusted (self-signed, expired or issued for another name). Turn Verify certificate off only for a server you trust on your local network.",
			message_i18n: "error.mail-certificate",
		};
	}
	if (TLS_MISMATCH_CODES.has(original) || (err?.code === "ETIMEDOUT" && err.message === GREETING_TIMEOUT)) {
		return {
			text: `The server on port ${values.port} did not answer as Security expects. Port 465 usually needs TLS, port 587 STARTTLS.`,
			message_i18n: "error.mail-security-mismatch",
			message_values: { port: values.port },
		};
	}
	if (err?.code === "ESOCKET" && err.originalCode === "ECONNREFUSED") {
		return {
			text: `${values.host} refused the connection on port ${values.port}.`,
			message_i18n: "error.mail-connection-refused",
			message_values: { host: values.host, port: values.port },
		};
	}
	if (err?.code === "EAUTH" || Number(err?.responseCode) === LOGIN_REFUSED) {
		return {
			text: `The mail server refused the login: ${detail}`,
			message_i18n: "error.mail-login-failed",
			message_values: { error: detail },
		};
	}
	return { text: detail };
};

const failure = (values, err, retry) => {
	// the server's reply is inside message and response (a 535 may echo the login), so both are scrubbed
	const reply = err?.response && !String(err.message).includes(err.response) ? ` ${err.response}` : "";
	const detail = safeError(clean(`${err?.message ?? "mail error"}${reply}`, secretsOf(values)));
	// a refusal of the guard already carries its own key
	const { text, message_i18n, message_values } = err?.message_i18n
		? { text: detail, message_i18n: err.message_i18n, message_values: err.message_values }
		: explainFailure(values, err, detail);
	return new MailError(text, { retry, code: err?.code, message_i18n, message_values });
};

const toBase64 = (text) => Buffer.from(text).toString("base64");

// the login in the forms a server could echo: as typed, base64 of the password, base64 of the AUTH PLAIN payload
const secretsOf = ({ username, password }) => [
	password,
	username,
	...(password ? [toBase64(password), toBase64(`\0${username}\0${password}`)] : []),
];

// the connection never reached the server: the next checked address may be tried (never after a reply or a TLS error)
// a socket timeout can come after DATA (the server may have taken the mail): only the connect timeout moves on
const CONNECT_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]);
const CONNECT_TIMEOUT = "Connection timeout";
const isConnectError = (err) =>
	(err?.code === "ESOCKET" && CONNECT_CODES.has(err.originalCode)) ||
	(err?.code === "ETIMEDOUT" && err.message === CONNECT_TIMEOUT);

const deliver = async (values, message, address, ehloName) => {
	const transporter = createMailTransport(values, { address, ehloName });
	try {
		await transporter.sendMail({
			...message,
			from: values.from_name ? { name: values.from_name, address: values.from_address } : values.from_address,
			...(values.reply_to ? { replyTo: values.reply_to } : {}),
		});
	} finally {
		transporter.close();
	}
};

/**
 * Sends one mail: the settings are checked, the target resolved and checked (every time, so a name that changed its
 * address is refused), then Nodemailer sends to that address.
 *
 * @param   {Object}  values   the values of mergeEmail
 * @param   {Object}  message  to, subject, text, html (from and reply-to come from the settings)
 * @param   {Object}  options
 * @param   {String}  [options.ehloName]  the EHLO name (ehloNameOf); none: Nodemailer's default
 * @returns {Promise<{ok: true}>}  throws a MailError with retry, its text in English and, for a known cause, a
 *          translated key with its values (message_i18n, message_values)
 */
const sendMail = async (values, message, { ehloName }) => {
	const { errors } = validateEmailValues(values);
	if (Object.keys(errors).length > 0) {
		throw new MailError(`The mail settings are not valid: ${Object.keys(errors).join(", ")}`, {
			code: "ECONFIG",
			message_i18n: "error.mail-config-invalid",
		});
	}
	let target;
	try {
		target = await checkSmtpTarget(values);
	} catch (err) {
		throw failure(values, err, err?.temporary === true);
	}
	let last;
	for (const { address } of target.addresses) {
		try {
			await deliver(values, message, address, ehloName);
			return { ok: true };
		} catch (err) {
			last = err;
			if (!isConnectError(err)) break;
		}
	}
	throw failure(values, last, classifySmtpError(last) === "retry");
};

export { classifySmtpError, createMailTransport, explainFailure, MailError, sendMail };
