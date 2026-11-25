import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import knexFactory from "knex";
import { exportStage } from "../lib/backup/export.js";
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

const credential = (id, owner, name, provider = "cloudflare") => ({
	id,
	owner_user_id: owner,
	name,
	provider,
	values: {},
});
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

const merge = async (knex, { data, types = ["ddns"], choices, items, scope = SCOPE, secrets = true }) => {
	const instance = { ...(await readInstanceRows(knex)), files: {} };
	const plan = planMerge({ data, instance, stageFiles: {}, types, items, choices, scope, secrets });
	const result = await mergeTypes({
		knex,
		data,
		plan,
		adminUserId: 1,
		importerId: 1,
		page: scope.page,
		box,
		secrets,
		now: NOW,
	});
	return { plan, result };
};

const seedCredential = (knex, id = 1, name = "Cloudflare", extra = {}) =>
	knex("npmpro_dns_credential").insert({
		id,
		owner_user_id: 1,
		name,
		provider: "cloudflare",
		values: "v1:{}",
		...extra,
	});

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

it("a replace restore of the records gives each its credential's owner", async () => {
	const knex = await open();
	try {
		await knex("user").insert({ id: 5, email: "five@example.com", name: "Five", roles: "[]" });
		await seedCredential(knex, 1, "Five's", { owner_user_id: 5 });
		const data = ddnsData([record(1, 1, "a.example.com", { owner_user_id: 1 })]);
		await replaceTypes({ knex, data, types: ["ddns"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("owner_user_id"), [5]);
	} finally {
		await knex.destroy();
	}
});

it("a replace restore of an unrelated type keeps a record whose owner is not its credential's owner", async () => {
	const knex = await open();
	try {
		await knex("user").insert({ id: 2, email: "two@example.com", name: "Two", roles: "[]" });
		await seedCredential(knex, 1, "Two's", { owner_user_id: 2 });
		// saved by an administrator before a record took its credential's owner
		await knex("npmpro_ddns_record").insert(record(1, 1, "kept.example.com", { owner_user_id: 1 }));
		const data = { access_lists: { access_list: [], access_list_auth: [], access_list_client: [] } };
		const result = await replaceTypes({ knex, data, types: ["access_lists"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(
			result.references.filter((change) => change.table === "npmpro_ddns_record"),
			[],
		);
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("name"), ["kept.example.com"]);
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
		await seedCredential(knex, 1, "Cloudflare", { owner_user_id: 8 });
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

it("a replace of credentials alone removes a record whose credential changed provider, and moves one to a new owner", async () => {
	const knex = await open();
	try {
		await seedCredential(knex, 1, "Same");
		await seedCredential(knex, 2, "Provider");
		await seedCredential(knex, 3, "Owner");
		await knex("npmpro_ddns_record").insert([
			record(1, 1, "same.example.com"),
			record(2, 2, "provider.example.com"),
			record(3, 3, "owner.example.com"),
		]);
		const data = {
			dns_credentials: {
				npmpro_dns_credential: [
					credential(1, 1, "Same"),
					credential(2, 1, "Provider", "hetzner-cloud"),
					credential(3, 5, "Owner"),
				],
				npmpro_dns_domain: [],
			},
		};
		await knex("user").insert({ id: 5, email: "five@example.com", name: "Five", roles: "[]" });
		const notes = ["DDNS record provider.example.com: DNS credential #2 is of another provider"];
		const preview = await previewReplace({ knex, data, types: ["dns_credentials"], adminUserId: 1 });
		const result = await replaceTypes({ knex, data, types: ["dns_credentials"], adminUserId: 1, box, now: NOW });
		for (const references of [preview.references, result.references]) {
			assert.deepEqual(
				references.filter((change) => change.remove).map((change) => change.label),
				notes,
			);
		}
		assert.deepEqual(
			(await knex("npmpro_ddns_record").orderBy("id")).map((row) => [row.name, row.owner_user_id]),
			[
				["same.example.com", 1],
				["owner.example.com", 5],
			],
		);
	} finally {
		await knex.destroy();
	}
});

it("a full replace drops a record whose credential in the backup is of another provider", async () => {
	const knex = await open();
	try {
		const data = bothData(
			[credential(4, 1, "New", "hetzner-cloud")],
			[record(1, 4, "a.example.com"), record(2, 4, "b.example.com", { provider: "hetzner-cloud" })],
		);
		const result = await replaceTypes({
			knex,
			data,
			types: ["dns_credentials", "ddns"],
			adminUserId: 1,
			box,
			now: NOW,
		});
		assert.deepEqual(
			result.references.map((change) => change.label),
			["DDNS record a.example.com: DNS credential #4 is of another provider"],
		);
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("name"), ["b.example.com"]);
	} finally {
		await knex.destroy();
	}
});

it("an alias record survives a replace restore and a merge with its kind and target", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		const alias = record(1, 1, "www.example.com", { kind: "alias", target: "target.example.net" });
		await replaceTypes({ knex, data: ddnsData([alias]), types: ["ddns"], adminUserId: 1, box, now: NOW });
		const [restored] = await knex("npmpro_ddns_record");
		assert.deepEqual([restored.kind, restored.target, restored.state], ["alias", "target.example.net", "pending"]);
		await knex("npmpro_ddns_record").del();
		const data = bothData([credential(3, 1, "Cloudflare")], [{ ...alias, dns_credential_id: 3 }]);
		await merge(knex, { data, types: ["dns_credentials", "ddns"], choices: { "dns_credentials:3": "existing" } });
		const [merged] = await knex("npmpro_ddns_record");
		assert.deepEqual([merged.kind, merged.target, merged.dns_credential_id], ["alias", "target.example.net", 1]);
	} finally {
		await knex.destroy();
	}
});

it("a merge that adds the credential under a renamed name still joins the record to it", async () => {
	const knex = await open();
	try {
		await seedCredential(knex, 1, "Cloudflare");
		const data = bothData([credential(3, 1, "Cloudflare")], [record(5, 3, "a.example.com")]);
		const { result } = await merge(knex, {
			data,
			types: ["dns_credentials", "ddns"],
			choices: { "dns_credentials:3": "add" },
		});
		const added = result.maps.npmpro_dns_credential.get("3");
		assert.notEqual(added, 1);
		assert.equal((await knex("npmpro_dns_credential").where({ id: added }).first()).name, "Cloudflare (2)");
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("dns_credential_id"), [added]);
	} finally {
		await knex.destroy();
	}
});

it("a merge skips a record whose matched credential is of another provider, and gives the others its owner", async () => {
	const knex = await open();
	try {
		await seedCredential(knex, 1, "Cloudflare", { provider: "hetzner-cloud" });
		await seedCredential(knex, 2, "Other owner", { owner_user_id: 7 });
		const data = bothData(
			[credential(3, 1, "Cloudflare"), credential(4, 1, "Other owner")],
			[record(5, 3, "a.example.com"), record(6, 4, "b.example.com")],
		);
		const { result } = await merge(knex, {
			data,
			types: ["dns_credentials", "ddns"],
			choices: { "dns_credentials:3": "existing", "dns_credentials:4": "existing" },
		});
		assert.deepEqual(result.skipped_records, [
			{ name: "a.example.com", why: "its DNS credential is of another provider" },
		]);
		assert.deepEqual(
			(await knex("npmpro_ddns_record")).map((row) => [row.name, row.dns_credential_id, row.owner_user_id]),
			[["b.example.com", 2, 7]],
		);
	} finally {
		await knex.destroy();
	}
});

const PROVIDER_REFUSED = /provider/u;
const customRecord = (id, name, extra = {}) =>
	record(id, null, name, {
		provider: "custom",
		zone: "",
		secret: box.encrypt({ url: "https://dyn.test/u/TOKEN-9876", method: "POST", expect: "good" }),
		...extra,
	});

it("a backup with secrets carries the custom URL in the archive rows, a backup without them none, and a restore seals it again", () => {
	const rows = { npmpro_ddns_record: [customRecord(1, "c.example.com"), record(2, 1, "a.example.com")] };
	const opened = TYPES.ddns.secrets.export(rows, box).npmpro_ddns_record;
	assert.deepEqual(opened[0].secret, { url: "https://dyn.test/u/TOKEN-9876", method: "POST", expect: "good" });
	assert.equal(opened[1].secret, null);
	const stripped = TYPES.ddns.secrets.strip(rows).npmpro_ddns_record;
	assert.deepEqual(
		stripped.map((row) => row.secret),
		[null, null],
	);
	assert.ok(!JSON.stringify(stripped).includes("TOKEN-9876"));
	const sealed = TYPES.ddns.secrets.seal({ npmpro_ddns_record: opened }, box).npmpro_ddns_record;
	assert.equal(typeof sealed[0].secret, "string");
	assert.ok(sealed[0].secret.startsWith("v1:"));
	assert.deepEqual(box.decrypt(sealed[0].secret), opened[0].secret);
	assert.equal(sealed[1].secret, null);
});

it("a record stopped after a provider refusal is restored as pending, without the stop and the note", () => {
	const [row] = TYPES.ddns.restoreRows({
		npmpro_ddns_record: [
			record(1, 1, "s.example.com", {
				meta: JSON.stringify({
					proxied: true,
					stopped: true,
					note_i18n: "ddns.note.resolver-old",
					error_i18n: "x",
				}),
			}),
		],
	}).npmpro_ddns_record;
	const meta = JSON.parse(row.meta);
	assert.equal(row.state, "pending");
	assert.equal(meta.stopped, undefined);
	assert.equal(meta.note_i18n, undefined);
	assert.equal(meta.error_i18n, undefined);
	assert.equal(meta.proxied, true);
});

it("a custom record restored without its URL comes back disabled and asks for the URL again, one with it keeps running", () => {
	const [without, withUrl, other] = TYPES.ddns.restoreRows({
		npmpro_ddns_record: [
			customRecord(1, "a.example.com", { secret: null }),
			customRecord(2, "b.example.com"),
			record(3, 1, "c.example.com"),
		],
	}).npmpro_ddns_record;
	assert.equal(Number(without.enabled), 0);
	assert.equal(without.state, "disabled");
	assert.equal(JSON.parse(without.meta).error_i18n, "error.ddns-custom-url-missing");
	assert.equal(JSON.parse(without.meta).proxied, true);
	assert.equal(Number(withUrl.enabled), 1);
	assert.equal(withUrl.state, "pending");
	assert.equal(JSON.parse(withUrl.meta).error_i18n, undefined);
	assert.equal(other.state, "pending");
});

it("a replace restore of a stripped backup brings a custom record back disabled, one with secrets keeps its sealed URL", async () => {
	const knex = await open();
	try {
		const stripped = TYPES.ddns.secrets.strip(ddnsData([customRecord(1, "a.example.com")]).ddns);
		const result = await replaceTypes({
			knex,
			data: { ddns: stripped },
			types: ["ddns"],
			adminUserId: 1,
			box,
			now: NOW,
		});
		assert.equal(result.counts.ddns, 1);
		const [row] = await knex("npmpro_ddns_record");
		assert.equal(row.secret, null);
		assert.equal(Number(row.enabled), 0);
		assert.equal(row.state, "disabled");
		assert.equal(JSON.parse(row.meta).error_i18n, "error.ddns-custom-url-missing");

		const full = TYPES.ddns.secrets.export(ddnsData([customRecord(1, "a.example.com")]).ddns, box);
		await replaceTypes({ knex, data: { ddns: full }, types: ["ddns"], adminUserId: 1, box, now: NOW });
		const [kept] = await knex("npmpro_ddns_record");
		assert.deepEqual(box.decrypt(kept.secret), {
			url: "https://dyn.test/u/TOKEN-9876",
			method: "POST",
			expect: "good",
		});
		assert.equal(Number(kept.enabled), 1);
	} finally {
		await knex.destroy();
	}
});

it("a merge seals the custom URL of an archive with secrets, and a page import of a custom record by a user is refused", async () => {
	const knex = await open();
	try {
		const full = TYPES.ddns.secrets.export(ddnsData([customRecord(1, "a.example.com")]).ddns, box);
		const { plan } = await merge(knex, { data: { ddns: full } });
		const [row] = await knex("npmpro_ddns_record");
		assert.deepEqual(box.decrypt(row.secret), {
			url: "https://dyn.test/u/TOKEN-9876",
			method: "POST",
			expect: "good",
		});
		await assert.rejects(
			checkPageImport({ knex, plan: { items: plan.items }, data: { ddns: full } }),
			PROVIDER_REFUSED,
		);
	} finally {
		await knex.destroy();
	}
});

const presetRecord = (id, name, extra = {}) =>
	record(id, null, name, {
		provider: "noip",
		zone: "",
		secret: box.encrypt({ username: "me@example.com", password: "PRESET-pass-4321" }),
		...extra,
	});

it("a backup with secrets carries a preset's details, a backup without them none, and a restore seals them again", () => {
	const rows = { npmpro_ddns_record: [presetRecord(1, "p.example.com")] };
	const opened = TYPES.ddns.secrets.export(rows, box).npmpro_ddns_record;
	assert.deepEqual(opened[0].secret, { username: "me@example.com", password: "PRESET-pass-4321" });
	const stripped = TYPES.ddns.secrets.strip(rows).npmpro_ddns_record;
	assert.equal(stripped[0].secret, null);
	assert.ok(!JSON.stringify(stripped).includes("PRESET-pass-4321"));
	const sealed = TYPES.ddns.secrets.seal({ npmpro_ddns_record: opened }, box).npmpro_ddns_record;
	assert.deepEqual(box.decrypt(sealed[0].secret), opened[0].secret);
});

it("a preset record restored without its details comes back disabled and asks for the password again", async () => {
	const [without, withSecret] = TYPES.ddns.restoreRows({
		npmpro_ddns_record: [presetRecord(1, "a.example.com", { secret: null }), presetRecord(2, "b.example.com")],
	}).npmpro_ddns_record;
	assert.equal(Number(without.enabled), 0);
	assert.equal(without.state, "disabled");
	assert.equal(JSON.parse(without.meta).error_i18n, "error.ddns-secret-missing");
	assert.equal(Number(withSecret.enabled), 1);
	assert.equal(withSecret.state, "pending");
	const knex = await open();
	try {
		const stripped = TYPES.ddns.secrets.strip(ddnsData([presetRecord(1, "a.example.com")]).ddns);
		await replaceTypes({ knex, data: { ddns: stripped }, types: ["ddns"], adminUserId: 1, box, now: NOW });
		const [row] = await knex("npmpro_ddns_record");
		assert.equal(row.secret, null);
		assert.equal(Number(row.enabled), 0);
		assert.equal(JSON.parse(row.meta).error_i18n, "error.ddns-secret-missing");
		const full = TYPES.ddns.secrets.export(ddnsData([presetRecord(1, "a.example.com")]).ddns, box);
		await replaceTypes({ knex, data: { ddns: full }, types: ["ddns"], adminUserId: 1, box, now: NOW });
		const [kept] = await knex("npmpro_ddns_record");
		assert.deepEqual(box.decrypt(kept.secret), { username: "me@example.com", password: "PRESET-pass-4321" });
		assert.equal(Number(kept.enabled), 1);
	} finally {
		await knex.destroy();
	}
});

it("a merge replace from a backup without secrets keeps the sealed details of a record of the same provider", async () => {
	const knex = await open();
	try {
		await knex("npmpro_ddns_record").insert([
			customRecord(4, "c.example.com", { state: "ok" }),
			presetRecord(6, "p.example.com", { state: "ok" }),
		]);
		const stripped = TYPES.ddns.secrets.strip(
			ddnsData([customRecord(5, "c.example.com"), presetRecord(7, "p.example.com")]).ddns,
		);
		await merge(knex, {
			data: { ddns: stripped },
			choices: { "ddns:5": "replace", "ddns:7": "replace" },
			secrets: false,
		});
		const custom = await knex("npmpro_ddns_record").where({ name: "c.example.com" }).first();
		assert.equal(custom.id, 4);
		assert.deepEqual(box.decrypt(custom.secret), {
			url: "https://dyn.test/u/TOKEN-9876",
			method: "POST",
			expect: "good",
		});
		assert.equal(Number(custom.enabled), 1);
		assert.equal(custom.state, "pending");
		assert.notEqual(JSON.parse(custom.meta).error_i18n, "error.ddns-custom-url-missing");
		const preset = await knex("npmpro_ddns_record").where({ name: "p.example.com" }).first();
		assert.deepEqual(box.decrypt(preset.secret), { username: "me@example.com", password: "PRESET-pass-4321" });
		assert.equal(Number(preset.enabled), 1);
		assert.equal(preset.state, "pending");
	} finally {
		await knex.destroy();
	}
});

it("a merge replace from a backup without secrets onto a record of another provider stores it disabled, asking again", async () => {
	const knex = await open();
	try {
		await knex("npmpro_ddns_record").insert(customRecord(4, "c.example.com", { state: "ok" }));
		const stripped = TYPES.ddns.secrets.strip(ddnsData([presetRecord(5, "c.example.com")]).ddns);
		await merge(knex, { data: { ddns: stripped }, choices: { "ddns:5": "replace" }, secrets: false });
		const [row] = await knex("npmpro_ddns_record");
		assert.equal(row.id, 4);
		assert.equal(row.provider, "noip");
		assert.equal(row.secret, null);
		assert.equal(Number(row.enabled), 0);
		assert.equal(row.state, "disabled");
		assert.equal(JSON.parse(row.meta).error_i18n, "error.ddns-secret-missing");
	} finally {
		await knex.destroy();
	}
});

// host records (managed rows): a DDNS row that follows a host through host_type and host_id
const hostRow = (id, name, extra = {}) => ({
	id,
	owner_user_id: 1,
	domain_names: [name],
	enabled: 1,
	certificate_id: 0,
	npmpro_mtls_certificate_id: 0,
	access_list_id: 0,
	meta: {},
	...extra,
});
const proxyData = (hosts) => ({
	proxy_hosts: { proxy_host: hosts, npmpro_location: [], npmpro_proxy_host_access_list: [] },
});
const managed = (id, name, hostId, extra = {}) =>
	record(id, 1, name, {
		host_type: "proxy_host",
		host_id: hostId,
		origin: "created",
		state: "ok",
		failures: 0,
		error: null,
		meta: JSON.stringify({ reach: { result: "reachable", port: 80 } }),
		...extra,
	});
const NOT_RESTORED = /a\.example\.com.*not restored/u;
const metaOfRow = (row) => (typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta);

it("a full restore keeps the link of a host record, starts it pending and create-only, and keeps meta.reach", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		const data = {
			...proxyData([hostRow(7, "a.example.com"), hostRow(8, "b.example.com")]),
			...bothData(
				[credential(1, 1, "Cloudflare")],
				[
					managed(1, "a.example.com", 7),
					managed(2, "b.example.com", 8, { enabled: 0, state: "disabled" }),
					managed(3, "c.example.com", 8, {
						origin: "adopted",
						host_type: "proxy_host",
						host_id: 8,
					}),
				],
			),
		};
		const result = await replaceTypes({
			knex,
			data,
			types: ["proxy_hosts", "dns_credentials", "ddns"],
			adminUserId: 1,
			box,
			now: NOW,
		});
		const rows = await knex("npmpro_ddns_record").orderBy("id");
		// c.example.com is not a name of host 8: the row stays, as a plain record without the link
		assert.deepEqual(
			rows.map((row) => [row.id, row.host_type, row.host_id, row.origin, row.state]),
			[
				[1, "proxy_host", 7, "created", "pending"],
				[2, "proxy_host", 8, "created", "disabled"],
				[3, null, null, null, "pending"],
			],
		);
		assert.deepEqual(metaOfRow(rows[0]).reach, { result: "reachable", port: 80 });
		assert.equal(metaOfRow(rows[0]).create_only, true);
		assert.equal(metaOfRow(rows[2]).create_only, undefined);
		assert.ok(result.references.some((change) => change.label.includes("c.example.com")));
	} finally {
		await knex.destroy();
	}
});

it("a restore with the ddns type and without the host types drops the host records with a note, and keeps the manual ones", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		// an instance host with the same id and name is not the backup's host
		await knex("proxy_host").insert({ id: 7, owner_user_id: 1, domain_names: JSON.stringify(["a.example.com"]) });
		const data = ddnsData([managed(1, "a.example.com", 7), record(2, 1, "manual.example.com")]);
		const preview = await previewReplace({ knex, data, types: ["ddns"], adminUserId: 1 });
		assert.ok(preview.references.some((change) => change.remove && NOT_RESTORED.test(change.label)));
		const result = await replaceTypes({ knex, data, types: ["ddns"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("name"), ["manual.example.com"]);
		assert.ok(result.references.some((change) => change.remove && NOT_RESTORED.test(change.label)));
	} finally {
		await knex.destroy();
	}
});

it("a restore drops a host record whose host is not in the backup's hosts, and one that is an orphan", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		const data = {
			...proxyData([hostRow(7, "a.example.com")]),
			...ddnsData([
				managed(1, "gone.example.com", 99),
				managed(2, "a.example.com", 7, { meta: JSON.stringify({ orphan: true }), enabled: 0, state: "failed" }),
				managed(3, "a.example.com", 7),
				managed(4, "wild.example.com", 7, { host_type: "stream" }),
			]),
		};
		await replaceTypes({ knex, data, types: ["proxy_hosts", "ddns"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("id"), [3]);
	} finally {
		await knex.destroy();
	}
});

it("a created host record restored as create-only is never written over a record that appeared, by the engine's rule", () => {
	const [created, adopted, plain] = TYPES.ddns.restoreRows({
		npmpro_ddns_record: [
			managed(1, "a.example.com", 7, { meta: { reach: { result: "reachable" } } }),
			managed(2, "b.example.com", 7, { origin: "adopted" }),
			record(3, 1, "c.example.com"),
		],
	}).npmpro_ddns_record;
	assert.equal(created.meta.create_only, true);
	assert.deepEqual(created.meta.reach, { result: "reachable" });
	// what it wrote stays known, so a record that still holds it is its own
	assert.equal(created.last_ipv4, "81.2.69.160");
	assert.equal(adopted.meta.create_only, undefined);
	assert.equal(plain.meta.create_only, undefined);
});

it("a hosts restore without the ddns type turns a host record whose host is gone or lost the name into a plain record", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		await knex("proxy_host").insert([
			{ id: 7, owner_user_id: 1, domain_names: JSON.stringify(["a.example.com"]) },
			{ id: 8, owner_user_id: 1, domain_names: JSON.stringify(["b.example.com"]) },
		]);
		await knex("npmpro_ddns_record").insert([
			{ ...managed(1, "a.example.com", 7), meta: JSON.stringify({ create_only: true }) },
			{ ...managed(2, "b.example.com", 8), meta: JSON.stringify({}) },
		]);
		// the backup's host 7 is another host, host 8 is not in it
		const data = proxyData([hostRow(7, "other.example.com")]);
		const result = await replaceTypes({ knex, data, types: ["proxy_hosts"], adminUserId: 1, box, now: NOW });
		const rows = await knex("npmpro_ddns_record").orderBy("id");
		assert.deepEqual(
			rows.map((row) => [row.host_type, row.host_id, row.origin]),
			[
				[null, null, null],
				[null, null, null],
			],
		);
		// the create-only rule stays with the row
		assert.equal(metaOfRow(rows[0]).create_only, true);
		assert.equal(result.references.filter((change) => change.table === "npmpro_ddns_record").length, 2);
	} finally {
		await knex.destroy();
	}
});

it("a hosts restore keeps a host record whose host and name are still there", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		await knex("proxy_host").insert({ id: 7, owner_user_id: 1, domain_names: JSON.stringify(["a.example.com"]) });
		await knex("npmpro_ddns_record").insert(managed(1, "a.example.com", 7));
		const data = proxyData([hostRow(7, "a.example.com")]);
		const result = await replaceTypes({ knex, data, types: ["proxy_hosts"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(
			result.references.filter((change) => change.table === "npmpro_ddns_record"),
			[],
		);
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("host_id"), [7]);
	} finally {
		await knex.destroy();
	}
});

it("a merge maps the host id of a host record to the host the merge added", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		await knex("proxy_host").insert({ id: 1, owner_user_id: 1, domain_names: JSON.stringify(["x.example.com"]) });
		const data = {
			...proxyData([hostRow(7, "a.example.com")]),
			...bothData([credential(1, 1, "Cloudflare")], [managed(1, "a.example.com", 7)]),
		};
		const { result } = await merge(knex, { data, types: ["proxy_hosts", "dns_credentials", "ddns"] });
		const hostId = result.maps.proxy_host.get("7");
		assert.notEqual(hostId, 7);
		const [row] = await knex("npmpro_ddns_record");
		assert.deepEqual(
			[row.host_type, row.host_id, row.origin, row.state],
			["proxy_host", hostId, "created", "pending"],
		);
		assert.equal(metaOfRow(row).create_only, true);
	} finally {
		await knex.destroy();
	}
});

it("a merge skips a host record whose host is not written by the merge, whose host lacks the name or that is an orphan", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		// host 7 of the backup clashes with an instance host and is skipped
		await knex("proxy_host").insert({ id: 4, owner_user_id: 1, domain_names: JSON.stringify(["a.example.com"]) });
		const data = {
			...proxyData([hostRow(7, "a.example.com"), hostRow(8, "b.example.com")]),
			...bothData(
				[credential(1, 1, "Cloudflare")],
				[
					managed(1, "a.example.com", 7),
					managed(2, "other.example.com", 8),
					managed(3, "b.example.com", 8, { meta: JSON.stringify({ orphan: true }) }),
					managed(4, "b.example.com", 99),
					managed(5, "b.example.com", 8),
				],
			),
		};
		const { result } = await merge(knex, {
			data,
			types: ["proxy_hosts", "dns_credentials", "ddns"],
			choices: { "proxy_hosts:7": "skip" },
		});
		assert.deepEqual(await knex("npmpro_ddns_record").pluck("name"), ["b.example.com"]);
		assert.equal(result.skipped_records.length, 4);
	} finally {
		await knex.destroy();
	}
});

it("a merge never replaces a host's record by a record of another host or by a manual record", async () => {
	const knex = await open();
	try {
		await seedCredential(knex);
		await knex("proxy_host").insert([
			{ id: 4, owner_user_id: 1, domain_names: JSON.stringify(["a.example.com"]) },
			{ id: 5, owner_user_id: 1, domain_names: JSON.stringify(["b.example.com"]) },
		]);
		await knex("npmpro_ddns_record").insert([
			{ ...managed(10, "a.example.com", 4), meta: "{}" },
			{ ...managed(11, "b.example.com", 5), meta: "{}" },
		]);
		const data = {
			...proxyData([hostRow(7, "a.example.com")]),
			...bothData(
				[credential(1, 1, "Cloudflare")],
				[managed(1, "a.example.com", 7), record(2, 1, "b.example.com")],
			),
		};
		const { plan } = await merge(knex, {
			data,
			types: ["proxy_hosts", "dns_credentials", "ddns"],
			choices: { "proxy_hosts:7": "replace", "ddns:1": "replace", "ddns:2": "replace" },
		});
		assert.equal(plan.items.find((item) => item.key === "ddns:1").action, "replace");
		const rows = await knex("npmpro_ddns_record").orderBy("id");
		// ddns:1 replaces the record of host 4 (the same host after the replace, id 4), ddns:2 may not take host 5's record
		assert.deepEqual(
			rows.map((row) => [row.id, row.host_id]),
			[
				[10, 4],
				[11, 5],
			],
		);
		assert.equal(rows[0].state, "pending");
		assert.equal(rows[1].state, "ok");
	} finally {
		await knex.destroy();
	}
});

it("an export leaves out an orphan host record and keeps the rest with their host link", async () => {
	const knex = await open();
	const dataDir = await mkdtemp(path.join(os.tmpdir(), "npmpro-ddns-export-"));
	const stageDir = await mkdtemp(path.join(os.tmpdir(), "npmpro-ddns-stage-"));
	try {
		await seedCredential(knex);
		await knex("npmpro_ddns_record").insert([
			managed(1, "a.example.com", 7),
			managed(2, "b.example.com", 7, { meta: JSON.stringify({ orphan: true }), enabled: 0, state: "failed" }),
			record(3, 1, "manual.example.com"),
		]);
		const { manifest } = await exportStage({
			knex,
			box,
			dataDir,
			stageDir,
			types: ["ddns"],
			secrets: false,
			meta: {
				npmproVersion: "1.0.0",
				dbVersion: "1",
				createdBy: { name: "A", email: "a@example.com" },
				createdAt: "2026-11-25T10:00:00.000Z",
			},
		});
		const exported = JSON.parse(await readFile(path.join(stageDir, "data/ddns.json"), "utf8"));
		assert.deepEqual(
			exported.npmpro_ddns_record.map((row) => [row.name, row.host_type, row.host_id, row.origin]),
			[
				["a.example.com", "proxy_host", 7, "created"],
				["manual.example.com", null, null, null],
			],
		);
		assert.equal(manifest.counts.ddns, 2);
	} finally {
		await knex.destroy();
	}
});
