/**
 * Helpers of the backup schedule UI. Form values are strings as the inputs hold them ({ name, enabled, frequency,
 * everyHours, time, weekday, monthDay, types, protection, passphrase, passphraseRepeat, keep }); a schedule is the API
 * row in camelCase (src/api/backend/base.js). Weekday 0 is Monday, as in the API.
 */
import { DEFAULT_SELECTED, passphraseErrors } from "./BackupTypes.js";
import { FREQUENCIES, TIME } from "./ScheduleTime.js";

export const PROTECTIONS = ["passphrase", "instance_key", "none"];

const NAME_MAX_LENGTH = 60;

// the fields each frequency uses besides the common ones
const FREQUENCY_FIELDS = {
	hours: ["everyHours"],
	daily: ["time"],
	weekly: ["weekday", "time"],
	monthly: ["monthDay", "time"],
};

// an integer from min to max, as a number or a string of digits; null otherwise
function intIn(value, min, max) {
	if (!/^\d+$/u.test(String(value ?? "").trim())) return null;
	const number = Number(String(value).trim());
	return number >= min && number <= max ? number : null;
}

const FIELD_CHECKS = {
	everyHours: (values) => intIn(values.everyHours, 1, 24) !== null || "backup.schedule.error.every-hours",
	time: (values) => TIME.test(String(values.time ?? "")) || "backup.schedule.error.time",
	weekday: (values) => intIn(values.weekday, 0, 6) !== null || "backup.schedule.error.weekday",
	monthDay: (values) => intIn(values.monthDay, 1, 28) !== null || "backup.schedule.error.month-day",
};

/**
 * Field errors as translation ids; only the fields of the chosen frequency are checked. The passphrase is checked
 * (with the rules of a manual backup) when Passphrase is chosen, unless the schedule already stores one and none is
 * typed.
 *
 * @param {Object}  values
 * @param {Object}  [options]
 * @param {boolean} [options.editingWithPassphrase]  editing a schedule that stores a passphrase
 * @returns {Object<string, string>}
 */
export function scheduleErrors(values, { editingWithPassphrase = false } = {}) {
	const errors = {};
	const name = [...String(values.name ?? "").trim()];
	if (name.length < 1 || name.length > NAME_MAX_LENGTH) errors.name = "backup.schedule.error.name";
	if (FREQUENCIES.includes(values.frequency)) {
		for (const field of FREQUENCY_FIELDS[values.frequency]) {
			const result = FIELD_CHECKS[field](values);
			if (result !== true) errors[field] = result;
		}
	} else {
		errors.frequency = "backup.schedule.error.frequency";
	}
	if (!Array.isArray(values.types) || values.types.length === 0) errors.types = "backup.schedule.error.types";
	if (!PROTECTIONS.includes(values.protection)) errors.protection = "backup.schedule.error.protection";
	if (intIn(values.keep, 1, 100) === null) errors.keep = "backup.schedule.error.keep";
	const keepsStored = editingWithPassphrase && values.passphrase === "";
	if (values.protection === "passphrase" && keepsStored && (values.passphraseRepeat ?? "") !== "") {
		// a value typed only in the repeat field is a mistake, not "keep the stored passphrase"
		errors.passphraseRepeat = "settings.backup.passphrase.mismatch";
	} else if (values.protection === "passphrase" && !keepsStored) {
		Object.assign(
			errors,
			passphraseErrors({
				secrets: true,
				passphrase: values.passphrase ?? "",
				passphraseRepeat: values.passphraseRepeat ?? "",
			}),
		);
	}
	return errors;
}

/**
 * The request body of a create or update: only the fields of the chosen frequency (the API refuses null for the
 * others), numbers as numbers, the passphrase only when Passphrase is chosen and one is typed (an empty one keeps the
 * stored passphrase on an update).
 *
 * @param {Object}  values
 * @param {Object}  [options]
 * @param {boolean} [options.editing]
 */
export function toPayload(values, { editing = false } = {}) {
	const payload = {
		name: String(values.name).trim(),
		enabled: Boolean(values.enabled),
		frequency: values.frequency,
		types: values.types,
		protection: values.protection,
		keep: Number(values.keep),
	};
	for (const field of FREQUENCY_FIELDS[values.frequency] ?? []) {
		payload[field] = field === "time" ? values.time : Number(values[field]);
	}
	if (values.protection === "passphrase" && (values.passphrase !== "" || !editing)) {
		payload.passphrase = values.passphrase;
	}
	return payload;
}

/**
 * The form values of a schedule, or of a new one (daily at 03:00, every part, the instance key, keep 7) when schedule
 * is null.
 *
 * @param {Object|null} schedule
 * @param {Array}       categories  from GET /api/backups/types
 */
export function initialValues(schedule, categories) {
	return {
		name: schedule?.name ?? "",
		enabled: schedule ? Boolean(schedule.enabled) : true,
		frequency: schedule?.frequency ?? "daily",
		everyHours: String(schedule?.everyHours ?? 6),
		time: schedule?.time ?? "03:00",
		weekday: String(schedule?.weekday ?? 0),
		monthDay: String(schedule?.monthDay ?? 1),
		types: schedule ? [...(schedule.types ?? [])] : DEFAULT_SELECTED(categories ?? []),
		protection: schedule?.protection ?? "instance_key",
		passphrase: "",
		passphraseRepeat: "",
		keep: String(schedule?.keep ?? 7),
	};
}

/**
 * The name of a weekday (0 = Monday) in the locale, from a fixed Monday (2026-11-02)
 */
export function weekdayName(weekday, locale) {
	return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
		new Date(Date.UTC(2026, 10, 2 + Number(weekday), 12)),
	);
}

/**
 * When a schedule runs, as text: "Every 6 hours", "Daily at 03:00", "Weekly on Monday at 03:00", "Monthly on day 28
 * at 03:00"
 *
 * @param {Object} schedule
 * @param {Object} intl      a react-intl intl object
 */
export function timingText(schedule, intl) {
	const message = (id, values) => intl.formatMessage({ id: `settings.backup.schedule.timing.${id}` }, values);
	switch (schedule.frequency) {
		case "hours":
			return message("hours", { count: schedule.everyHours });
		case "daily":
			return message("daily", { time: schedule.time });
		case "weekly":
			return message("weekly", { weekday: weekdayName(schedule.weekday, intl.locale), time: schedule.time });
		case "monthly":
			return message("monthly", { day: schedule.monthDay, time: schedule.time });
		default:
			return "";
	}
}

/**
 * The status badge of a schedule: paused while disabled, failed after a failed last run, else the next run
 *
 * @returns {"paused" | "failed" | "next"}
 */
export function scheduleStatus(schedule) {
	if (!schedule.enabled) return "paused";
	return schedule.lastStatus === "failed" ? "failed" : "next";
}

/**
 * @returns {Map<number, string>} schedule id to name
 */
export function scheduleNames(schedules) {
	return new Map((schedules ?? []).map((schedule) => [schedule.id, schedule.name]));
}

/**
 * The schedule badge of a stored backup: its schedule's name, "deleted" when the id is not in the loaded list, null
 * for a file of no schedule or while the list is unknown (names null: not loaded yet or failed)
 *
 * @param {Object}                    entry  a stored backup ({ scheduleId })
 * @param {Map<number, string>|null}  names  scheduleNames of the loaded list, or null
 * @returns {{ kind: "name", name: string } | { kind: "deleted" } | null}
 */
export function scheduleBadge(entry, names) {
	if (entry.scheduleId === null || entry.scheduleId === undefined || !names) return null;
	return names.has(entry.scheduleId) ? { kind: "name", name: names.get(entry.scheduleId) } : { kind: "deleted" };
}

/**
 * Stored backups limited by the "Schedule" filter: "" all, "none" those of no schedule, else the id of a schedule
 * (as a string, the select's value)
 */
export function filterBySchedule(entries, filter) {
	if (filter === "") return entries;
	if (filter === "none")
		return entries.filter((entry) => entry.scheduleId === null || entry.scheduleId === undefined);
	return entries.filter((entry) => String(entry.scheduleId) === filter);
}

// the fields that decide when a schedule runs
const TIMING_FIELDS = ["frequency", ...new Set(Object.values(FREQUENCY_FIELDS).flat())];

/**
 * Whether the timing fields of the form are valid (the next run can be computed)
 */
export function timingValid(values) {
	const errors = scheduleErrors(values);
	return !TIMING_FIELDS.some((field) => Object.hasOwn(errors, field));
}

/**
 * The form values as the schedule nextRun (ScheduleTime.js) takes, in the API's snake_case
 *
 * @param {Object}      values
 * @param {string|null} [lastRunAt]  the start of the schedule's last run (the base of "every N hours")
 */
export function scheduleOf(values, lastRunAt = null) {
	return {
		frequency: values.frequency,
		every_hours: Number(values.everyHours),
		time: values.time,
		weekday: Number(values.weekday),
		month_day: Number(values.monthDay),
		last_run_at: lastRunAt,
	};
}

/**
 * A date and time (an ISO string or a Date) in the server's time zone, so it agrees with the schedule's "at 03:00";
 * in the browser's zone when the zone is unknown or not valid
 *
 * @param {string|Date} value
 * @param {string}      locale
 * @param {string}      [timeZone]
 */
export function formatInZone(value, locale, timeZone) {
	const options = { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" };
	const date = new Date(value);
	try {
		return new Intl.DateTimeFormat(locale, { ...options, timeZone: timeZone || undefined }).format(date);
	} catch {
		return new Intl.DateTimeFormat(locale, options).format(date);
	}
}
