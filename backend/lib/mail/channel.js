import { hostname } from "node:os";
import { eventById } from "../notify/catalogue.js";
import { safeError } from "../notify/queue.js";
import { alertRecipients } from "./recipients.js";
import { ehloNameOf, isConfigured, normalizePublicUrl, publicHostOf, validateEmailValues } from "./settings-rules.js";
import { MailError } from "./transport.js";

// The mail channel of the notification worker. A row holds { to, template, language, data } as its payload; one row is
// one mail. Nothing secret leaves here: the transport already scrubs its messages, the recipients are masked out of
// the error text, and the audit row of a final failure holds the kind, the number of recipients and that text only.

const RETRY_DELAYS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
const MASK = "***";
const MIN_PART = 3;
// rows that wait this long for the rest of their group before the first try (the grouping window of the alert mail)
const GROUP_DELAY_MS = 60_000;
const ALERT_TEMPLATE = "alerts";
const RESOLVED = ".resolved";
const NO_LONGER = "The address is no longer an alert recipient, the mail was not sent";
const NOT_SET_UP = "Mail is no longer set up, the mail was not sent";
const UNTICKED = "The event is no longer ticked for mail alerts, the mail was not sent";

// ticking `x` covers `x.resolved` (the contract of alerts_events in settings-rules.js)
const baseOf = (type) => (type.endsWith(RESOLVED) ? type.slice(0, -RESOLVED.length) : type);

// the base must be an event mail offers (a state event or webhook.disabled), whatever the stored list holds
const isTicked = (type, notifications) => {
	const base = baseOf(String(type ?? ""));
	const offered = eventById(base)?.mail === base && eventById(base).channels.includes("mail");
	return offered && (notifications?.alerts_events ?? []).includes(base);
};

const recipientsOf = (to) => (Array.isArray(to) ? to : [to]).filter((one) => typeof one === "string" && one !== "");

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// every recipient, whatever its case, goes out of the text; an address the cut left in part loses that part at the end
const maskRecipients = (text, to) => {
	let masked = text;
	for (const address of recipientsOf(to)) masked = masked.replace(new RegExp(escapeRegExp(address), "giu"), MASK);
	return masked;
};

const cutPartial = (text, to) => {
	let result = text;
	for (const address of recipientsOf(to)) {
		const lower = address.toLowerCase();
		for (let size = Math.min(address.length - 1, result.length); size >= MIN_PART; size--) {
			if (result.toLowerCase().endsWith(lower.slice(0, size))) {
				result = result.slice(0, result.length - size);
				break;
			}
		}
	}
	return result;
};

// masked before the text is cut, so the cut never leaves the first part of an address
const safeText = (raw, to) => cutPartial(safeError(maskRecipients(String(raw ?? ""), to)), to);

/**
 * @param   {Object}    options
 * @param   {Function}  options.settings  async () => { email, notifications } (the merged values, password in clear)
 * @param   {Function}  [options.admins]  async () => users { email, roles, is_disabled, npmpro_language } (alert mail)
 * @param   {Function}  options.send      sendMail(values, message, { ehloName })  (ehloName may be undefined)
 * @param   {Function}  options.render    renderMail(template, { language, data, instance })
 * @param   {Function}  options.audit     async (entry) => the audit row is written (never throws into the worker)
 * @param   {Object}    [options.log]
 * @param   {Object}    [options.clock]   { now() } in ms
 */
const createMailChannel = ({ settings, admins, send, render, audit, log, clock = { now: () => Date.now() } }) => {
	const sendRow = async (row, values) => {
		const input = row.payload;
		if (!input || typeof input !== "object") throw new MailError("The mail has no content", { code: "ECONFIG" });
		const { errors } = validateEmailValues(values.email);
		if (Object.keys(errors).length > 0) {
			throw new MailError("The mail settings are not valid", { code: "ECONFIG" });
		}
		const instance = publicHostOf(values.notifications) ?? hostname();
		const mail = render(input.template, { language: input.language, data: input.data, instance });
		await send(values.email, { to: input.to, ...mail }, { ehloName: ehloNameOf(values.notifications) });
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

	// the result of a failed try; a final one (no retry, or the last retry used) is audited
	const failed = async (row, raw, retry) => {
		const text = safeText(raw, row.payload?.to);
		if (!retry || Number(row.attempts) >= RETRY_DELAYS.length) await recordFailure(row, text);
		return { id: row.id, ok: false, retry, error: text };
	};

	const sendOne = async (row, values) => {
		const started = clock.now();
		try {
			await sendRow(row, values);
			return { id: row.id, ok: true, duration_ms: clock.now() - started };
		} catch (error) {
			const retry = error instanceof MailError && error.retry === true;
			return {
				...(await failed(row, error?.message ?? String(error), retry)),
				duration_ms: clock.now() - started,
			};
		}
	};

	// rows that were not tried because a setting changed since they were queued: no mail and no audit row
	const dropped = (rows, reason, started) => {
		const duration_ms = clock.now() - started;
		return rows.map((row) => ({ id: row.id, ok: false, retry: false, dropped: true, error: reason, duration_ms }));
	};

	// an alert group: every row of one group_key is one mail to its address, the events oldest first. The rows share
	// one fate (all sent, all retried, all failed), and a final failure is audited once. Rows whose event is no longer
	// ticked, and every row while mail is not set up or the address is no longer a recipient, are dropped unsent.
	const sendClaimed = async (claimed, values) => {
		const started = clock.now();
		if (!isConfigured(values.email)) return dropped(claimed, NOT_SET_UP, started);
		const rows = claimed.filter((row) => isTicked(row.event ?? row.payload?.envelope?.type, values.notifications));
		const unticked = claimed.filter((row) => !rows.includes(row));
		const skipped = unticked.length > 0 ? dropped(unticked, UNTICKED, started) : [];
		if (rows.length === 0) return skipped;
		const first = rows[0];
		const last = rows.at(-1);
		const to = first.recipient;
		try {
			const { errors } = validateEmailValues(values.email);
			if (Object.keys(errors).length > 0) {
				throw new MailError("The mail settings are not valid", { code: "ECONFIG" });
			}
			if (typeof to !== "string" || to === "")
				throw new MailError("The mail has no recipient", { code: "ECONFIG" });
			let users = [];
			if (admins && values.notifications?.alerts_admins === true) {
				try {
					users = await admins();
				} catch {
					throw new MailError("The administrators could not be read", { retry: true });
				}
			}
			// an admin disabled or an address removed since the row was queued gets nothing
			const current = alertRecipients({ admins: users, settings: values.notifications });
			const recipient = current.find((one) => one.address.toLowerCase() === to.toLowerCase());
			if (!recipient) return [...skipped, ...dropped(rows, NO_LONGER, started)];
			const instance = publicHostOf(values.notifications) ?? hostname();
			const events = rows.map((row) => row.payload.envelope);
			// the footer says why the address gets the mail (as the settings are now); the button needs a public URL
			const url = normalizePublicUrl(values.notifications?.public_url) ?? undefined;
			const data = { events, reason: recipient.reason, url };
			const mail = render(ALERT_TEMPLATE, { language: last.payload.language, data, instance });
			await send(values.email, { to, ...mail }, { ehloName: ehloNameOf(values.notifications) });
			const duration_ms = clock.now() - started;
			return [...skipped, ...rows.map((row) => ({ id: row.id, ok: true, duration_ms }))];
		} catch (error) {
			const retry = error instanceof MailError && error.retry === true;
			const text = safeText(error?.message ?? String(error), to);
			// one fate for the group: its highest attempt count decides for every row. A group succeeds or fails as one
			// mail, so a late row that joined a group in its last attempt shares that attempt (the Task 3.2 ruling).
			const final = !retry || rows.some((row) => Number(row.attempts) >= RETRY_DELAYS.length);
			if (final) await recordFailure({ ...first, event: ALERT_TEMPLATE, payload: { to } }, text);
			const duration_ms = clock.now() - started;
			return [
				...skipped,
				...rows.map((row) => ({ id: row.id, ok: false, retry: !final, error: text, duration_ms })),
			];
		}
	};

	// one log line per group at most, for the rows it dropped (counts and reasons, never an address)
	const sendGroup = async (claimed, values) => {
		const results = await sendClaimed(claimed, values);
		const gone = results.filter((result) => result.dropped);
		if (gone.length > 0) {
			const reasons = [...new Set(gone.map((result) => result.error))].join("; ");
			log?.info?.(`mail: ${gone.length} queued alert(s) dropped: ${reasons}`);
		}
		return results;
	};

	let loaded = null;

	const isAlertRow = (row) => Boolean(row.payload?.envelope);

	const alertGroups = (rows) => {
		const groups = new Map();
		for (const row of rows) {
			const key = row.group_key ?? `row:${row.id}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(row);
		}
		return [...groups.values()];
	};

	return {
		id: "mail",
		retryDelays: RETRY_DELAYS,
		// an alert: mail is set up and the event (or, for a recovery, its base event) is ticked; account mails are queued
		// by internalMail.queueMail and not by an event
		// (the settings read here are reused by the targets call of the same event)
		accepts: async (type) => {
			loaded = await settings();
			return isConfigured(loaded.email) && isTicked(type, loaded.notifications);
		},
		// one row per recipient, resolved now: they all wait for their group's window
		targets: async (envelope) => {
			const { notifications } = loaded ?? (await settings());
			loaded = null;
			const users = admins && notifications?.alerts_admins === true ? await admins() : [];
			return alertRecipients({ admins: users, settings: notifications }).map(({ address, language }) => ({
				recipient: address,
				group_key: `alerts:${address.toLowerCase()}`,
				delay_ms: GROUP_DELAY_MS,
				payload: { language, envelope },
			}));
		},
		send: async (rows) => {
			let values;
			try {
				values = await settings();
			} catch (error) {
				log?.warn?.(`mail: the settings could not be read: ${safeError(error?.message ?? String(error))}`);
				return Promise.all(rows.map((row) => failed(row, "The mail settings could not be read", true)));
			}
			const results = [];
			for (const row of rows.filter((one) => !isAlertRow(one))) results.push(await sendOne(row, values));
			for (const group of alertGroups(rows.filter(isAlertRow))) results.push(...(await sendGroup(group, values)));
			return results;
		},
	};
};

export { createMailChannel, GROUP_DELAY_MS, RETRY_DELAYS };
