import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { startApi } from "./support/api.js";
import { countRows, fileExists } from "./support/hosts.js";

// /backups/schedules* (schema/paths/backups/schedules, wiki/Backup-and-restore): scheduled backups, created, changed,
// run by hand and deleted through the API.

const BASE = "/backups/schedules";
const PASSPHRASE = "  twelve chars  ";

let api;
let admin;
let names = 0;

const valid = (overrides = {}) => {
	names += 1;
	return {
		name: `Schedule ${names}`,
		frequency: "daily",
		time: "03:00",
		types: ["proxy_hosts"],
		protection: "none",
		keep: 3,
		...overrides,
	};
};
const create = async (overrides = {}, session = admin) => {
	const done = await session.post(BASE, valid(overrides));
	assert.equal(done.status, 200, done.text);
	return done.body;
};
const files = async () => (await admin.get("/backups")).body;
const filesOf = async (id) => (await files()).filter((entry) => entry.schedule_id === id);
const run = async (id) => {
	const done = await admin.post(`${BASE}/${id}/run`);
	assert.equal(done.status, 200, done.text);
	return done.body;
};

before(async () => {
	api = await startApi({ env: { TZ: "Europe/Berlin" } });
	admin = await api.admin();
	// a new instance has no schedules
	const done = await admin.get(BASE);
	assert.equal(done.status, 200);
	assert.deepEqual(done.body, []);
});
after(() => api?.stop());

it("creates a daily schedule with the next run in the container time zone", async () => {
	const body = valid({ name: "Nightly", keep: 7 });
	const created = await create(body);
	assert.equal(created.name, "Nightly");
	assert.equal(created.enabled, true);
	assert.equal(created.frequency, "daily");
	assert.equal(created.time, "03:00");
	assert.deepEqual(created.types, ["proxy_hosts"]);
	assert.equal(created.protection, "none");
	assert.equal(created.keep, 7);
	assert.equal(created.owner_user_id, 1);
	assert.equal(created.passphrase_set, false);
	assert.equal(created.file_count, 0);
	assert.equal(created.last_status, null);
	assert.equal(created.every_hours, null);
	// 03:00 in Berlin is 01:00 or 02:00 UTC
	assert.match(created.next_run_at, /T0[12]:00:00\.000Z$/u);
	assert.ok(Date.parse(created.next_run_at) > Date.now());
	const row = await api.db("npmpro_backup_schedule").where({ id: created.id }).first();
	assert.equal(row.name, "Nightly");
	const audit = await api.db("audit_log").where({ object_type: "backup-schedule", object_id: created.id }).first();
	assert.equal(audit.action, "created");
});

it("reads and lists schedules: GET /backups/schedules reaches the schedules, not a stored backup", async () => {
	const created = await create();
	const list = await admin.get(BASE);
	assert.equal(list.status, 200);
	assert.ok(Array.isArray(list.body));
	assert.deepEqual(
		list.body.find((entry) => entry.id === created.id),
		created,
	);
	const one = await admin.get(`${BASE}/${created.id}`);
	assert.deepEqual(one.body, created);
	assert.equal((await admin.get(`${BASE}/999999`)).status, 404);
});

it("creates schedules of every frequency and refuses the missing or out of range timing", async () => {
	const hours = await create({ frequency: "hours", every_hours: 6, time: undefined });
	assert.equal(hours.every_hours, 6);
	assert.equal(hours.time, null);
	const weekly = await create({ frequency: "weekly", weekday: 2 });
	assert.equal(weekly.weekday, 2);
	const monthly = await create({ frequency: "monthly", month_day: 28 });
	assert.equal(monthly.month_day, 28);
	const rows = await countRows(api, "npmpro_backup_schedule");
	for (const body of [
		{ frequency: "hours", time: undefined },
		{ frequency: "hours", every_hours: 0, time: undefined },
		{ frequency: "hours", every_hours: 25, time: undefined },
		{ frequency: "weekly" },
		{ frequency: "weekly", weekday: 7 },
		{ frequency: "monthly" },
		{ frequency: "monthly", month_day: 29 },
		{ frequency: "monthly", month_day: 0 },
		{ time: "24:00" },
		{ time: "3:00" },
		{ time: undefined },
		{ frequency: "yearly" },
		{ keep: 0 },
		{ keep: 101 },
		{ keep: 1.5 },
		{ name: "" },
		{ name: "x".repeat(61) },
		{ types: [] },
		{ types: ["proxy_hosts", "proxy_hosts"] },
		{ types: ["audit_log"] },
		{ protection: "magic" },
		{ enabled: "yes" },
	]) {
		const done = await admin.post(BASE, valid(body));
		assert.equal(done.status, 400, `${JSON.stringify(body)}: ${done.text}`);
	}
	assert.equal(await countRows(api, "npmpro_backup_schedule"), rows);
});

it("refuses a second schedule with the same name, in any letter case", async () => {
	const first = await create({ name: "Weekly Offsite" });
	for (const name of ["Weekly Offsite", "weekly offsite", "WEEKLY OFFSITE"]) {
		const done = await admin.post(BASE, valid({ name }));
		assert.equal(done.status, 400, name);
		assert.equal(done.body.error.message_i18n, "backup.schedule.error.name-taken");
	}
	const other = await create({ name: "Other" });
	const renamed = await admin.put(`${BASE}/${other.id}`, { name: "weekly offsite" });
	assert.equal(renamed.status, 400);
	assert.equal(renamed.body.error.message_i18n, "backup.schedule.error.name-taken");
	assert.equal((await admin.get(`${BASE}/${first.id}`)).body.name, "Weekly Offsite");
});

it("answers a schedule id that is not a positive integer with 400, on every method", async () => {
	for (const id of ["0", "abc", "-1", "1.5", "1e3", "12345678901"]) {
		for (const [method, suffix, body] of [
			["get", "", undefined],
			["put", "", { keep: 5 }],
			["delete", "", undefined],
			["post", "/run", undefined],
		]) {
			const done = await admin[method](`${BASE}/${id}${suffix}`, body);
			assert.equal(done.status, 400, `${method} ${id}${suffix}: ${done.text}`);
		}
	}
});

it("refuses numbers sent as text, null or true with 400 and the message id of the field", async () => {
	const created = await create();
	for (const [field, code, extra] of [
		["keep", "keep", {}],
		["every_hours", "every-hours", { frequency: "hours" }],
		["weekday", "weekday", { frequency: "weekly" }],
		["month_day", "month-day", { frequency: "monthly" }],
	]) {
		for (const value of ["3", null, true]) {
			const post = await admin.post(BASE, valid({ ...extra, [field]: value }));
			assert.equal(post.status, 400, `${field} ${value}`);
			assert.equal(post.body.error.message_i18n, `backup.schedule.error.${code}`, `post ${field} ${value}`);
			const put = await admin.put(`${BASE}/${created.id}`, { [field]: value });
			assert.equal(put.status, 400, `put ${field} ${value}`);
			assert.equal(put.body.error.message_i18n, `backup.schedule.error.${code}`, `put ${field} ${value}`);
		}
	}
	assert.equal((await admin.get(`${BASE}/${created.id}`)).body.keep, 3);
});

it("refuses unknown fields and empty bodies", async () => {
	const created = await create();
	assert.equal((await admin.post(BASE, valid({ extra: 1 }))).status, 400);
	assert.equal((await admin.post(BASE, {})).status, 400);
	assert.equal((await admin.put(`${BASE}/${created.id}`, {})).status, 400);
	assert.equal((await admin.put(`${BASE}/${created.id}`, { extra: 1 })).status, 400);
	assert.equal((await admin.put(`${BASE}/${created.id}`, { id: 99 })).status, 400);
});

it("updates a schedule, pauses and resumes it, and records each change", async () => {
	const created = await create({ name: "Changing" });
	const changed = await admin.put(`${BASE}/${created.id}`, {
		name: "Changed",
		keep: 10,
		frequency: "hours",
		every_hours: 12,
		types: ["proxy_hosts", "streams"],
	});
	assert.equal(changed.status, 200, changed.text);
	assert.equal(changed.body.name, "Changed");
	assert.equal(changed.body.keep, 10);
	assert.equal(changed.body.every_hours, 12);
	assert.deepEqual(changed.body.types, ["proxy_hosts", "streams"]);
	assert.equal(changed.body.owner_user_id, created.owner_user_id);

	const paused = await admin.put(`${BASE}/${created.id}`, { enabled: false });
	assert.equal(paused.body.enabled, false);
	assert.equal(paused.body.next_run_at, null);
	const resumed = await admin.put(`${BASE}/${created.id}`, { enabled: true });
	assert.equal(resumed.body.enabled, true);
	assert.ok(Date.parse(resumed.body.next_run_at) > Date.now());
	assert.equal((await admin.put(`${BASE}/999999`, { keep: 2 })).status, 404);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "backup-schedule", object_id: created.id })
		.orderBy("id");
	assert.deepEqual(
		audit.map((entry) => entry.action),
		["created", "updated", "disabled", "enabled"],
	);
});

it("runs a schedule now: a stored file with its id, the result on the schedule, the next run unchanged", async () => {
	await admin.post("/nginx/proxy-hosts", {
		domain_names: ["scheduled.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.8.1",
		forward_port: 8080,
	});
	const created = await create({ name: "Run now", keep: 2 });
	const done = await run(created.id);
	assert.equal(done.last_status, "success");
	assert.equal(done.last_error, null);
	assert.ok(done.last_run_at);
	assert.equal(done.file_count, 1);
	assert.equal(done.next_run_at, created.next_run_at);
	assert.ok(done.last_size > 100);
	assert.match(done.last_file, new RegExp(`-s${created.id}\\.npmpro$`, "u"));

	const stored = await filesOf(created.id);
	assert.equal(stored.length, 1);
	assert.equal(stored[0].name, done.last_file);
	assert.equal(stored[0].summary.counts.proxy_hosts, 1);
	assert.equal(stored[0].encrypted, false);
	assert.equal(await fileExists(api, `data/backups/${done.last_file}`), true);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "backup-schedule", object_id: created.id, action: "backup-succeeded" });
	assert.equal(audit.length, 1);
	assert.equal((await admin.post(`${BASE}/999999/run`)).status, 404);
});

it("keeps only the newest files of the schedule, and never touches other backups", async () => {
	const manual = await admin.post("/backups", { types: ["proxy_hosts"], secrets: false, keep: true });
	assert.equal(manual.status, 200, manual.text);
	const created = await create({ name: "Retention", keep: 1 });
	const first = await run(created.id);
	const second = await run(created.id);
	assert.notEqual(first.last_file, second.last_file);
	const stored = await filesOf(created.id);
	assert.deepEqual(
		stored.map((entry) => entry.name),
		[second.last_file],
	);
	assert.equal(await fileExists(api, `data/backups/${first.last_file}`), false);
	assert.equal(await fileExists(api, `data/backups/${manual.body.entry.name}`), true);
});

it("encrypts with a passphrase that keeps its spaces, and an edit with no passphrase keeps the stored one", async () => {
	const created = await create({ name: "Secret", protection: "passphrase", passphrase: PASSPHRASE });
	assert.equal(created.protection, "passphrase");
	assert.equal(created.passphrase_set, true);
	assert.equal(JSON.stringify(created).includes("twelve"), false);
	const stored = await api.db("npmpro_backup_schedule").where({ id: created.id }).first();
	assert.equal(JSON.stringify(stored).includes("twelve"), false);

	const edited = await admin.put(`${BASE}/${created.id}`, { keep: 4 });
	assert.equal(edited.body.passphrase_set, true);
	const done = await run(created.id);
	const entry = (await filesOf(created.id))[0];
	assert.equal(entry.encrypted, true);
	assert.equal(entry.summary.secrets, true);
	// the backup opens with the passphrase exactly as entered, spaces included
	const trimmed = await admin.post(`/backups/${done.last_file}/inspect`, { passphrase: PASSPHRASE.trim() });
	assert.equal(trimmed.status, 400, trimmed.text);
	const opened = await admin.post(`/backups/${done.last_file}/inspect`, { passphrase: PASSPHRASE });
	assert.equal(opened.status, 200, opened.text);
	assert.equal(opened.body.summary.secrets, true);

	// a new passphrase replaces the stored one
	const replaced = await admin.put(`${BASE}/${created.id}`, { passphrase: "another passphrase 9" });
	assert.equal(replaced.status, 200, replaced.text);
	const again = await run(created.id);
	assert.equal(
		(await admin.post(`/backups/${again.last_file}/inspect`, { passphrase: "another passphrase 9" })).status,
		200,
	);
	assert.equal((await admin.post(`/backups/${again.last_file}/inspect`, { passphrase: PASSPHRASE })).status, 400);
});

it("refuses a missing, short or misplaced passphrase", async () => {
	const missing = await admin.post(BASE, valid({ protection: "passphrase" }));
	assert.equal(missing.status, 400);
	assert.equal(missing.body.error.message_i18n, "backup.schedule.error.passphrase-required");
	const short = await admin.post(BASE, valid({ protection: "passphrase", passphrase: "short" }));
	assert.equal(short.status, 400);
	assert.equal(short.body.error.message_i18n, "backup.schedule.error.passphrase");
	assert.equal(
		(await admin.post(BASE, valid({ passphrase: "x".repeat(1025), protection: "passphrase" }))).status,
		400,
	);
	const created = await create();
	const switched = await admin.put(`${BASE}/${created.id}`, { protection: "passphrase" });
	assert.equal(switched.status, 400, switched.text);
});

it("makes a backup with the key of this instance when the protection is the instance key", async () => {
	const created = await create({ name: "Instance key", protection: "instance_key" });
	assert.equal(created.protection, "instance_key");
	assert.equal(created.passphrase_set, false);
	const done = await run(created.id);
	const entry = (await filesOf(created.id))[0];
	assert.equal(entry.encrypted, true);
	assert.equal(entry.instance_key, true);
	assert.equal((await admin.post(`/backups/${done.last_file}/inspect`, {})).status, 200);
});

it("deletes a schedule and turns its files into plain stored backups, or deletes them with files=true", async () => {
	const keepFiles = await create({ name: "Keep its files" });
	const keptFile = (await run(keepFiles.id)).last_file;
	const done = await admin.delete(`${BASE}/${keepFiles.id}`);
	assert.equal(done.status, 200);
	assert.equal(done.body, true);
	assert.equal((await admin.get(`${BASE}/${keepFiles.id}`)).status, 404);
	// the file loses the -s<id> part of its name, so a later schedule with this id never counts or prunes it
	const keptName = keptFile.replace(/-s\d+(?=\.npmpro$)/u, "");
	assert.notEqual(keptName, keptFile);
	assert.equal(await fileExists(api, `data/backups/${keptFile}`), false);
	assert.equal(await fileExists(api, `data/backups/${keptName}`), true);
	const left = (await files()).find((entry) => entry.name === keptName);
	assert.equal(left.schedule_id, null);
	assert.equal(left.summary.types[0], "proxy_hosts");
	const detached = await api
		.db("audit_log")
		.where({ object_type: "backup-schedule", object_id: keepFiles.id, action: "deleted" })
		.first();
	assert.deepEqual(
		{ deleted: JSON.parse(detached.meta).files_deleted, detached: JSON.parse(detached.meta).files_detached },
		{ deleted: 0, detached: 1 },
	);

	const dropFiles = await create({ name: "Drop its files" });
	const droppedFile = (await run(dropFiles.id)).last_file;
	const manual = await admin.post("/backups", { types: ["proxy_hosts"], secrets: false, keep: true });
	const gone = await admin.delete(`${BASE}/${dropFiles.id}?files=true`);
	assert.equal(gone.status, 200);
	assert.equal(await fileExists(api, `data/backups/${droppedFile}`), false);
	assert.equal(await fileExists(api, `data/backups/${manual.body.entry.name}`), true);
	assert.equal((await admin.delete(`${BASE}/${dropFiles.id}`)).status, 404);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "backup-schedule", object_id: dropFiles.id, action: "deleted" });
	assert.equal(audit.length, 1);
});

it("answers a delete with 409 while a backup or restore is running", async () => {
	const host = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["busy.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.9.1",
		forward_port: 8080,
	});
	assert.equal(host.status, 201, host.text);
	const created = await create({ name: "Busy" });
	const file = (await run(created.id)).last_file;
	const opened = await admin.post(`/backups/${file}/inspect`, {});
	assert.equal(opened.status, 200, opened.text);

	// the restore stops in nginx -t until the test lets it go
	const started = `${api.root}/fake/nginx-called`;
	const release = `${api.root}/fake/nginx-release`;
	await api.outside.hookCommand(
		"nginx",
		`#!/bin/sh\ntouch "${started}"\nwhile [ ! -f "${release}" ]; do sleep 0.05; done\nexit 0\n`,
	);
	const restore = admin.post(`/backups/restore/${opened.body.token}`, { types: ["proxy_hosts"], confirm: true });
	try {
		for (let attempt = 0; attempt < 200 && !(await fileExists(api, "fake/nginx-called")); attempt += 1)
			await wait(25);
		assert.equal(await fileExists(api, "fake/nginx-called"), true, "the restore reached nginx -t");
		const busy = await admin.delete(`${BASE}/${created.id}?files=true`);
		assert.equal(busy.status, 409, busy.text);
		assert.equal(busy.body.error.message_i18n, "backup.error.busy");
		assert.equal((await admin.get(`${BASE}/${created.id}`)).status, 200);
		assert.equal(await fileExists(api, `data/backups/${file}`), true);
	} finally {
		await api.outside.hookCommand("nginx", "#!/bin/sh\nexit 0\n");
		const { writeFile } = await import("node:fs/promises");
		await writeFile(release, "");
	}
	assert.equal((await restore).status, 200);
	assert.equal((await admin.delete(`${BASE}/${created.id}?files=true`)).status, 200);
});

it("answers 401 without a session and 403 for a user who is not an administrator", async () => {
	const created = await create();
	const none = api.client();
	const user = await api.limited({
		visibility: "all",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const routes = [
		["get", BASE],
		["post", BASE, valid()],
		["get", `${BASE}/${created.id}`],
		["put", `${BASE}/${created.id}`, { keep: 9 }],
		["delete", `${BASE}/${created.id}`],
		["post", `${BASE}/${created.id}/run`],
	];
	const rows = await countRows(api, "npmpro_backup_schedule");
	for (const [method, url, body] of routes) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
		assert.equal((await user[method](url, body)).status, 403, `${method} ${url}`);
	}
	assert.equal(await countRows(api, "npmpro_backup_schedule"), rows);
	assert.equal((await admin.get(`${BASE}/${created.id}`)).body.keep, 3);
});
