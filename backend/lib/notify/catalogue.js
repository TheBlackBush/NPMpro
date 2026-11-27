import { randomBytes } from "node:crypto";
import { scrubSecrets } from "../ddns/errors.js";

const MAX_TEXT = 300;
const MAX_ENVELOPE_BYTES = 20 * 1024;
// biome-ignore lint/security/noSecrets: the RFC 4648 base32 alphabet, not a secret
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Error text for an event: the object's secret values replaced by ***, line breaks as spaces, cut to 300 characters
 *
 * @param   {*}         text
 * @param   {String[]}  [secrets]
 * @returns {String}
 */
const clean = (text, secrets = []) => scrubSecrets(text, secrets).slice(0, MAX_TEXT);

const isSet = (value) => value !== undefined && value !== null;

/**
 * Keeps the keys whose value is set, so JSON never holds an undefined and a missing field is left out
 *
 * @param   {Object} fields
 * @returns {Object}
 */
const compact = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => isSet(value)));

const ZONELESS = /^(?<day>\d{4}-\d{2}-\d{2})[ T](?<time>\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/u;

/**
 * A text or number field as event data: a string is scrubbed and cut to 300 characters, a finite number stays, anything
 * else is dropped
 *
 * @param   {*} value
 * @returns {String|Number|undefined}
 */
const scalar = (value) => {
	if (typeof value === "string") return clean(value);
	return Number.isFinite(value) ? value : undefined;
};

// a datetime string without a zone is the server's local time (TZ), as the database stores it (lib/notify/db-time.js),
// so the ISO date is the real instant
const iso = (value) => {
	if (!isSet(value)) return;
	let date = value;
	if (!(value instanceof Date)) {
		const zoneless = typeof value === "string" ? ZONELESS.exec(value) : null;
		date = new Date(zoneless ? `${zoneless.groups.day}T${zoneless.groups.time}` : value);
	}
	return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const names = (list) => (Array.isArray(list) ? list.map((item) => scalar(String(item))) : undefined);

const certificateData = (source) =>
	compact({
		id: scalar(source.id),
		nice_name: scalar(source.nice_name),
		domain_names: names(source.domain_names),
		provider: scalar(source.provider),
		expires_on: iso(source.expires_on),
	});

const certificateExpiringData = (source) =>
	compact({ ...certificateData(source), state: scalar(source.state), days_left: scalar(source.days_left) });

const certificateRenewalFailedData = (source) =>
	compact({
		...certificateData(source),
		error: isSet(source.error) ? clean(source.error, source.secrets) : undefined,
	});

const hostData = (source) =>
	compact({
		type: scalar(source.type),
		id: scalar(source.id),
		domain_names: source.type === "stream" ? undefined : names(source.domain_names),
		incoming_port: source.type === "stream" ? scalar(source.incoming_port) : undefined,
		enabled: isSet(source.enabled) ? Boolean(source.enabled) : undefined,
	});

const userOf = (user) => (user ? compact({ id: scalar(user.id), name: scalar(user.name) }) : undefined);

const hostActionData = (source) => compact({ ...hostData(source), user: userOf(source.user) });

const hostConfigErrorData = (source) =>
	compact({
		...hostData(source),
		error: isSet(source.error) ? clean(source.error, source.secrets) : undefined,
	});

const scheduleOf = (schedule) =>
	schedule ? compact({ id: scalar(schedule.id), name: scalar(schedule.name) }) : undefined;

const errorText = (source) => (isSet(source.error) ? clean(source.error, source.secrets) : undefined);

const backupFailedData = (source) => compact({ schedule: scheduleOf(source.schedule), error: errorText(source) });

const backupSucceededData = (source) =>
	compact({ schedule: scheduleOf(source.schedule), file: scalar(source.file), size: scalar(source.size) });

const backupRestoredData = (source) =>
	compact({ types: Array.isArray(source.types) ? source.types.map((type) => scalar(String(type))) : undefined });

const geoipData = (source) => compact({ reason: scalar(source.reason), error: errorText(source) });

const errorOnlyData = (source) => compact({ error: errorText(source) });

const ddnsData = (source) =>
	compact({
		record: source.record
			? compact({
					id: scalar(source.record.id),
					name: scalar(source.record.name),
					provider: scalar(source.record.provider),
				})
			: undefined,
		error: errorText(source),
	});

const databaseData = (source) =>
	compact({ from: scalar(source.from), to: scalar(source.to), error: errorText(source) });

const notificationTestData = (source) => compact({ version: scalar(source.version) });

const webhookDisabledData = (source) =>
	compact({
		webhook: source.webhook
			? compact({ id: scalar(source.webhook.id), name: scalar(source.webhook.name) })
			: undefined,
		reason: scalar(source.reason),
	});

const BOTH = Object.freeze(["mail", "webhook"]);
const WEBHOOK = Object.freeze(["webhook"]);

const state = (id, data) => Object.freeze({ id, kind: "state", channels: BOTH, data, mail: id, selectable: true });
const action = (id, data, channels = WEBHOOK) =>
	Object.freeze({ id, kind: "action", channels, data, selectable: true });

const STATE_EVENTS = Object.freeze([
	state("certificate.expiring", certificateExpiringData),
	state("certificate.renewal_failed", certificateRenewalFailedData),
	state("host.config_error", hostConfigErrorData),
	state("backup.failed", backupFailedData),
	state("geoip.failed", geoipData),
	state("crowdsec.unreachable", errorOnlyData),
	state("ddns.record_failed", ddnsData),
	state("ddns.record_stopped", ddnsData),
]);

const resolvedTwin = (entry) => Object.freeze({ ...entry, id: `${entry.id}.resolved`, mail: `${entry.id}.resolved` });

const CATALOGUE = Object.freeze([
	...STATE_EVENTS.flatMap((entry) => [entry, resolvedTwin(entry)]),
	action("host.created", hostActionData),
	action("host.updated", hostActionData),
	action("host.deleted", hostActionData),
	action("host.enabled", hostActionData),
	action("host.disabled", hostActionData),
	action("certificate.issued", certificateData),
	action("certificate.deleted", certificateData),
	action("certificate.renewed", certificateData),
	action("backup.succeeded", backupSucceededData),
	action("backup.restored", backupRestoredData),
	action("database.moved", databaseData),
	action("database.move_failed", databaseData),
	Object.freeze({ ...action("webhook.disabled", webhookDisabledData, BOTH), mail: "webhook.disabled" }),
	Object.freeze({ ...action("notification.test", notificationTestData, BOTH), selectable: false }),
]);

const BY_ID = new Map(CATALOGUE.map((entry) => [entry.id, entry]));

const eventById = (id) => BY_ID.get(id);

const stateEvents = () => STATE_EVENTS;

const resolvedOf = (id) => `${id}.resolved`;

const isSelectable = (id, channel) => {
	const entry = BY_ID.get(id);
	return Boolean(entry?.selectable && entry.channels.includes(channel));
};

/**
 * The events a channel offers in its pickers (the catalogue's selectable entries), as the events route answers them
 *
 * @returns {{id: String, kind: String, channels: String[]}[]}
 */
const selectableEvents = () =>
	CATALOGUE.filter((entry) => entry.selectable).map(({ id, kind, channels }) => ({
		id,
		kind,
		// mail ticks the base event, which covers its recovery: a .resolved twin is for webhooks only
		channels: channels.filter((channel) => channel !== "mail" || !id.endsWith(".resolved")),
	}));

/**
 * The whitelisted data of an event: only the fields its builder names
 *
 * @param   {String} id
 * @param   {Object} source
 * @returns {Object}
 */
const buildData = (id, source) => {
	const entry = BY_ID.get(id);
	if (!entry) throw new Error(`Unknown notification event ${id}`);
	return entry.data(source ?? {});
};

/**
 * "msg_" and 26 lower case base32 characters (RFC 4648) from 16 random bytes (the first 130 bits)
 *
 * @param   {Buffer} [bytes]
 * @returns {String}
 */
const messageId = (bytes = randomBytes(16)) => {
	const bits = Array.from(bytes, (byte) => byte.toString(2).padStart(8, "0")).join("");
	let out = "";
	for (let at = 0; out.length < 26; at += 5) {
		out += BASE32[Number.parseInt(bits.slice(at, at + 5).padEnd(5, "0"), 2)];
	}
	return `msg_${out}`;
};

const size = (value) => Buffer.byteLength(JSON.stringify(value));

const lengthOf = (value, type) => {
	if (type === "array") return Array.isArray(value) ? value.length : 0;
	return typeof value === "string" ? value.length : 0;
};

const longestKey = (data, type) => {
	let best;
	let bestLength = 0;
	for (const [key, value] of Object.entries(data)) {
		const length = lengthOf(value, type);
		if (length > bestLength) {
			best = key;
			bestLength = length;
		}
	}
	return best;
};

// the largest cut of a list or string that still fits: a binary search over the length
const fitCut = (envelope, key, cut) => {
	let low = 0;
	let high = envelope.data[key].length;
	const original = envelope.data[key];
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		envelope.data[key] = cut(original, mid);
		if (size(envelope) <= MAX_ENVELOPE_BYTES) low = mid;
		else high = mid - 1;
	}
	envelope.data[key] = cut(original, low);
};

/**
 * The event envelope. Above 20 KB the longest list of the data is cut until it fits and data.truncated is true; with
 * no list left, the longest string is cut.
 *
 * @param   {String}  type
 * @param   {Object}  data
 * @param   {Object}  [options]
 * @param   {Date}    [options.now]
 * @param   {Function} [options.randomId]
 * @returns {Object}
 */
const makeEnvelope = (type, data, { now = new Date(), randomId = messageId } = {}) => {
	const envelope = { id: randomId(), type, timestamp: iso(now), data: { ...data } };
	if (size(envelope) <= MAX_ENVELOPE_BYTES) return envelope;
	envelope.data.truncated = true;
	const listKey = longestKey(envelope.data, "array");
	if (listKey) {
		fitCut(envelope, listKey, (list, length) => list.slice(0, length));
		if (size(envelope) <= MAX_ENVELOPE_BYTES) return envelope;
	}
	const textKey = longestKey(envelope.data, "string");
	if (textKey) fitCut(envelope, textKey, (text, length) => text.slice(0, length));
	return envelope;
};

export {
	buildData,
	CATALOGUE,
	clean,
	eventById,
	isSelectable,
	makeEnvelope,
	messageId,
	resolvedOf,
	selectableEvents,
	stateEvents,
};
