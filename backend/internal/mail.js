import { hostname } from "node:os";
import errs from "../lib/error.js";
import {
	isConfigured,
	isSingleAddress,
	MAIL_LANGUAGES,
	mergeEmail,
	mergeNotifications,
	publicHostOf,
} from "../lib/mail/settings-rules.js";
import { sendMail } from "../lib/mail/transport.js";
import { messageId } from "../lib/notify/catalogue.js";
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
	 * Queues an account mail. Writes nothing while mail is not configured. A template that carries a link is refused.
	 *
	 * @param   {Object}  mail
	 * @param   {String}  mail.to
	 * @param   {String}  mail.template
	 * @param   {String}  mail.language
	 * @param   {Object}  [mail.data]
	 * @returns {Promise<{queued: boolean}>}
	 */
	queueMail: async ({ to, template, language, data = {} }) => {
		const known = TEMPLATES[template];
		if (!known) throw new errs.InternalValidationError(`Unknown mail template ${template}`);
		if (known.direct) throw new errs.InternalValidationError(`The mail template ${template} is never queued`);
		const recipients = Array.isArray(to) ? to : [to];
		if (recipients.length === 0 || !recipients.every((one) => isSingleAddress(one))) {
			throw new errs.InternalValidationError("A mail needs valid recipient addresses");
		}
		const stored = await settings();
		if (!isConfigured(stored.email)) return { queued: false };
		const chosen = MAIL_LANGUAGES.includes(language) ? language : stored.notifications.default_language;
		await queue.add([
			{
				message_id: messageId(),
				event: `mail.${template}`.slice(0, 64),
				channel: "mail",
				payload: { to, template, language: chosen, data },
			},
		]);
		worker.kick();
		return { queued: true };
	},

	/**
	 * Renders and sends one mail at once, outside the queue
	 *
	 * @param   {Object}  mail
	 * @returns {Promise<{ok: true}>}  throws error.mail-not-configured, or a MailError with a scrubbed message
	 */
	sendNow: async ({ to, template, language, data = {} }) => {
		const { email, notifications } = await settings();
		if (!isConfigured(email)) throw mailNotConfigured();
		const instance = publicHostOf(notifications) ?? hostname();
		const mail = renderMail(template, { language, data, instance });
		return sendMail(email, { to, ...mail }, { ehloName: instance });
	},
};

export default internalMail;
