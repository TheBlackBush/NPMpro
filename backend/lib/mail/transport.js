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
 * never Nodemailer's own permanent flag; a socket error retries only for a network cause, a certificate or TLS
 * failure (also an ESOCKET) fails.
 *
 * @param   {Error}  err
 * @returns {"retry"|"fail"}
 */
const classifySmtpError = (err) => {
	const reply = Number(err?.responseCode);
	if (reply >= TEMPORARY_FIRST && reply < PERMANENT_FIRST) return "retry";
	if (reply >= PERMANENT_FIRST && reply <= PERMANENT_LAST) return "fail";
	if (err?.code === "ESOCKET") return NETWORK_CODES.has(err.originalCode) ? "retry" : "fail";
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
	const text = safeError(clean(`${err?.message ?? "mail error"}${reply}`, [values.password, values.username]));
	return new MailError(text, { retry, code: err?.code, message_i18n: err?.message_i18n });
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
		throw failure(values, err, false);
	}
	const transporter = createMailTransport(values, { address: target.address, ehloName });
	try {
		await transporter.sendMail({
			...message,
			from: values.from_name ? { name: values.from_name, address: values.from_address } : values.from_address,
			...(values.reply_to ? { replyTo: values.reply_to } : {}),
		});
		return { ok: true };
	} catch (err) {
		throw failure(values, err, classifySmtpError(err) === "retry");
	} finally {
		transporter.close();
	}
};

export { classifySmtpError, createMailTransport, MailError, sendMail };
