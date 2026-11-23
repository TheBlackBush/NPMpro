import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { checkPageImport } from "../lib/backup/import-checks.js";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { previewReplace, replaceTypes } from "../lib/backup/restore-db.js";
import { itemLabel, linkedOf, selectRows } from "../lib/backup/select.js";
import { CATEGORIES, RESTORE_ORDER, TYPES } from "../lib/backup/types.js";
import { createSchema } from "./support/backup-schema.js";

process.env.TZ = "UTC";

const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };
const NOW = 1_800_000_000;
const STAMP = "2026-11-23 12:00:00";
const SCOPE = {
	adminUserId: 1,
	importerId: 1,
	page: false,
	canView: () => true,
	canManage: () => true,
	canEdit: () => true,
	visibleOwnerId: null,
};

const open = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await createSchema(knex);
	return knex;
};

const credential = (id, owner, name) => ({ id, owner_user_id: owner, name, values: {} });
const record = (id, credentialId, name, extra = {}) => ({
	id,
	owner_user_id: 1,
	dns_credential_id: credentialId,
	provider: "cloudflare",
	name,
	zone: "example.com",
	kind: "address",
	target: null,
	ip_version: "ipv4",
	ipv6_suffix: null,
	ttl: null,
	enabled: 1,
	state: "failed",
	last_ipv4: "81.2.69.160",
	last_ipv6: null,
	last_checked_on: STAMP,
	last_changed_on: STAMP,
	next_try_on: STAMP,
	failures: 4,
	error: "boom",
	meta: JSON.stringify({ proxied: true, error_i18n: "error.ddns-multi-value", error_values: { name: name } }),
	secret: null,
	created_on: STAMP,
	modified_on: STAMP,
	...extra,
});
const ddnsData = (records) => ({ ddns: { npmpro_ddns_record: records } });
const bothData = (credentials, records) => ({
	dns_credentials: { npmpro_dns_credential: credentials, npmpro_dns_domain: [] },
	...ddnsData(records),
});

const merge = async (knex, { data, types = ["ddns"], choices, items, scope = SCOPE }) => {
	const instance = { ...(await readInstanceRows(knex)), files: {} };
	const plan = planMerge({ data, instance, stageFiles: {}, types, items, choices, scope, secrets: true });
	const result = await mergeTypes({
		knex,
		data,
		plan,
		adminUserId: 1,
		importerId: 1,
		page: scope.page,
		box,
		secrets: true,
		now: NOW,
	});
	return { plan, result };
};

const seedCredential = (knex, id = 1, name = "Cloudflare") =>
	knex("npmpro_dns_credential").insert({ id, owner_user_id: 1, name, values: "v1:{}" });

it("the ddns type has its own category after DNS credentials, restores after them and holds no history", () => {
	const ids = CATEGORIES.map((category) => category.id);
	assert.equal(ids[ids.indexOf("dns_credentials") + 1], "ddns");
	assert.deepEqual(CATEGORIES.find((category) => category.id === "ddns").types, ["ddns"]);
	assert.ok(RESTORE_ORDER.indexOf("ddns") > RESTORE_ORDER.indexOf("dns_credentials"));
	assert.ok(RESTORE_ORDER.indexOf("ddns") > RESTORE_ORDER.indexOf("users"));
	assert.deepEqual(
		TYPES.ddns.tables.map(({ table }) => table),
		["npmpro_ddns_record"],
	);
});

it("select labels a record by its name and a page export brings its credential along", () => {
	const rows = { npmpro_ddns_record: [record(1, 5, "a.example.com"), record(2, 6, "b.example.com")] };
	assert.equal(itemLabel("ddns", rows.npmpro_ddns_record[0]), "a.example.com");
	assert.deepEqual(
		selectRows("ddns", rows, ["2"]).npmpro_ddns_record.map((row) => row.id),
		[2],
	);
	const linked = linkedOf({ ddns: rows });
	assert.deepEqual([...linked.dns_credentials.get("5")], ["ddns:1"]);
	assert.deepEqual([...linked.dns_credentials.get("6")], ["ddns:2"]);
});

it("restored records start over: pending, no failures, no retry time, no error, and keep what the provider showed", () => {
	const [on, off] = TYPES.ddns.restoreRows({
		npmpro_ddns_record: [record(1, 1, "a.example.com"), record(2, 1, "b.example.com", { enabled: 0 })],
	}).npmpro_ddns_record;
	assert.equal(on.state, "pending");
	assert.equal(off.state, "disabled");
	for (const row of [on, off]) {
		assert.equal(row.failures, 0);
		assert.equal(row.next_try_on, null);
		assert.equal(row.error, null);
		assert.equal(row.last_ipv4, "81.2.69.160");
		assert.deepEqual(JSON.parse(row.meta), { proxied: true });
	}
	assert.equal(
		TYPES.ddns.restoreRows({ npmpro_ddns_record: [record(3, 1, "c", { meta: null })] }).npmpro_ddns_record[0].meta,
		null,
	);
});

it("a replace restore writes the records with their state reset and leaves no history", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		await knex("npmpro_ddns_record").insert(record(9, 1, "old.example.com"));
		await knex("npmpro_ddns_history").insert({ ddns_record_id: 9, created_on: STAMP, kind: "changed" });
		const data = ddnsData([record(1, 1, "a.example.com")]);
		const result = await replaceTypes({ knex, data, types: ["ddns"], adminUserId: 1, box, now: NOW });
		assert.equal(result.counts.ddns, 1);
		const rows = await knex("npmpro_ddns_record");
		assert.deepEqual(
			rows.map((row) => [row.id, row.name, row.state, row.failures, row.error]),
			[[1, "a.example.com", "pending", 0, null]],
		);
		assert.equal((await knex("npmpro_ddns_history")).length, 0);
	} finally {
		await knex.destroy();
	}
});

it("a replace restore drops a record whose credential is not here, with a note, in the preview and the restore", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		const data = ddnsData([record(1, 1, "a.example.com"), record(2, 9, "orphan.example.com")]);
		const preview = await previewReplace({ knex, data, types: ["ddns"], adminUserId: 1 });
		const result = await replaceTypes({ knex, data, types: ["ddns"], adminUserId: 1, box, now: NOW });
		const note = "DDNS record orphan.example.com: DNS credential #9 not found";
		assert.deepEqual(
			preview.references.map((change) => change.label),
			[note],
		);
		assert.deepEqual(
			result.references.map((change) => change.label),
			[note],
		);
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("name"), ["a.example.com"]);
	} finally {
		await knex.destroy();
	}
});

it("a replace of credentials and records together restores both", async () => {
	const knex = await open();
	try {
		await seedCredential(knex, 1, "Old");
		await knex("npmpro_ddns_record").insert(record(9, 1, "old.example.com"));
		const data = bothData([credential(4, 1, "New")], [record(1, 4, "a.example.com")]);
		await replaceTypes({ knex, data, types: ["dns_credentials", "ddns"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(
			(await knex("npmpro_ddns_record")).map((row) => [row.name, row.dns_credential_id]),
			[["a.example.com", 4]],
		);
	} finally {
		await knex.destroy();
	}
});

it("a replace of credentials alone keeps the records of credentials the backup holds and removes the others", async () => {
	const knex = await open();
	try {
		await seedCredential(knex, 1, "Kept");
		await seedCredential(knex, 2, "Gone");
		await knex("npmpro_ddns_record").insert([
			record(1, 1, "kept.example.com"),
			record(2, 2, "gone.example.com"),
			record(3, null, "none.example.com"),
		]);
		await knex("npmpro_ddns_history").insert([
			{ ddns_record_id: 1, created_on: STAMP, kind: "changed" },
			{ ddns_record_id: 2, created_on: STAMP, kind: "changed" },
		]);
		const data = { dns_credentials: { npmpro_dns_credential: [credential(1, 1, "Kept")], npmpro_dns_domain: [] } };
		const preview = await previewReplace({ knex, data, types: ["dns_credentials"], adminUserId: 1 });
		const result = await replaceTypes({ knex, data, types: ["dns_credentials"], adminUserId: 1, box, now: NOW });
		const note = "DDNS record gone.example.com: DNS credential #2 not found";
		assert.deepEqual(
			preview.references.map((change) => change.label),
			[note],
		);
		assert.deepEqual(
			result.references.map((change) => change.label),
			[note],
		);
		assert.deepEqual(
			(await knex("npmpro_ddns_record").orderBy("id")).map((row) => [row.name, row.dns_credential_id]),
			[
				["kept.example.com", 1],
				["none.example.com", null],
			],
		);
		assert.deepEqual(await knex("npmpro_ddns_history").pluck("ddns_record_id"), [1]);
	} finally {
		await knex.destroy();
	}
});

it("a record of an owner the backup does not hold goes to the restoring admin", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		const data = ddnsData([record(1, 1, "a.example.com", { owner_user_id: 77 })]);
		await replaceTypes({ knex, data, types: ["ddns"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("owner_user_id"), [1]);
	} finally {
		await knex.destroy();
	}
});

it("a merge adds a record onto the credential the plan matches, reset, and skips a name that exists", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		await knex("npmpro_ddns_record").insert(record(1, 1, "taken.example.com", { state: "ok", failures: 0 }));
		const data = bothData(
			[credential(3, 1, "Cloudflare")],
			[record(5, 3, "new.example.com"), record(6, 3, "taken.example.com")],
		);
		const { plan, result } = await merge(knex, {
			data,
			types: ["dns_credentials", "ddns"],
			choices: { "dns_credentials:3": "existing" },
		});
		assert.equal(plan.items.find((item) => item.key === "ddns:6").action, "skip");
		assert.equal(result.counts.ddns, 1);
		const added = await knex("npmpro_ddns_record").where({ name: "new.example.com" }).first();
		assert.equal(added.dns_credential_id, 1);
		assert.equal(added.state, "pending");
		assert.equal(added.failures, 0);
		assert.equal(added.error, null);
		assert.notEqual(added.id, 5);
		const kept = await knex("npmpro_ddns_record").where({ name: "taken.example.com" }).first();
		assert.equal(kept.state, "ok");
	} finally {
		await knex.destroy();
	}
});

it("a merge replaces a record of the same name, keeping its id and owner", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		await knex("npmpro_ddns_record").insert(record(4, 1, "a.example.com", { owner_user_id: 8, ttl: 300 }));
		const data = bothData([credential(3, 1, "Cloudflare")], [record(5, 3, "a.example.com", { ttl: 600 })]);
		await merge(knex, {
			data,
			types: ["dns_credentials", "ddns"],
			choices: { "dns_credentials:3": "existing", "ddns:5": "replace" },
		});
		const rows = await knex("npmpro_ddns_record");
		assert.equal(rows.length, 1);
		assert.deepEqual([rows[0].id, rows[0].owner_user_id, rows[0].ttl, rows[0].state], [4, 8, 600, "pending"]);
	} finally {
		await knex.destroy();
	}
});

it("a merge skips a record whose credential is neither in the backup nor matched, with the reason in the plan", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		const data = ddnsData([record(5, 1, "a.example.com"), record(6, null, "b.example.com")]);
		const { plan } = await merge(knex, { data });
		const byKey = Object.fromEntries(plan.items.map((item) => [item.key, item]));
		assert.equal(byKey["ddns:5"].action, "skip");
		assert.equal(byKey["ddns:5"].reason, "credential-missing");
		assert.equal(byKey["ddns:6"].action, "add");
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("name"), ["b.example.com"]);
	} finally {
		await knex.destroy();
	}
});

it("a merge brings the credential a record needs when the credential is in the backup", async () => {
	const knex = await open();
	try {
		const data = bothData([credential(3, 1, "Imported")], [record(5, 3, "a.example.com")]);
		const { plan, result } = await merge(knex, {
			data,
			types: ["dns_credentials", "ddns"],
			items: { ddns: [5], dns_credentials: [] },
		});
		const credentialItem = plan.items.find((item) => item.key === "dns_credentials:3");
		assert.equal(credentialItem.action, "add");
		assert.equal(credentialItem.linked, true);
		const added = result.maps.npmpro_dns_credential.get("3");
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("dns_credential_id"), [added]);
	} finally {
		await knex.destroy();
	}
});

it("the import check refuses a record with a name or a target in the wrong form", async () => {
	const knex = await open();
	try {
		const items = [{ key: "ddns:1", type: "ddns", id: 1, label: "a", action: "add", target: null }];
		const check = (row) => checkPageImport({ knex, plan: { items }, data: ddnsData([row]) });
		await check(record(1, 1, "a.example.com"));
		await check(record(1, 1, "*.example.com"));
		await check(record(1, 1, "alias.example.com", { kind: "alias", target: "target.example.net" }));
		for (const [bad, field] of [
			[record(1, 1, "Example.COM"), "name"],
			[record(1, 1, "a.example.com", { kind: "alias", target: null }), "target"],
			[record(1, 1, "a.example.com", { kind: "alias", target: "a.example.com" }), "target"],
			[record(1, 1, "a.example.com", { target: "b.example.com" }), "target"],
			[record(1, 1, "a.example.com", { kind: "other" }), "kind"],
		]) {
			await assert.rejects(
				check(bad),
				(error) => error.code === "invalid-item" && error.message.includes(`its ${field}`),
				field,
			);
		}
	} finally {
		await knex.destroy();
	}
});
