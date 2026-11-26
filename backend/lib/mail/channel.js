import { hostname } from "node:os";
import { safeError } from "../notify/queue.js";
import { publicHostOf, validateEmailValues } from "./settings-rules.js";
import { MailError } from "./transport.js";

// The mail channel of the notification worker. A row holds { to, template, language, data } as its payload; one row is
// one mail. Nothing secret leaves here: the transport already scrubs its messages, the recipients are masked out of
// the error text, and the audit row of a final failure holds the kind, the number of recipients and that text only.

const RETRY_DELAYS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
const MASK = "***";

const recipientsOf = (to) => (Array.isArray(to) ? to : [to]).filter((one) => typeof one === "string" && one !== "");

const maskRecipients = (text, to) => {
	let masked = text;
	for (const address of recipientsOf(to)) masked = masked.split(address).join(MASK);
	return masked;
};

/**
 * @param   {Object}    options
 * @param   {Function}  options.settings  async () => { email, notifications } (the merged values, password in clear)
 * @param   {Function}  options.send      sendMail(values, message, { ehloName })
 * @param   {Function}  options.render    renderMail(template, { language, data, instance })
 * @param   {Function}  options.audit     async (entry) => the audit row is written (never throws into the worker)
 * @param   {Object}    [options.log]
 * @param   {Object}    [options.clock]   { now() } in ms
 */
const createMailChannel = ({ settings, send, render, audit, log, clock = { now: () => Date.now() } }) => {
	const sendRow = async (row, values) => {
		const input = row.payload;
		if (!input || typeof input !== "object") throw new MailError("The mail has no content", { code: "ECONFIG" });
		const { errors } = validateEmailValues(values.email);
		if (Object.keys(errors).length > 0) {
			throw new MailError("The mail settings are not valid", { code: "ECONFIG" });
		}
		const instance = publicHostOf(values.notifications) ?? hostname();
		const mail = render(input.template, { language: input.language, data: input.data, instance });
		await send(values.email, { to: input.to, ...mail }, { ehloName: instance });
	};

	const recordFailure = async (row, error) => {
		try {
			await audit({
				action: "mail-failed",
				object_type: "setting",
				meta: {
					id: "email",
					kind: row.payload?.template ?? row.event,
					recipients: recipientsOf(row.payload?.to).length,
					error,
				},
			});
		} catch (auditError) {
			log?.warn?.(`mail: the failure could not be audited: ${safeError(auditError?.message ?? auditError)}`);
		}
	};

	const sendOne = async (row, values) => {
		const started = clock.now();
		try {
			await sendRow(row, values);
			return { id: row.id, ok: true, duration_ms: clock.now() - started };
		} catch (error) {
			const text = maskRecipients(safeError(error?.message ?? String(error)), row.payload?.to);
			const retry = error instanceof MailError && error.retry === true;
			if (!retry || Number(row.attempts) >= RETRY_DELAYS.length) await recordFailure(row, text);
			return { id: row.id, ok: false, retry, error: text, duration_ms: clock.now() - started };
		}
	};

	return {
		id: "mail",
		retryDelays: RETRY_DELAYS,
		// PR 2a: nothing but account mails, which are queued by internalMail.queueMail and not by an event
		accepts: () => false,
		targets: async () => [],
		send: async (rows) => {
			let values;
			try {
				values = await settings();
			} catch (error) {
				const text = safeError(error?.message ?? String(error));
				log?.warn?.(`mail: the settings could not be read: ${text}`);
				return rows.map((row) => ({ id: row.id, ok: false, retry: true, error: text }));
			}
			const results = [];
			for (const row of rows) results.push(await sendOne(row, values));
			return results;
		},
	};
};

export { createMailChannel, RETRY_DELAYS };
