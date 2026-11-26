import { hostname } from "node:os";
import errs from "../lib/error.js";
import {
	ehloNameOf,
	isConfigured,
	isSingleAddress,
	MAIL_LANGUAGES,
	mergeEmail,
	mergeNotifications,
	publicHostOf,
} from "../lib/mail/settings-rules.js";
import { sendMail } from "../lib/mail/transport.js";
import { messageId } from "../lib/notify/catalogue.js";
import { global as logger } from "../logger.js";
import { renderMail, TEMPLATES } from "../mail/render.js";
import { queue, worker } from "./notify.js";

// Mail of the app: queueMail for account notices (through the delivery queue and its retries), sendNow for the mails
// that carry a link or answer a request (the test mail, a reset link, an invitation): those never touch the queue, so
// no link is ever stored in a delivery row.

// the stored values come from the settings service (Task 2a.6); until it is plugged in, only the env counts
let source = async () => ({
	email: mergeEmail({}, process.env).values,
	notifications: mergeNotifications({}, process.env).values,
});

const settings = () => source();

const mailNotConfigured = () => new errs.ValidationError("Mail is not configured", "error.mail-not-configured");

const badRecipient = () => new errs.ValidationError("The recipient address is not valid", "error.mail-bad-recipient");

const isText = (value) => typeof value === "string";

// a mail that is not queued: the reason for the caller and a warn line without the address
const notQueued = (reason, why) => {
	logger.warn(`mail: a mail was not queued: ${why}`);
	return { queued: false, reason };
};

const internalMail = {
	/** Plugs the settings service in: an async function that answers { email, notifications } (merged, password in clear) */
	useSettings: (fn) => {
		source = fn;
	},

	settings,

	/** @returns {Promise<boolean>} whether the server and the sender are set */
	configured: async () => isConfigured((await settings()).email),

	/** The language of a user: their own, else the default language of the notifications */
	languageOf: async (user) => user?.npmpro_language || (await settings()).notifications.default_language,

	/**
	 * Queues an account mail (through the delivery queue and its retries).
	 *
	 * The contract the callers rely on: a mail is a side effect and never fails its cause, so a data problem never
	 * throws. A recipient the address check refuses (a user email with a list, a display name, CR or LF, non-ASCII), a
	 * template that does not exist, mail not configured and a queue write that fails all resolve
	 * { queued: false, reason } and write a warn line without the address. It throws only for a caller bug: a template
	 * that carries a link (direct, sent by sendNow), or a template name or recipient that is not a string.
	 *
	 * @param   {Object}           mail
	 * @param   {String|String[]}  mail.to        one address or a list
	 * @param   {String}           mail.template
	 * @param   {String}           [mail.language]  a mail language, else the default mail language
	 * @param   {Object}           [mail.data]
	 * @returns {Promise<{queued: boolean, reason?: "recipient"|"template"|"not-configured"|"queue"}>}
	 */
	queueMail: async ({ to, template, language, data = {} }) => {
		const recipients = Array.isArray(to) ? to : [to];
		if (!isText(template)) throw new errs.InternalValidationError("A mail template name must be a string");
		if (!recipients.every(isText)) throw new errs.InternalValidationError("A mail recipient must be a string");
		const known = Object.hasOwn(TEMPLATES, template) ? TEMPLATES[template] : null;
		if (known?.direct) throw new errs.InternalValidationError(`The mail template ${template} is never queued`);
		if (!known) return notQueued("template", "the template does not exist");
		if (recipients.length === 0 || !recipients.every((one) => isSingleAddress(one))) {
			return notQueued("recipient", "the recipient address is not valid");
		}
		const stored = await settings();
		if (!isConfigured(stored.email)) return { queued: false, reason: "not-configured" };
		const chosen = MAIL_LANGUAGES.includes(language) ? language : stored.notifications.default_language;
		try {
			await queue.add([
				{
					message_id: messageId(),
					event: `mail.${template}`.slice(0, 64),
					channel: "mail",
					payload: { to, template, language: chosen, data },
				},
			]);
		} catch (err) {
			return notQueued("queue", `the queue could not be written (${err?.code ?? err?.name ?? "error"})`);
		}
		worker.kick();
		return { queued: true };
	},

	/**
	 * Renders and sends one mail at once, outside the queue (the test mail, a reset link, an invitation).
	 *
	 * The recipient is checked like a saved address (one plain address); a bad one throws a ValidationError
	 * (error.mail-bad-recipient) before anything is sent. A language that is not a mail language falls back to the
	 * default mail language.
	 *
	 * @param   {Object}  mail
	 * @param   {String}  mail.to         one address
	 * @param   {String}  mail.template
	 * @param   {String}  [mail.language]
	 * @param   {Object}  [mail.data]
	 * @returns {Promise<{ok: true}>}  throws error.mail-bad-recipient, error.mail-not-configured, or a MailError with
	 *          a scrubbed message
	 */
	sendNow: async ({ to, template, language, data = {} }) => {
		if (!isSingleAddress(to)) throw badRecipient();
		const { email, notifications } = await settings();
		if (!isConfigured(email)) throw mailNotConfigured();
		const chosen = MAIL_LANGUAGES.includes(language) ? language : notifications.default_language;
		const instance = publicHostOf(notifications) ?? hostname();
		const mail = renderMail(template, { language: chosen, data, instance });
		return sendMail(email, { to, ...mail }, { ehloName: ehloNameOf(notifications) });
	},
};

export default internalMail;
