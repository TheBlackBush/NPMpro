import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	filterBySchedule,
	formatInZone,
	initialValues,
	lastRunSize,
	scheduleBadge,
	scheduleErrors,
	scheduleNames,
	scheduleOf,
	scheduleStatus,
	timingText,
	timingValid,
	toPayload,
} from "./BackupSchedules.js";
import { nextRun, zoneOf } from "./ScheduleTime.js";

const values = {
	name: "Nightly",
	enabled: true,
	frequency: "daily",
	everyHours: "6",
	time: "03:00",
	weekday: "0",
	monthDay: "1",
	types: ["proxy_hosts"],
	protection: "none",
	passphrase: "",
	passphraseRepeat: "",
	keep: "7",
};

it("checks only the fields of the chosen frequency", () => {
	assert.deepEqual(scheduleErrors(values, {}), {});
	assert.deepEqual(scheduleErrors({ ...values, frequency: "hours", everyHours: "25" }, {}), {
		everyHours: "backup.schedule.error.every-hours",
	});
	assert.deepEqual(scheduleErrors({ ...values, name: "  ", keep: "0", types: [] }, {}), {
		name: "backup.schedule.error.name",
		keep: "backup.schedule.error.keep",
		types: "backup.schedule.error.types",
	});
});

it("needs the passphrase twice, unless one is stored and none is typed", () => {
	const protectedValues = { ...values, protection: "passphrase" };
	assert.deepEqual(Object.keys(scheduleErrors(protectedValues, {})), ["passphrase"]);
	assert.deepEqual(scheduleErrors(protectedValues, { editingWithPassphrase: true }), {});
	assert.deepEqual(
		Object.keys(
			scheduleErrors({ ...protectedValues, passphrase: "a long passphrase" }, { editingWithPassphrase: true }),
		),
		["passphraseRepeat"],
	);
});

it("sends only the fields of the frequency, numbers as numbers", () => {
	assert.deepEqual(toPayload({ ...values, frequency: "weekly", weekday: "2" }, { editing: false }), {
		name: "Nightly",
		enabled: true,
		frequency: "weekly",
		time: "03:00",
		weekday: 2,
		types: ["proxy_hosts"],
		protection: "none",
		keep: 7,
	});
	assert.equal(
		toPayload({ ...values, protection: "passphrase", passphrase: "a long passphrase" }, { editing: true })
			.passphrase,
		"a long passphrase",
	);
	assert.equal(
		Object.hasOwn(toPayload({ ...values, protection: "passphrase" }, { editing: true }), "passphrase"),
		false,
	);
});

it("status and the stored backups filter", () => {
	assert.equal(scheduleStatus({ enabled: false, lastStatus: "failed" }), "paused");
	assert.equal(scheduleStatus({ enabled: true, lastStatus: "failed" }), "failed");
	assert.equal(scheduleStatus({ enabled: true, lastStatus: "success" }), "next");
	const entries = [
		{ name: "a", scheduleId: 1 },
		{ name: "b", scheduleId: null },
		{ name: "c", scheduleId: 2 },
	];
	assert.deepEqual(
		filterBySchedule(entries, "").map((e) => e.name),
		["a", "b", "c"],
	);
	assert.deepEqual(
		filterBySchedule(entries, "none").map((e) => e.name),
		["b"],
	);
	assert.deepEqual(
		filterBySchedule(entries, "2").map((e) => e.name),
		["c"],
	);
});

it("timing as text: plural hours, the weekday counted from Monday", () => {
	const intl = createIntl({ locale: "en", messages: en });
	assert.equal(timingText({ frequency: "hours", everyHours: 1 }, intl), "Every hour");
	assert.equal(timingText({ frequency: "hours", everyHours: 6 }, intl), "Every 6 hours");
	assert.equal(timingText({ frequency: "daily", time: "03:00" }, intl), "Daily at 03:00");
	assert.equal(timingText({ frequency: "weekly", weekday: 0, time: "03:00" }, intl), "Weekly on Monday at 03:00");
	assert.equal(timingText({ frequency: "weekly", weekday: 6, time: "22:15" }, intl), "Weekly on Sunday at 22:15");
	assert.equal(timingText({ frequency: "monthly", monthDay: 28, time: "03:00" }, intl), "Monthly on day 28 at 03:00");
});

it("form values of a new and of a saved schedule", () => {
	const categories = [
		{ id: "hosts", types: ["proxy_hosts", "streams"] },
		{ id: "settings", types: ["settings"] },
	];
	const fresh = initialValues(null, categories);
	assert.equal(fresh.name, "");
	assert.equal(fresh.enabled, true);
	assert.equal(fresh.frequency, "daily");
	assert.equal(fresh.time, "03:00");
	assert.equal(fresh.protection, "instance_key");
	assert.equal(fresh.keep, "7");
	assert.ok(fresh.types.length > 0);
	const saved = {
		name: "Weekly",
		enabled: false,
		frequency: "weekly",
		everyHours: null,
		time: "04:30",
		weekday: 6,
		monthDay: null,
		types: ["streams"],
		protection: "passphrase",
		keep: 3,
	};
	assert.deepEqual(initialValues(saved, categories), {
		name: "Weekly",
		enabled: false,
		frequency: "weekly",
		everyHours: "6",
		time: "04:30",
		weekday: "6",
		monthDay: "1",
		types: ["streams"],
		protection: "passphrase",
		passphrase: "",
		passphraseRepeat: "",
		keep: "3",
	});
	// the form gets its own list
	assert.notEqual(initialValues(saved, categories).types, saved.types);
});

it("schedule names by id", () => {
	const names = scheduleNames([
		{ id: 1, name: "Nightly" },
		{ id: 4, name: "Weekly" },
	]);
	assert.equal(names.get(1), "Nightly");
	assert.equal(names.get(4), "Weekly");
	assert.equal(names.get(2), undefined);
	assert.equal(scheduleNames(undefined).size, 0);
});

it("the next run of the form, only while its timing is valid", () => {
	assert.equal(timingValid(values), true);
	assert.equal(timingValid({ ...values, name: "", keep: "0" }), true);
	assert.equal(timingValid({ ...values, time: "25:00" }), false);
	assert.equal(timingValid({ ...values, frequency: "hours", everyHours: "0" }), false);
	assert.equal(timingValid({ ...values, frequency: "hours", everyHours: "3", time: "" }), true);
	const schedule = scheduleOf({ ...values, frequency: "monthly", monthDay: "28", time: "03:00" });
	assert.deepEqual(schedule, {
		frequency: "monthly",
		every_hours: 6,
		time: "03:00",
		weekday: 0,
		month_day: 28,
		last_run_at: null,
	});
	const next = nextRun(schedule, new Date("2026-11-02T12:00:00Z"), zoneOf("Europe/Berlin"));
	assert.equal(next.toISOString(), "2026-11-28T02:00:00.000Z");
});

it("formats times in the server's zone", () => {
	const at = "2026-11-28T02:00:00.000Z";
	assert.ok(formatInZone(at, "en-GB", "Europe/Berlin").includes("03:00"));
	assert.ok(formatInZone(at, "en-GB", "UTC").includes("02:00"));
	// an unknown zone falls back to the browser's instead of failing
	assert.equal(typeof formatInZone(at, "en-GB", "Not/AZone"), "string");
});

it("a repeat typed without a passphrase is a mismatch, also when one is stored", () => {
	const protectedValues = { ...values, protection: "passphrase", passphraseRepeat: "something" };
	assert.deepEqual(scheduleErrors(protectedValues, { editingWithPassphrase: true }), {
		passphraseRepeat: "settings.backup.passphrase.mismatch",
	});
	assert.equal(Object.hasOwn(scheduleErrors(protectedValues, {}), "passphraseRepeat"), true);
});

it("the schedule badge waits for the schedule list", () => {
	const names = scheduleNames([{ id: 1, name: "Nightly" }]);
	assert.deepEqual(scheduleBadge({ scheduleId: 1 }, names), { kind: "name", name: "Nightly" });
	assert.deepEqual(scheduleBadge({ scheduleId: 2 }, names), { kind: "deleted" });
	// not loaded or failed: unknown, no badge
	assert.equal(scheduleBadge({ scheduleId: 2 }, null), null);
	assert.equal(scheduleBadge({ scheduleId: null }, names), null);
	assert.equal(scheduleBadge({}, names), null);
});

it("the last run shows a size only when that run made a file", () => {
	assert.equal(lastRunSize({ lastStatus: "success", lastSize: 2048 }), 2048);
	// a failed run keeps the size of the previous file in the row; it is not the failed run's
	assert.equal(lastRunSize({ lastStatus: "failed", lastSize: 2048 }), null);
	assert.equal(lastRunSize({ lastStatus: null, lastSize: null }), null);
	assert.equal(lastRunSize({ lastStatus: "success", lastSize: 0 }), null);
});
