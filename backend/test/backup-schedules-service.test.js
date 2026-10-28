import assert from "node:assert/strict";
import { after, it } from "node:test";
import knexFactory from "knex";
import { BackupError } from "../lib/backup/format.js";
import { createSchema } from "./support/backup-schema.js";

process.env.TZ = "UTC";
const { createScheduleService, SKIPPED } = await import("../internal/backup-schedules.js");

const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const admin = (id = 1) => ({ canAdmin: () => true, token: { getUserId: () => id } });
const daily = {
	name: "Nightly",
	frequency: "daily",
	time: "03:00",
	types: ["proxy_hosts"],
	protection: "none",
	keep: 2,
};

const opened = [];
after(() => Promise.all(opened.map((knex) => knex.destroy())));

const make = async ({ run, log = silent, sealer = box } = {}) => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	opened.push(knex);
	await createSchema(knex);
	const clock = { value: Date.parse("2026-10-28T12:00:00Z"), now: () => clock.value };
	const files = new Map(); // schedule id -> names, newest first
	const audits = [];
	const backupCalls = [];
	const pruneCalls = [];
	const service = createScheduleService({
		knex,
		box: sealer,
		clock,
		log,
		audit: async (access, entry) => audits.push({ by: entry.user_id ?? access.token.getUserId(0), ...entry }),
		backup: {
			scheduledBackup: async (options) => {
				backupCalls.push(options);
				if (run) await run(options);
				const name = `npmpro-backup-npm-${backupCalls.length}-s${options.scheduleId}.npmpro`;
				files.set(options.scheduleId, [name, ...(files.get(options.scheduleId) ?? [])]);
				return { name, size: 100 };
			},
		},
		store: {
			scheduleFiles: async (id) => (files.get(id) ?? []).map((name) => ({ name })),
			pruneSchedule: async (id, keep) => {
				pruneCalls.push([id, keep]);
				const all = files.get(id) ?? [];
				files.set(id, all.slice(0, keep));
				return all.slice(keep);
			},
		},
	});
	return { knex, clock, files, audits, backupCalls, pruneCalls, service };
};

it("create sets next_run_at and owner, hides the passphrase and audits", async () => {
	const { service, audits } = await make();
	const view = await service.create(admin(4), { ...daily, protection: "passphrase", passphrase: "twelve chars!" });
	assert.equal(view.next_run_at, "2026-10-29T03:00:00.000Z");
	assert.equal(view.owner_user_id, 4);
	assert.equal(view.passphrase_set, true);
	assert.equal(Object.hasOwn(view, "passphrase"), false);
	assert.equal(view.file_count, 0);
	assert.deepEqual(
		audits.map((entry) => [entry.action, entry.object_type, entry.by]),
		[["created", "backup-schedule", 4]],
	);
	await assert.rejects(
		service.create(admin(), { ...daily, name: "NIGHTLY" }),
		(err) => err.message_i18n === "backup.schedule.error.name-taken",
	);
});

it("pause clears next_run_at and audits disabled, resume recomputes it and audits enabled", async () => {
	const { service, audits } = await make();
	const { id } = await service.create(admin(), daily);
	assert.equal((await service.update(admin(), id, { enabled: false })).next_run_at, null);
	assert.equal((await service.update(admin(), id, { enabled: true })).next_run_at, "2026-10-29T03:00:00.000Z");
	assert.deepEqual(
		audits.map((entry) => entry.action),
		["created", "disabled", "enabled"],
	);
});

it("an automatic run stores the status, prunes and audits under the owner", async () => {
	const { service, clock, files, audits, backupCalls } = await make();
	const { id } = await service.create(admin(4), daily);
	for (let n = 0; n < 3; n++) {
		clock.value = Date.parse(`2026-10-${29 + n}T03:00:00Z`);
		const [due] = await service.dueSchedules(clock.now());
		await service.runAutomatic(due);
	}
	assert.equal(files.get(id).length, 2);
	assert.equal(backupCalls[0].userId, 4);
	const view = await service.get(admin(), id);
	assert.equal(view.last_status, "success");
	assert.equal(view.last_file, "npmpro-backup-npm-3-s1.npmpro");
	assert.equal(view.last_size, 100);
	assert.equal(view.next_run_at, "2026-11-01T03:00:00.000Z");
	assert.equal(view.file_count, 2);
	const runs = audits.filter((entry) => entry.action === "backup-succeeded");
	assert.equal(runs.length, 3);
	assert.equal(runs[0].by, 4);
	assert.equal(runs[0].meta.automatic, true);
});

it("a failed run keeps the files, stores the error and the dashboard list shows it until a success", async () => {
	let fail = true;
	const { service, clock } = await make({
		run: async () => {
			if (fail) throw new Error("disk full");
		},
	});
	const { id } = await service.create(admin(), daily);
	clock.value = Date.parse("2026-10-29T03:00:00Z");
	await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	const view = await service.get(admin(), id);
	assert.equal(view.last_status, "failed");
	assert.equal(view.last_error, "disk full");
	assert.deepEqual(await service.failedSchedules(), [{ id, name: "Nightly" }]);
	fail = false;
	await service.runNow(admin(), id);
	assert.deepEqual(await service.failedSchedules(), []);
});

it("edited during a run: the edit stays and retention uses the new keep", async () => {
	let edit;
	const { service, clock, files } = await make({ run: async () => edit?.() });
	const { id } = await service.create(admin(), { ...daily, keep: 5 });
	for (const day of [29, 30]) {
		clock.value = Date.parse(`2026-10-${day}T03:00:00Z`);
		await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	}
	edit = () => service.update(admin(), id, { keep: 1, time: "05:00" });
	clock.value = Date.parse("2026-10-31T03:00:00Z");
	await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	const view = await service.get(admin(), id);
	assert.equal(view.keep, 1);
	assert.equal(view.time, "05:00");
	assert.equal(view.next_run_at, "2026-11-01T05:00:00.000Z");
	assert.equal(files.get(id).length, 1);
});

it("deleted during a run: nothing fails and no row comes back", async () => {
	let remove;
	const { service, clock, knex, audits } = await make({ run: async () => remove?.() });
	const { id } = await service.create(admin(), daily);
	remove = () => service.remove(admin(), id, { files: false });
	clock.value = Date.parse("2026-10-29T03:00:00Z");
	await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	assert.equal((await knex("npmpro_backup_schedule").count({ count: "*" }))[0].count, 0);
	assert.ok(audits.some((entry) => entry.action === "backup-succeeded"));
});

it("run now keeps a future next run and refuses while busy without touching the status", async () => {
	let busy = false;
	const { service } = await make({
		run: async () => {
			if (busy) throw Object.assign(new BackupError("busy", "A backup or restore is running"), { status: 409 });
		},
	});
	const { id } = await service.create(admin(), daily);
	const view = await service.runNow(admin(7), id);
	assert.equal(view.next_run_at, "2026-10-29T03:00:00.000Z");
	assert.equal(view.last_status, "success");
	busy = true;
	await assert.rejects(service.runNow(admin(), id), (err) => err.code === "busy");
	assert.equal((await service.get(admin(), id)).last_status, "success");
});

it("catch-up runs an overdue schedule once and moves next_run_at to the future", async () => {
	const { service, clock, backupCalls } = await make();
	const { id } = await service.create(admin(), daily);
	clock.value = Date.parse("2026-11-05T10:00:00Z"); // five slots missed
	const due = await service.dueSchedules(clock.now());
	assert.deepEqual(
		due.map((row) => row.id),
		[id],
	);
	await service.runAutomatic(due[0]);
	assert.equal(backupCalls.length, 1);
	assert.equal((await service.get(admin(), id)).next_run_at, "2026-11-06T03:00:00.000Z");
	assert.deepEqual(await service.dueSchedules(clock.now()), []);
});

it("give-up records the skip as a failure", async () => {
	const { service, clock } = await make();
	const { id } = await service.create(admin(), daily);
	clock.value = Date.parse("2026-10-29T04:00:00Z");
	await service.giveUp((await service.dueSchedules(clock.now()))[0]);
	const view = await service.get(admin(), id);
	assert.equal(view.last_status, "failed");
	assert.equal(view.last_error, SKIPPED);
	assert.equal(view.next_run_at, "2026-10-30T03:00:00.000Z");
});

it("remove with files deletes the schedule's stored files", async () => {
	const { service, clock, files } = await make();
	const { id } = await service.create(admin(), daily);
	await service.runNow(admin(), id);
	clock.value += 1000;
	const { removedFiles } = await service.remove(admin(), id, { files: true });
	assert.equal(removedFiles.length, 1);
	assert.equal(files.get(id).length, 0);
});

const busyError = () => Object.assign(new BackupError("busy", "A backup or restore is running"), { status: 409 });

it("a busy automatic run throws and leaves the status for the next tick", async () => {
	let busy = true;
	const { service, clock, audits } = await make({
		run: async () => {
			if (busy) throw busyError();
		},
	});
	const { id } = await service.create(admin(), daily);
	clock.value = Date.parse("2026-10-29T03:00:00Z");
	const [due] = await service.dueSchedules(clock.now());
	await assert.rejects(service.runAutomatic(due), (err) => err.code === "busy");
	const view = await service.get(admin(), id);
	assert.equal(view.last_status, null);
	assert.equal(view.last_run_at, null);
	assert.equal(view.next_run_at, "2026-10-29T03:00:00.000Z");
	assert.deepEqual(
		audits.map((entry) => entry.action),
		["created"],
	);
	busy = false;
	await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	assert.equal((await service.get(admin(), id)).last_status, "success");
});

it("give-up audits a failed automatic run under the owner", async () => {
	const { service, clock, audits, backupCalls, pruneCalls } = await make();
	await service.create(admin(4), daily);
	clock.value = Date.parse("2026-10-29T04:00:00Z");
	await service.giveUp((await service.dueSchedules(clock.now()))[0]);
	const [entry] = audits.filter((item) => item.action === "backup-failed");
	assert.equal(entry.by, 4);
	assert.deepEqual(entry.meta, { name: "Nightly", error: SKIPPED, automatic: true });
	assert.equal(backupCalls.length, 0);
	assert.equal(pruneCalls.length, 0);
});

it("a failed run does not prune and keeps the last successful file", async () => {
	let fail = false;
	const { service, clock, files, pruneCalls } = await make({
		run: async () => {
			if (fail) throw new Error("disk full");
		},
	});
	const { id } = await service.create(admin(), { ...daily, keep: 1 });
	clock.value = Date.parse("2026-10-29T03:00:00Z");
	await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	assert.deepEqual(pruneCalls, [[id, 1]]);
	fail = true;
	clock.value = Date.parse("2026-10-30T03:00:00Z");
	await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	assert.deepEqual(pruneCalls, [[id, 1]]);
	assert.equal(files.get(id).length, 1);
	const view = await service.get(admin(), id);
	assert.equal(view.last_status, "failed");
	assert.equal(view.last_file, "npmpro-backup-npm-1-s1.npmpro");
	assert.equal(view.last_size, 100);
	assert.equal(view.next_run_at, "2026-10-31T03:00:00.000Z");
});

it("a passphrase that cannot be unsealed is a failed run with its message", async () => {
	const sealer = {
		encrypt: box.encrypt,
		decrypt: () => {
			throw new Error("The stored secret cannot be opened");
		},
	};
	const { service, clock, backupCalls, audits } = await make({ sealer });
	const { id } = await service.create(admin(), { ...daily, protection: "passphrase", passphrase: "twelve chars!" });
	clock.value = Date.parse("2026-10-29T03:00:00Z");
	await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	assert.equal(backupCalls.length, 0);
	const view = await service.get(admin(), id);
	assert.equal(view.last_status, "failed");
	assert.equal(view.last_error, "The stored secret cannot be opened");
	assert.equal(audits.at(-1).action, "backup-failed");
});

it("the unsealed passphrase, types and protection reach the backup", async () => {
	const { service, backupCalls } = await make();
	const { id } = await service.create(admin(), { ...daily, protection: "passphrase", passphrase: "twelve chars!" });
	await service.runNow(admin(7), id);
	assert.deepEqual(backupCalls, [
		{ scheduleId: id, types: ["proxy_hosts"], protection: "passphrase", passphrase: "twelve chars!", userId: 7 },
	]);
});

it("last_error is cut to 1000 characters", async () => {
	const { service } = await make({
		run: async () => {
			throw new Error("x".repeat(1500));
		},
	});
	const { id } = await service.create(admin(), daily);
	await service.runNow(admin(), id);
	assert.equal((await service.get(admin(), id)).last_error.length, 1000);
});

it("names are unique without regard to case, a schedule may change the case of its own name", async () => {
	const { service } = await make();
	const first = await service.create(admin(), daily);
	const second = await service.create(admin(), { ...daily, name: "Weekly" });
	await assert.rejects(
		service.update(admin(), second.id, { name: " nightly " }),
		(err) => err.message_i18n === "backup.schedule.error.name-taken",
	);
	assert.equal((await service.update(admin(), first.id, { name: "NIGHTLY" })).name, "NIGHTLY");
	assert.deepEqual(
		(await service.list(admin())).map((view) => view.name),
		["Weekly", "NIGHTLY"],
	);
});

it("an unknown id is not found", async () => {
	const { service } = await make();
	for (const call of [
		(access) => service.get(access, 99),
		(access) => service.update(access, 99, { keep: 3 }),
		(access) => service.remove(access, 99, { files: false }),
		(access) => service.runNow(access, 99),
	]) {
		await assert.rejects(call(admin()), (err) => err.name === "ItemNotFoundError");
	}
});

it("every API method asks for admin rights before anything else", async () => {
	const { service, backupCalls, audits } = await make();
	const { id } = await service.create(admin(), daily);
	const denied = new Error("Permission denied");
	const asked = [];
	const user = {
		canAdmin: () => {
			asked.push(true);
			throw denied;
		},
		token: { getUserId: () => 2 },
	};
	const calls = [
		() => service.list(user),
		() => service.get(user, id),
		() => service.create(user, { ...daily, name: "Other" }),
		() => service.update(user, id, { keep: 3 }),
		() => service.remove(user, id, { files: true }),
		() => service.runNow(user, id),
		() => service.get(user, 99),
	];
	for (const call of calls) await assert.rejects(call(), (err) => err === denied);
	assert.equal(asked.length, calls.length);
	assert.equal(backupCalls.length, 0);
	assert.deepEqual(
		audits.map((entry) => entry.action),
		["created"],
	);
	assert.equal((await service.list(admin())).length, 1);
});

it("audits saves, deletes and runs with the right action, user and meta", async () => {
	const { service, audits } = await make();
	const { id } = await service.create(admin(3), daily);
	await service.update(admin(5), id, { keep: 3 });
	await service.update(admin(5), id, { enabled: false, keep: 3 });
	await service.runNow(admin(6), id);
	await service.remove(admin(8), id, { files: true });
	assert.deepEqual(
		audits.map((entry) => [entry.action, entry.by, entry.object_type, entry.object_id]),
		[
			["created", 3, "backup-schedule", id],
			["updated", 5, "backup-schedule", id],
			["updated", 5, "backup-schedule", id],
			["backup-succeeded", 6, "backup-schedule", id],
			["deleted", 8, "backup-schedule", id],
		],
	);
	assert.deepEqual(audits[3].meta, {
		name: "Nightly",
		file: "npmpro-backup-npm-1-s1.npmpro",
		size: 100,
		removed: [],
		automatic: false,
	});
	assert.deepEqual(audits[4].meta, { name: "Nightly", files_deleted: 1 });
});

it("a run of a paused schedule keeps next_run_at empty", async () => {
	const { service } = await make();
	const { id } = await service.create(admin(), { ...daily, enabled: false });
	const view = await service.runNow(admin(), id);
	assert.equal(view.last_status, "success");
	assert.equal(view.next_run_at, null);
});

it("run now with an overdue next run moves it to the future", async () => {
	const { service, clock } = await make();
	const { id } = await service.create(admin(), daily);
	clock.value = Date.parse("2026-10-29T05:00:00Z");
	assert.equal((await service.runNow(admin(), id)).next_run_at, "2026-10-30T03:00:00.000Z");
});

it("writes one log line per run", async () => {
	const lines = [];
	let fail = false;
	const log = {
		info: (line) => lines.push(["info", line]),
		warn: (line) => lines.push(["warn", line]),
		error: (line) => lines.push(["error", line]),
	};
	const { service, clock } = await make({
		log,
		run: async () => {
			clock.value += 250;
			if (fail) throw new Error("disk full");
		},
	});
	const { id } = await service.create(admin(), daily);
	await service.runNow(admin(), id);
	fail = true;
	await service.runNow(admin(), id);
	assert.deepEqual(lines, [
		["info", 'Scheduled backup "Nightly": succeeded, 100 bytes, 250 ms'],
		["warn", 'Scheduled backup "Nightly": failed, disk full, 250 ms'],
	]);
});

it("paused during a run: the run is recorded and next_run_at stays empty", async () => {
	let pause;
	const { service, clock } = await make({ run: async () => pause?.() });
	const { id } = await service.create(admin(), daily);
	pause = () => service.update(admin(), id, { enabled: false });
	clock.value = Date.parse("2026-10-29T03:00:00Z");
	await service.runAutomatic((await service.dueSchedules(clock.now()))[0]);
	const view = await service.get(admin(), id);
	assert.equal(view.enabled, false);
	assert.equal(view.last_status, "success");
	assert.equal(view.next_run_at, null);
	assert.deepEqual(await service.dueSchedules(Date.parse("2026-11-30T00:00:00Z")), []);
});
