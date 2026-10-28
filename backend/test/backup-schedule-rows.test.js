import assert from "node:assert/strict";
import { it } from "node:test";

process.env.TZ = "Asia/Jerusalem";
const { fromDbDate, normalizeSchedule, parseRow, scheduleView, toDbDate } = await import(
	"../lib/backup/schedule-rows.js"
);

const KNOWN = ["proxy_hosts", "certificates", "backup_schedules"];
const base = {
	name: " Nightly ",
	frequency: "daily",
	time: "03:00",
	types: ["proxy_hosts"],
	protection: "none",
	keep: 7,
};
const fails = (code) => (err) => err.message_i18n === `backup.schedule.error.${code}` && err.public === true;

it("normalizes a daily schedule and clears the other timing fields", () => {
	const { fields, passphrase } = normalizeSchedule({ ...base, weekday: 3, every_hours: 5 }, null, KNOWN);
	assert.deepEqual(fields, {
		name: "Nightly",
		enabled: true,
		frequency: "daily",
		every_hours: null,
		time: "03:00",
		weekday: null,
		month_day: null,
		types: ["proxy_hosts"],
		protection: "none",
		keep: 7,
	});
	assert.equal(passphrase, null);
});

it("refuses values out of range", () => {
	assert.throws(() => normalizeSchedule({ ...base, name: "   " }, null, KNOWN), fails("name"));
	assert.throws(() => normalizeSchedule({ ...base, name: "x".repeat(61) }, null, KNOWN), fails("name"));
	assert.throws(() => normalizeSchedule({ ...base, frequency: "cron" }, null, KNOWN), fails("frequency"));
	assert.throws(
		() => normalizeSchedule({ ...base, frequency: "hours", every_hours: 25 }, null, KNOWN),
		fails("every-hours"),
	);
	assert.throws(() => normalizeSchedule({ ...base, time: "24:00" }, null, KNOWN), fails("time"));
	assert.throws(() => normalizeSchedule({ ...base, frequency: "weekly", weekday: 7 }, null, KNOWN), fails("weekday"));
	assert.throws(
		() => normalizeSchedule({ ...base, frequency: "monthly", month_day: 29 }, null, KNOWN),
		fails("month-day"),
	);
	assert.throws(() => normalizeSchedule({ ...base, types: [] }, null, KNOWN), fails("types"));
	assert.throws(() => normalizeSchedule({ ...base, types: ["nope"] }, null, KNOWN), fails("types"));
	assert.throws(() => normalizeSchedule({ ...base, protection: "zip" }, null, KNOWN), fails("protection"));
	assert.throws(() => normalizeSchedule({ ...base, keep: 0 }, null, KNOWN), fails("keep"));
	assert.throws(() => normalizeSchedule({ ...base, keep: 101 }, null, KNOWN), fails("keep"));
});

it("needs a passphrase of 12 characters for passphrase protection, keeps a stored one on edit", () => {
	const protectedBody = { ...base, protection: "passphrase" };
	assert.throws(() => normalizeSchedule(protectedBody, null, KNOWN), fails("passphrase-required"));
	assert.throws(() => normalizeSchedule({ ...protectedBody, passphrase: "short" }, null, KNOWN), fails("passphrase"));
	assert.equal(
		normalizeSchedule({ ...protectedBody, passphrase: "a long passphrase" }, null, KNOWN).passphrase,
		"a long passphrase",
	);
	const current = { ...base, protection: "passphrase", passphrase: "v1:sealed", enabled: true };
	assert.equal(normalizeSchedule({ keep: 3 }, current, KNOWN).passphrase, undefined);
	assert.equal(normalizeSchedule({ protection: "instance_key" }, current, KNOWN).passphrase, null);
});

it("an update merges into the stored schedule", () => {
	const current = { ...base, name: "Nightly", enabled: true, frequency: "weekly", weekday: 4 };
	const { fields } = normalizeSchedule({ frequency: "hours", every_hours: 6, enabled: false }, current, KNOWN);
	assert.equal(fields.frequency, "hours");
	assert.equal(fields.every_hours, 6);
	assert.equal(fields.time, null);
	assert.equal(fields.weekday, null);
	assert.equal(fields.enabled, false);
});

it("writes local naive dates on SQLite and MySQL and Date objects on Postgres, and reads both", () => {
	const date = new Date("2026-10-28T10:00:00Z");
	assert.equal(toDbDate(date, "better-sqlite3"), "2026-10-28 12:00:00");
	assert.equal(toDbDate(date, "mysql2"), "2026-10-28 12:00:00");
	assert.equal(toDbDate(date, "pg"), date);
	assert.equal(toDbDate(null, "pg"), null);
	assert.equal(fromDbDate("2026-10-28 12:00:00").toISOString(), date.toISOString());
	assert.equal(fromDbDate(date).toISOString(), date.toISOString());
	assert.equal(fromDbDate(null), null);
});

it("the view hides the passphrase and adds passphrase_set and file_count", () => {
	const parsed = parseRow({
		id: 4,
		created_on: "2026-10-28 12:00:00",
		modified_on: "2026-10-28 12:00:00",
		owner_user_id: 1,
		name: "Nightly",
		enabled: 1,
		frequency: "daily",
		every_hours: null,
		time: "03:00",
		weekday: null,
		month_day: null,
		types: '["proxy_hosts"]',
		protection: "passphrase",
		passphrase: "v1:sealed",
		keep: 7,
		next_run_at: "2026-10-29 03:00:00",
		last_run_at: null,
		last_status: null,
		last_error: null,
		last_file: null,
		last_size: "123",
		last_duration_ms: null,
	});
	const view = scheduleView(parsed, 2);
	assert.equal(Object.hasOwn(view, "passphrase"), false);
	assert.equal(view.passphrase_set, true);
	assert.equal(view.file_count, 2);
	assert.equal(view.enabled, true);
	assert.deepEqual(view.types, ["proxy_hosts"]);
	assert.equal(view.next_run_at, "2026-10-29T01:00:00.000Z");
	assert.equal(view.last_size, 123);
});
