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
	constructor(message, { retry = false, code, message_i18n } = {}) {
		super(message);
		this.retry = retry;
		if (code) this.code = code;
		if (message_i18n) this.message_i18n = message_i18n;
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
 * @param   {String}  target.ehloName
 * @returns {Object}  a Nodemailer transporter (no pool, no logging)
 */
const createMailTransport = (values, { address, ehloName }) =>
	nodemailer.createTransport({
		host: address,
		port: values.port,
		secure: values.security === "tls",
		requireTLS: values.security === "starttls",
		ignoreTLS: values.security === "none",
		tls: { servername: values.host, rejectUnauthorized: values.verify_tls },
		...(values.username ? { auth: { user: values.username, pass: values.password } } : {}),
		name: ehloName,
		connectionTimeout: TIMEOUT_MS.connection,
		greetingTimeout: TIMEOUT_MS.greeting,
		socketTimeout: TIMEOUT_MS.socket,
		logger: false,
		debug: false,
	});

const failure = (values, err, retry) => {
	// the server's reply is inside message and response (a 535 may echo the login), so both are scrubbed
	const reply = err?.response && !String(err.message).includes(err.response) ? ` ${err.response}` : "";
	const text = safeError(clean(`${err?.message ?? "mail error"}${reply}`, secretsOf(values)));
	return new MailError(text, { retry, code: err?.code, message_i18n: err?.message_i18n });
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
 * @param   {String}  options.ehloName
 * @returns {Promise<{ok: true}>}  throws a MailError with retry
 */
const sendMail = async (values, message, { ehloName }) => {
	const { errors } = validateEmailValues(values);
	if (Object.keys(errors).length > 0) {
		throw new MailError(`The mail settings are not valid: ${Object.values(errors).join(", ")}`, {
			code: "ECONFIG",
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

export { classifySmtpError, createMailTransport, MailError, sendMail };
