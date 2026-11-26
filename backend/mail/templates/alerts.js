const ELLIPSIS = "…";
const ERROR_MAX = 300;
const RESOLVED = ".resolved";
const SPACES = /\s+/gu;
const FALLBACK_LANGUAGE = "en";
const NAMES_SHOWN = 3;

const formatters = new Map();

// a time as the language writes it, always in UTC with the zone named (as the notice of a password reset does)
const dateText = (iso, language) => {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return String(iso);
	let format = formatters.get(language);
	if (!format) {
		const options = {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			timeZone: "UTC",
			timeZoneName: "short",
		};
		try {
			format = new Intl.DateTimeFormat(language, options);
		} catch {
			format = new Intl.DateTimeFormat(FALLBACK_LANGUAGE, options);
		}
		formatters.set(language, format);
	}
	return format.format(date);
};

// the short error: one line, cut to 300 characters with an ellipsis (the event data is already cleaned)
const errorText = (value) => {
	if (typeof value !== "string") return "";
	const text = value.replace(SPACES, " ").trim();
	// cut by code points, so an emoji at the edge is never split into a lone surrogate
	const points = Array.from(text);
	return points.length > ERROR_MAX ? `${points.slice(0, ERROR_MAX - 1).join("")}${ELLIPSIS}` : text;
};

const textOf = (value) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

const domains = (list) => {
	if (!Array.isArray(list) || list.length === 0) return "";
	const shown = list.slice(0, NAMES_SHOWN).join(", ");
	return list.length > NAMES_SHOWN ? `${shown}${ELLIPSIS}` : shown;
};

const certificateName = (data) =>
	textOf(data.nice_name) || domains(data.domain_names) || (data.id === undefined ? "" : `#${data.id}`);

const hostName = (data) => {
	if (data.type === "stream" && data.incoming_port !== undefined) return `:${data.incoming_port}`;
	return domains(data.domain_names) || (data.id === undefined ? "" : `#${data.id}`);
};

const nameOf = (item) => textOf(item?.name);

const certificateExpiring = (data, t) => {
	const name = certificateName(data);
	const known = data.days_left !== null && data.days_left !== "" && Number.isFinite(Number(data.days_left));
	const days = Number(data.days_left);
	if (data.state === "expired" || (known && days < 0)) return t("alerts.certificate.expiring.expired", { name });
	if (!known) return t("alerts.certificate.expiring.unknown", { name });
	if (days === 0) return t("alerts.certificate.expiring.today", { name });
	return t("alerts.certificate.expiring.days", { name, days: t.plural("alerts.days", days) });
};

// a sentence per event (the base id, `.resolved` stripped, and whether it is a recovery); the data is the whitelisted
// data of the catalogue. A key with a name has an `.unnamed` twin for the data without one.
const named = (key, pick) => (data, t) => {
	const name = pick(data);
	return name ? t(key, { name }) : t(`${key}.unnamed`);
};

const SENTENCES = {
	"certificate.expiring": {
		problem: certificateExpiring,
		resolved: (d, t) => t("alerts.certificate.expiring.resolved", { name: certificateName(d) }),
	},
	"certificate.renewal_failed": {
		problem: (d, t) => t("alerts.certificate.renewal_failed", { name: certificateName(d) }),
		resolved: (d, t) => t("alerts.certificate.renewal_failed.resolved", { name: certificateName(d) }),
	},
	"host.config_error": {
		problem: (d, t) => t("alerts.host.config_error", { name: hostName(d) }),
		resolved: (d, t) => t("alerts.host.config_error.resolved", { name: hostName(d) }),
	},
	"backup.failed": {
		problem: named("alerts.backup.failed", (d) => nameOf(d.schedule)),
		resolved: named("alerts.backup.failed.resolved", (d) => nameOf(d.schedule)),
	},
	"geoip.failed": {
		problem: (_data, t) => t("alerts.geoip.failed"),
		resolved: (_data, t) => t("alerts.geoip.failed.resolved"),
	},
	"crowdsec.unreachable": {
		problem: (_data, t) => t("alerts.crowdsec.unreachable"),
		resolved: (_data, t) => t("alerts.crowdsec.unreachable.resolved"),
	},
	"ddns.record_failed": {
		problem: named("alerts.ddns.record_failed", (d) => nameOf(d.record)),
		resolved: named("alerts.ddns.record_failed.resolved", (d) => nameOf(d.record)),
	},
	"ddns.record_stopped": {
		problem: named("alerts.ddns.record_stopped", (d) => nameOf(d.record)),
		resolved: named("alerts.ddns.record_stopped.resolved", (d) => nameOf(d.record)),
	},
	"webhook.disabled": {
		problem: (d, t) => {
			const reason = ["gone", "failing"].includes(d.reason) ? `.${d.reason}` : "";
			const name = nameOf(d.webhook) || (d.webhook?.id === undefined ? "" : `#${d.webhook.id}`);
			return t(`alerts.webhook.disabled${reason}`, { name });
		},
	},
};

const itemOf = (event, t) => {
	const resolved = event.type.endsWith(RESOLVED);
	const base = resolved ? event.type.slice(0, -RESOLVED.length) : event.type;
	const data = event.data ?? {};
	const sentence = SENTENCES[base]?.[resolved ? "resolved" : "problem"];
	return {
		resolved,
		sentence: sentence ? sentence(data, t) : t("alerts.unknown", { type: event.type }),
		error: resolved ? "" : errorText(data.error),
		reminder: data.reminder === true,
		since: data.since,
		timestamp: event.timestamp,
	};
};

const noteOf = (item, t) => {
	if (item.resolved)
		return item.timestamp ? t("alerts.resolved", { date: dateText(item.timestamp, t.language) }) : undefined;
	if (!item.reminder) return;
	return item.since ? t("alerts.reminder", { date: dateText(item.since, t.language) }) : t("alerts.reminder.undated");
};

const subjectOf = (items, t) => {
	if (items.length === 1) return items[0].sentence;
	const problems = items.filter((item) => !item.resolved).length;
	const resolved = items.length - problems;
	const parts = [];
	if (problems > 0) parts.push(t.plural("alerts.subject.problems", problems));
	if (resolved > 0) parts.push(t.plural("alerts.subject.resolved", resolved));
	return parts.length === 2 ? t("alerts.subject.both", { problems: parts[0], resolved: parts[1] }) : parts[0];
};

/**
 * The grouped alert mail: one line per event, problems first and then the recoveries (each oldest first), a reminder
 * marked with when the problem began, a button to NPMpro when the public URL is set, and the reason the address gets it
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key (`t.plural`, `t.language`)
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {Object[]}  input.data.events   the event envelopes of the group, oldest first
 *                                          ({ id, type, timestamp, data })
 * @param   {string}    [input.data.url]    the public URL, for the button
 * @param   {string}    [input.data.reason] `admin` or `listed`, for the footer
 * @param   {boolean}   [input.data.sample] a sample mail (Settings, Notifications): "Sample" leads the subject and a
 *                                          line says nothing is wrong
 * @returns {Object}
 */
const alerts = ({ t, data, instance }) => {
	const items = data.events.map((event) => itemOf(event, t));
	const ordered = [...items.filter((item) => !item.resolved), ...items.filter((item) => item.resolved)];
	const sample = data.sample === true;
	const model = {
		subject: sample ? t("alerts.sample.subject", { subject: subjectOf(ordered, t) }) : subjectOf(ordered, t),
		lines: sample ? [t("alerts.intro", { instance }), t("alerts.sample.note")] : [t("alerts.intro", { instance })],
		list: ordered.map((item) => ({
			text: item.error ? `${item.sentence}: ${item.error}` : item.sentence,
			note: noteOf(item, t),
		})),
		footer: [data.reason ? t(`alerts.footer.${data.reason}`, { instance }) : t("footer.sent", { instance })],
	};
	if (data.url) model.button = { label: t("alerts.button"), url: data.url };
	return model;
};

// queued by the alert channel (one row per event), never through queueMail
export default Object.assign(alerts, { direct: true });
