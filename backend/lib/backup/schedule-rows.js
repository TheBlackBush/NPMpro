import errs from "../error.js";
import { isoToLocal, localToIso } from "./rows.js";
import { FREQUENCIES, TIME } from "./schedule-time.js";

// Backup schedule rows: the body checks of the API, the database form of dates and the view the API returns.

// the schedules table and its backup type id, shared by the backup types, the merge plan and the merge
const TABLE = "npmpro_backup_schedule";
const SCHEDULE_TYPE = "backup_schedules";
const PROTECTIONS = ["passphrase", "instance_key", "none"];
const MIN_PASSPHRASE = 12;
const MAX_NAME = 60;
const NAIVE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/u;

const invalid = (code, message) => new errs.ValidationError(message, `backup.schedule.error.${code}`);
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const length = (text) => [...text.normalize("NFC")].length;

/**
 * The fields of a create (current null) or an update (current: the parsed stored row) after the checks
 *
 * @param   {Object}    body        the API body
 * @param   {?Object}   current     parseRow() of the stored row
 * @param   {string[]}  knownTypes  the backup type ids
 * @returns {{ fields: Object, passphrase: string | null | undefined }}  passphrase undefined keeps the stored one
 */
const normalizeSchedule = (body, current, knownTypes) => {
	const merged = { ...(current ?? {}), ...body };
	const name = String(merged.name ?? "").trim();
	if (length(name) < 1 || length(name) > MAX_NAME) throw invalid("name", "The name needs 1 to 60 characters");
	const { frequency } = merged;
	if (!FREQUENCIES.includes(frequency)) throw invalid("frequency", "Unknown frequency");
	const hours = frequency === "hours";
	if (hours && !isInt(merged.every_hours, 1, 24)) throw invalid("every-hours", "Every 1 to 24 hours");
	if (!(hours || TIME.test(String(merged.time ?? "")))) throw invalid("time", "The time is HH:MM, 00:00 to 23:59");
	if (frequency === "weekly" && !isInt(merged.weekday, 0, 6)) throw invalid("weekday", "The weekday is 0 to 6");
	if (frequency === "monthly" && !isInt(merged.month_day, 1, 28)) throw invalid("month-day", "The day is 1 to 28");
	const types = Array.isArray(merged.types) ? [...new Set(merged.types)] : [];
	if (types.length === 0 || types.some((typeId) => !knownTypes.includes(typeId))) {
		throw invalid("types", "Choose at least one known type");
	}
	if (!PROTECTIONS.includes(merged.protection)) throw invalid("protection", "Unknown protection");
	if (!isInt(merged.keep, 1, 100)) throw invalid("keep", "Keep 1 to 100 files");
	let passphrase;
	if (merged.protection !== "passphrase") passphrase = null;
	else if (typeof body.passphrase === "string" && body.passphrase !== "") {
		if (length(body.passphrase) < MIN_PASSPHRASE) {
			throw invalid("passphrase", "The passphrase needs at least 12 characters");
		}
		passphrase = body.passphrase;
	} else if (!current?.passphrase || current.protection !== "passphrase") {
		throw invalid("passphrase-required", "Enter a passphrase");
	}
	return {
		fields: {
			name,
			enabled: merged.enabled !== false,
			frequency,
			every_hours: hours ? merged.every_hours : null,
			time: hours ? null : merged.time,
			weekday: frequency === "weekly" ? merged.weekday : null,
			month_day: frequency === "monthly" ? merged.month_day : null,
			types,
			protection: merged.protection,
			keep: merged.keep,
		},
		passphrase,
	};
};

// SQLite and MySQL store process-local naive dates (the app's convention), Postgres takes Date
const toDbDate = (date, client) => {
	if (date === null || date === undefined) return null;
	return client === "pg" ? date : isoToLocal(date.toISOString());
};

const fromDbDate = (value) => {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value;
	return new Date(NAIVE.test(String(value)) ? localToIso(String(value).slice(0, 19)) : value);
};

const numberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

const parseTypes = (value) => {
	if (Array.isArray(value)) return value;
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};

/** A stored row with JSON, booleans, numbers and dates as values */
const parseRow = (row) => ({
	...row,
	id: Number(row.id),
	enabled: Boolean(Number(row.enabled)),
	types: parseTypes(row.types),
	every_hours: numberOrNull(row.every_hours),
	weekday: numberOrNull(row.weekday),
	month_day: numberOrNull(row.month_day),
	keep: Number(row.keep),
	owner_user_id: Number(row.owner_user_id),
	created_on: fromDbDate(row.created_on),
	modified_on: fromDbDate(row.modified_on),
	next_run_at: fromDbDate(row.next_run_at),
	last_run_at: fromDbDate(row.last_run_at),
	last_size: numberOrNull(row.last_size),
	last_duration_ms: numberOrNull(row.last_duration_ms),
});

const iso = (date) => (date ? date.toISOString() : null);

/** The API form: every column but the passphrase, plus passphrase_set and file_count */
const scheduleView = (parsed, fileCount) => {
	const { passphrase, ...rest } = parsed;
	return {
		...rest,
		created_on: iso(parsed.created_on),
		modified_on: iso(parsed.modified_on),
		next_run_at: iso(parsed.next_run_at),
		last_run_at: iso(parsed.last_run_at),
		passphrase_set: typeof passphrase === "string" && passphrase !== "",
		file_count: fileCount,
	};
};

export { fromDbDate, normalizeSchedule, parseRow, SCHEDULE_TYPE, scheduleView, TABLE, toDbDate };
