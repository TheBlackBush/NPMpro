import assert from "node:assert/strict";
import { after, it } from "node:test";
import knexFactory from "knex";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { replaceTypes } from "../lib/backup/restore-db.js";
import { TYPES } from "../lib/backup/types.js";
import { createSchema } from "./support/backup-schema.js";

process.env.TZ = "UTC";
const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };
const type = TYPES.backup_schedules;
const NOW = Date.parse("2026-10-28T12:00:00Z");

const stored = (extra = {}) => ({
	id: 3,
	created_on: "2026-10-01T00:00:00.000Z",
	modified_on: "2026-10-01T00:00:00.000Z",
	owner_user_id: 9,
	name: "Nightly",
	enabled: 1,
	frequency: "daily",
	every_hours: null,
	time: "03:00",
	weekday: null,
	month_day: null,
	types: ["proxy_hosts"],
	protection: "passphrase",
	passphrase: box.encrypt({ passphrase: "twelve chars!" }),
	keep: 5,
	next_run_at: "2026-10-29T03:00:00.000Z",
	last_run_at: "2026-10-28T03:00:00.000Z",
	last_status: "failed",
	last_error: "disk full",
	last_file: null,
	last_size: null,
	last_duration_ms: 10,
	...extra,
});

const opened = [];
after(async () => {
	for (const knex of opened) await knex.destroy();
});

const db = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	opened.push(knex);
	await createSchema(knex);
	return knex;
};

it("export leaves out the owner and run state and opens the passphrase; strip drops it", () => {
	const exported = type.secrets.export({ npmpro_backup_schedule: [stored()] }, box).npmpro_backup_schedule[0];
	assert.equal(exported.passphrase, "twelve chars!");
	for (const column of [
		"owner_user_id",
		"next_run_at",
		"last_run_at",
		"last_status",
		"last_error",
		"last_file",
		"last_size",
		"last_duration_ms",
	]) {
		assert.equal(Object.hasOwn(exported, column), false, column);
	}
	const stripped = type.secrets.strip({ npmpro_backup_schedule: [stored()] }).npmpro_backup_schedule[0];
	assert.equal(stripped.passphrase, null);
	assert.equal(Object.hasOwn(stripped, "last_status"), false);
});

it("restore rows: new owner, recomputed next run, unknown types dropped, paused without passphrase or types", () => {
	const rows = type.restoreRows(
		{
			npmpro_backup_schedule: [
				{ ...stored(), types: ["proxy_hosts", "future_type"] },
				{ ...stored({ id: 4, name: "No pass" }), passphrase: null },
				{
					...stored({ id: 5, name: "Gone types", protection: "none", passphrase: null }),
					types: ["future_type"],
				},
			],
		},
		{ adminUserId: 1, nowMs: NOW },
	).npmpro_backup_schedule;
	assert.deepEqual(rows[0].types, ["proxy_hosts"]);
	assert.equal(rows[0].owner_user_id, 1);
	assert.equal(rows[0].next_run_at, "2026-10-29T03:00:00.000Z");
	assert.equal(rows[0].last_status, null);
	assert.equal(rows[1].enabled, false);
	assert.equal(rows[1].next_run_at, null);
	assert.equal(rows[2].enabled, false);
});

it("replace restore round trip with and without secrets", async () => {
	const knex = await db();
	const withSecrets = type.secrets.export({ npmpro_backup_schedule: [stored()] }, box);
	await replaceTypes({
		knex,
		data: { backup_schedules: withSecrets },
		types: ["backup_schedules"],
		adminUserId: 1,
		box,
		now: NOW / 1000,
	});
	let [row] = await knex("npmpro_backup_schedule");
	assert.equal(box.decrypt(row.passphrase).passphrase, "twelve chars!");
	assert.equal(Number(row.owner_user_id), 1);
	assert.equal(Boolean(Number(row.enabled)), true);
	assert.equal(row.last_status, null);
	const without = type.secrets.strip({ npmpro_backup_schedule: [stored()] });
	await replaceTypes({
		knex,
		data: { backup_schedules: without },
		types: ["backup_schedules"],
		adminUserId: 1,
		box,
		now: NOW / 1000,
	});
	[row] = await knex("npmpro_backup_schedule");
	assert.equal(row.passphrase, null);
	assert.equal(Boolean(Number(row.enabled)), false);
	assert.equal(row.next_run_at, null);
});

it("merge compares by name: new, identical, or differs with keep or take", async () => {
	const knex = await db();
	const instanceRow = {
		...stored({ id: 7, owner_user_id: 1 }),
		types: JSON.stringify(["proxy_hosts"]),
		created_on: "2026-10-01 00:00:00",
		modified_on: "2026-10-01 00:00:00",
		next_run_at: null,
		last_run_at: null,
	};
	await knex("npmpro_backup_schedule").insert(instanceRow);
	const exported = type.secrets.export(
		{
			npmpro_backup_schedule: [
				stored(),
				stored({ id: 4, name: "Weekly", frequency: "weekly", weekday: 0 }),
				stored({ id: 5, name: "nightly copy" }),
			],
		},
		box,
	);
	exported.npmpro_backup_schedule[0].keep = 9; // differs from the instance's Nightly
	const data = { backup_schedules: exported };
	const scope = {
		adminUserId: 1,
		importerId: 1,
		page: false,
		canView: () => true,
		canManage: () => true,
		canEdit: () => true,
		visibleOwnerId: null,
	};
	const plan = planMerge({
		data,
		instance: await readInstanceRows(knex),
		stageFiles: {},
		types: ["backup_schedules"],
		scope,
		secrets: true,
		choices: { "schedule:3": "take" },
	});
	const byKey = Object.fromEntries(plan.items.map((item) => [item.key, item]));
	assert.equal(byKey["schedule:3"].action, "take");
	assert.deepEqual(byKey["schedule:3"].target, { type: "backup_schedules", id: 7, label: "Nightly" });
	assert.equal(byKey["schedule:4"].action, "add");
	assert.equal(byKey["schedule:5"].action, "add");
	await mergeTypes({ knex, data, plan, adminUserId: 1, importerId: 1, box, secrets: true });
	const rows = await knex("npmpro_backup_schedule").orderBy("id");
	assert.equal(rows.length, 3);
	assert.equal(Number(rows.find((row) => Number(row.id) === 7).keep), 9);
	// identical now: nothing listed
	const again = planMerge({
		data,
		instance: await readInstanceRows(knex),
		stageFiles: {},
		types: ["backup_schedules"],
		scope,
		secrets: true,
	});
	assert.equal(again.items.length, 0);
});

const scope = {
	adminUserId: 1,
	importerId: 1,
	page: false,
	canView: () => true,
	canManage: () => true,
	canEdit: () => true,
	visibleOwnerId: null,
};

it("a schedule that backs up the schedules keeps that type", () => {
	const [row] = type.restoreRows(
		{ npmpro_backup_schedule: [{ ...stored(), types: ["backup_schedules", "users"] }] },
		{ adminUserId: 1, nowMs: NOW },
	).npmpro_backup_schedule;
	assert.deepEqual(row.types, ["backup_schedules", "users"]);
	assert.equal(row.enabled, true);
});

it("seal seals a plain passphrase and leaves a sealed one", () => {
	const sealed = box.encrypt({ passphrase: "already sealed" });
	const rows = type.secrets.seal(
		{
			npmpro_backup_schedule: [
				{ id: 1, passphrase: "twelve chars!" },
				{ id: 2, passphrase: sealed },
				{ id: 3, passphrase: null },
			],
		},
		box,
	).npmpro_backup_schedule;
	assert.equal(box.decrypt(rows[0].passphrase).passphrase, "twelve chars!");
	assert.equal(rows[1].passphrase, sealed);
	assert.equal(rows[2].passphrase, null);
});

it("replace restore replaces every schedule", async () => {
	const knex = await db();
	await knex("npmpro_backup_schedule").insert({
		...stored({ id: 1, owner_user_id: 1, name: "Old" }),
		types: JSON.stringify(["users"]),
		created_on: "2026-10-01 00:00:00",
		modified_on: "2026-10-01 00:00:00",
		next_run_at: null,
		last_run_at: null,
	});
	const data = {
		backup_schedules: type.secrets.export(
			{ npmpro_backup_schedule: [stored(), stored({ id: 8, name: "Other" })] },
			box,
		),
	};
	const result = await replaceTypes({
		knex,
		data,
		types: ["backup_schedules"],
		adminUserId: 1,
		box,
		now: NOW / 1000,
	});
	assert.equal(result.counts.backup_schedules, 2);
	const rows = await knex("npmpro_backup_schedule").orderBy("id");
	assert.deepEqual(
		rows.map((row) => [Number(row.id), row.name]),
		[
			[3, "Nightly"],
			[8, "Other"],
		],
	);
});

it("merge without secrets: a taken schedule keeps the instance passphrase, added ones are paused and listed", async () => {
	const knex = await db();
	const instancePassphrase = box.encrypt({ passphrase: "instance pass" });
	await knex("npmpro_backup_schedule").insert([
		{
			...stored({ id: 3, owner_user_id: 1, name: "Other name", passphrase: null, protection: "none" }),
			types: JSON.stringify(["users"]),
			created_on: "2026-10-01 00:00:00",
			modified_on: "2026-10-01 00:00:00",
			next_run_at: null,
			last_run_at: null,
		},
		{
			...stored({ id: 7, owner_user_id: 1, passphrase: instancePassphrase }),
			types: JSON.stringify(["proxy_hosts"]),
			created_on: "2026-10-01 00:00:00",
			modified_on: "2026-10-01 00:00:00",
			next_run_at: null,
			last_run_at: null,
		},
	]);
	const stripped = type.secrets.strip({
		npmpro_backup_schedule: [
			stored({ name: "NIGHTLY", keep: 9 }),
			stored({ id: 4, name: "Weekly", frequency: "weekly", weekday: 0 }),
		],
	});
	const data = { backup_schedules: stripped };
	const choices = { "schedule:3": "take" };
	const plan = planMerge({
		data,
		instance: await readInstanceRows(knex),
		stageFiles: {},
		types: ["backup_schedules"],
		scope,
		secrets: false,
		choices,
	});
	assert.deepEqual(plan.needs_secrets, ["schedule:3", "schedule:4"]);
	const kept = planMerge({
		data,
		instance: await readInstanceRows(knex),
		stageFiles: {},
		types: ["backup_schedules"],
		scope,
		secrets: false,
	});
	assert.equal(kept.items.find((item) => item.key === "schedule:3").action, "keep");
	assert.deepEqual(kept.needs_secrets, ["schedule:4"]);
	await mergeTypes({ knex, data, plan, adminUserId: 1, importerId: 1, box, secrets: false, now: NOW / 1000 });
	const rows = await knex("npmpro_backup_schedule").orderBy("id");
	assert.equal(rows.length, 3);
	const taken = rows.find((row) => Number(row.id) === 7);
	assert.equal(taken.name, "NIGHTLY");
	assert.equal(Number(taken.keep), 9);
	assert.equal(taken.passphrase, instancePassphrase);
	assert.equal(Boolean(Number(taken.enabled)), true);
	assert.notEqual(taken.next_run_at, null);
	// the backup's id 3 is the instance's "Other name": the added row gets a new id
	const added = rows.find((row) => row.name === "Weekly");
	assert.equal([3, 7].includes(Number(added.id)), false);
	assert.equal(added.passphrase, null);
	assert.equal(Boolean(Number(added.enabled)), false);
	assert.equal(added.next_run_at, null);
	assert.equal((await knex("npmpro_backup_schedule").where({ id: 3 }).first()).name, "Other name");
});

it("page imports never plan schedules", async () => {
	const knex = await db();
	const data = { backup_schedules: type.secrets.export({ npmpro_backup_schedule: [stored()] }, box) };
	const plan = planMerge({
		data,
		instance: await readInstanceRows(knex),
		stageFiles: {},
		types: ["backup_schedules"],
		scope: { ...scope, page: true },
		secrets: true,
	});
	assert.equal(plan.items.length, 0);
});

it("merge without secrets: a taken schedule that moved away from a passphrase drops the instance passphrase", async () => {
	const knex = await db();
	await knex("npmpro_backup_schedule").insert({
		...stored({ id: 7, owner_user_id: 1, passphrase: box.encrypt({ passphrase: "instance pass" }) }),
		types: JSON.stringify(["proxy_hosts"]),
		created_on: "2026-10-01 00:00:00",
		modified_on: "2026-10-01 00:00:00",
		next_run_at: null,
		last_run_at: null,
	});
	const data = {
		backup_schedules: type.secrets.strip({
			npmpro_backup_schedule: [stored({ name: "Nightly", protection: "instance_key", keep: 4 })],
		}),
	};
	const plan = planMerge({
		data,
		instance: await readInstanceRows(knex),
		stageFiles: {},
		types: ["backup_schedules"],
		scope,
		secrets: false,
		choices: { "schedule:3": "take" },
	});
	assert.deepEqual(plan.needs_secrets, []);
	await mergeTypes({ knex, data, plan, adminUserId: 1, importerId: 1, box, secrets: false, now: NOW / 1000 });
	const taken = await knex("npmpro_backup_schedule").where({ id: 7 }).first();
	assert.equal(taken.protection, "instance_key");
	assert.equal(taken.passphrase, null);
	assert.equal(Boolean(Number(taken.enabled)), true);
});
