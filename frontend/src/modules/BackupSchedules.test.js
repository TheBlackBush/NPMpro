import assert from "node:assert/strict";
import { it } from "node:test";
import { filterBySchedule, scheduleErrors, scheduleStatus, toPayload } from "./BackupSchedules.js";

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
