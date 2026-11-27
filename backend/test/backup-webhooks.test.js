import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import knexFactory from "knex";
import { exportStage } from "../lib/backup/export.js";
import { checkItemValues, checkPageImport } from "../lib/backup/import-checks.js";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { previewReplace, replaceTypes } from "../lib/backup/restore-db.js";
import { itemLabel, linkedOf, selectRows } from "../lib/backup/select.js";
import { CATEGORIES, RESTORE_ORDER, TYPES } from "../lib/backup/types.js";
import { createSchema } from "./support/backup-schema.js";

// The webhooks backup type: the sealed URL and secrets travel in the archive and come back sealed with the target's
// box, a backup without secrets restores the webhooks off, a replace removes the deliveries of the replaced webhooks,
// and a merge skips a webhook whose name is taken.

process.env.TZ = "UTC";

const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };
const otherBox = {
	encrypt: (value) => `v1:other:${JSON.stringify(value)}`,
	decrypt: (value) => JSON.parse(value.slice(9)),
};
const NOW = 1_800_000_000;
const OTHER_SEALED = /^v1:other:/u;
const WARNED = /webhook 1 \(Chat\)/u;
const STAMP = "2026-11-23 12:00:00";
const URL_ONE = "https://hooks.example.com/in/one?token=s3cr3t";
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

// a webhook row as an export holds it: the URL and the secrets clear
const webhook = (id, name, extra = {}) => ({
	id,
	created_on: STAMP,
	modified_on: STAMP,
	name,
	url: URL_ONE,
	url_hint: "wrong hint",
	secret: `whsec_${name}`,
	previous_secret: `whsec_old_${name}`,
	previous_secret_until: STAMP,
	events: ["backup.failed", "certificate.expiring"],
	enabled: true,
	verify_tls: true,
	disabled_reason: null,
	failing_since: STAMP,
	last_success_on: STAMP,
	...extra,
});
const data = (rows) => ({ webhooks: { npmpro_webhook: rows } });

const delivery = (knex, target, extra = {}) =>
	knex("npmpro_notification_delivery").insert({
		created_on: STAMP,
		modified_on: STAMP,
		message_id: `msg_${target}_${Math.random()}`,
		event: "backup.failed",
		channel: "webhook",
		target_id: target,
		payload: "{}",
		status: "pending",
		attempts: 0,
		...extra,
	});

const merge = async (knex, { source, items, scope = SCOPE, secrets = true, target = box }) => {
	const instance = { ...(await readInstanceRows(knex)), files: {} };
	const plan = planMerge({
		data: source,
		instance,
		stageFiles: {},
		types: ["webhooks"],
		items,
		choices: {},
		scope,
		secrets,
	});
	const result = await mergeTypes({
		knex,
		data: source,
		plan,
		adminUserId: 1,
		importerId: 1,
		page: scope.page,
		box: target,
		secrets,
		now: NOW,
	});
	return { plan, result };
};

it("the webhooks type has its own category after the settings and restores after them", () => {
	const ids = CATEGORIES.map((category) => category.id);
	assert.equal(ids[ids.indexOf("settings") + 1], "webhooks");
	assert.deepEqual(CATEGORIES.find((category) => category.id === "webhooks").types, ["webhooks"]);
	assert.ok(RESTORE_ORDER.indexOf("webhooks") > RESTORE_ORDER.indexOf("backup_schedules"));
	assert.ok(RESTORE_ORDER.indexOf("webhooks") > RESTORE_ORDER.indexOf("settings_notifications"));
	assert.deepEqual(
		TYPES.webhooks.tables.map(({ table }) => table),
		["npmpro_webhook"],
	);
});

it("select labels a webhook by its name and a webhook needs no other item", () => {
	const rows = { npmpro_webhook: [webhook(1, "Chat"), webhook(2, "Pager")] };
	assert.equal(itemLabel("webhooks", rows.npmpro_webhook[0]), "Chat");
	assert.deepEqual(
		selectRows("webhooks", rows, ["2"]).npmpro_webhook.map((row) => row.id),
		[2],
	);
	const linked = linkedOf({ webhooks: rows });
	assert.equal(linked.certificates.size + linked.access_lists.size + linked.dns_credentials.size, 0);
});

it("the secrets are opened for the archive, stripped without secrets and sealed again with the target's box", () => {
	const sealedRow = {
		...webhook(1, "Chat"),
		url: box.encrypt(URL_ONE),
		secret: box.encrypt("whsec_Chat"),
		previous_secret: box.encrypt("whsec_old_Chat"),
	};
	const [opened] = TYPES.webhooks.secrets.export({ npmpro_webhook: [sealedRow] }, box).npmpro_webhook;
	assert.equal(opened.url, URL_ONE);
	assert.equal(opened.secret, "whsec_Chat");
	assert.equal(opened.previous_secret, "whsec_old_Chat");

	const [stripped] = TYPES.webhooks.secrets.strip({ npmpro_webhook: [opened] }).npmpro_webhook;
	assert.deepEqual(
		[stripped.url, stripped.url_hint, stripped.secret, stripped.previous_secret, stripped.previous_secret_until],
		["", "", "", null, null],
	);
	assert.equal(stripped.name, "Chat");

	const [sealed] = TYPES.webhooks.secrets.seal({ npmpro_webhook: [opened] }, otherBox).npmpro_webhook;
	assert.equal(otherBox.decrypt(sealed.url), URL_ONE);
	assert.equal(otherBox.decrypt(sealed.secret), "whsec_Chat");
	assert.equal(otherBox.decrypt(sealed.previous_secret), "whsec_old_Chat");
	// the hint is made from the URL, never taken from the file, and never holds the query
	assert.equal(sealed.url_hint, "https://hooks.example.com/in/one");
});

it("a value this instance cannot open leaves the archive as nothing and its webhook comes back off", () => {
	const failing = {
		decrypt: () => {
			throw new Error("another key");
		},
	};
	const [row] = TYPES.webhooks.secrets.export(
		{ npmpro_webhook: [{ ...webhook(1, "Chat"), url: "v1:x:y:z", secret: "v1:a:b:c", previous_secret: null }] },
		failing,
	).npmpro_webhook;
	assert.equal(row.url, "");
	assert.equal(row.secret, "");
	const [back] = TYPES.webhooks.restoreRows(
		TYPES.webhooks.secrets.seal({ npmpro_webhook: [row] }, box),
	).npmpro_webhook;
	assert.equal(back.enabled, false);
	assert.equal(back.disabled_reason, "restore");
});

it("a webhook with its URL and secret keeps its switches; one without comes back off with the reason restore", () => {
	const complete = webhook(1, "A", { enabled: false, disabled_reason: "gone" });
	const sealed = TYPES.webhooks.secrets.seal(
		{
			npmpro_webhook: [
				webhook(1, "On"),
				complete,
				webhook(2, "NoUrl", { url: "" }),
				webhook(3, "NoSecret", { secret: null }),
			],
		},
		box,
	);
	const [on, gone, noUrl, noSecret] = TYPES.webhooks.restoreRows(sealed).npmpro_webhook;
	assert.deepEqual([on.enabled, on.disabled_reason, on.failing_since], [true, null, null]);
	assert.deepEqual([gone.enabled, gone.disabled_reason], [false, "gone"]);
	for (const row of [noUrl, noSecret]) {
		assert.deepEqual(
			[row.enabled, row.disabled_reason, row.failing_since, row.url_hint],
			[false, "restore", null, ""],
		);
	}
});

it("a replace restore seals the URL and secrets with the box and they open to the backup's values", async () => {
	const knex = await open();
	try {
		const source = data([webhook(1, "Chat")]);
		const result = await replaceTypes({
			knex,
			data: source,
			types: ["webhooks"],
			adminUserId: 1,
			box: otherBox,
			now: NOW,
		});
		assert.equal(result.counts.webhooks, 1);
		const stored = await knex("npmpro_webhook").first();
		for (const column of ["url", "secret", "previous_secret"]) assert.match(stored[column], OTHER_SEALED);
		assert.equal(otherBox.decrypt(stored.url), URL_ONE);
		assert.equal(otherBox.decrypt(stored.secret), "whsec_Chat");
		assert.equal(otherBox.decrypt(stored.previous_secret), "whsec_old_Chat");
		assert.equal(stored.url_hint, "https://hooks.example.com/in/one");
		assert.equal(Boolean(stored.enabled), true);
		assert.equal(stored.failing_since, null);
		assert.deepEqual(JSON.parse(stored.events), ["backup.failed", "certificate.expiring"]);
	} finally {
		await knex.destroy();
	}
});

it("a replace restore of a backup without secrets brings the webhooks back off, and no event or mail is queued", async () => {
	const knex = await open();
	try {
		const stripped = TYPES.webhooks.secrets.strip(data([webhook(1, "Chat")]).webhooks);
		await replaceTypes({ knex, data: { webhooks: stripped }, types: ["webhooks"], adminUserId: 1, box, now: NOW });
		const stored = await knex("npmpro_webhook").first();
		assert.equal(Boolean(stored.enabled), false);
		assert.equal(stored.disabled_reason, "restore");
		assert.equal(stored.url, "");
		assert.equal(stored.url_hint, "");
		assert.equal(stored.secret, "");
		assert.equal(stored.failing_since, null);
		assert.equal((await knex("npmpro_notification_delivery")).length, 0);
	} finally {
		await knex.destroy();
	}
});

it("a replace restore removes the pending and old deliveries of the replaced webhooks only", async () => {
	const knex = await open();
	try {
		await knex("npmpro_webhook").insert({
			id: 9,
			created_on: STAMP,
			modified_on: STAMP,
			name: "Old",
			url: box.encrypt("https://old.example.com/"),
			url_hint: "https://old.example.com/",
			secret: box.encrypt("whsec_old"),
			events: "[]",
		});
		await delivery(knex, 9, { status: "pending" });
		await delivery(knex, 9, { status: "failed", attempts: 8 });
		await delivery(knex, 9, { status: "sent" });
		await delivery(knex, 5, { channel: "mail", status: "pending" });
		await replaceTypes({
			knex,
			data: data([webhook(1, "Chat")]),
			types: ["webhooks"],
			adminUserId: 1,
			box,
			now: NOW,
		});
		assert.deepEqual(await knex("npmpro_webhook").pluck("name"), ["Chat"]);
		const left = await knex("npmpro_notification_delivery").select("channel", "target_id");
		assert.deepEqual(left, [{ channel: "mail", target_id: 5 }]);
	} finally {
		await knex.destroy();
	}
});

it("a restore that does not choose the webhooks leaves the webhooks and their deliveries alone", async () => {
	const knex = await open();
	try {
		await knex("npmpro_webhook").insert({
			id: 9,
			created_on: STAMP,
			modified_on: STAMP,
			name: "Keep",
			url: box.encrypt("https://keep.example.com/"),
			url_hint: "https://keep.example.com/",
			secret: box.encrypt("whsec_keep"),
			events: "[]",
		});
		await delivery(knex, 9);
		const other = { ddns: { npmpro_ddns_record: [] } };
		await replaceTypes({
			knex,
			data: { ...data([webhook(1, "Chat")]), ...other },
			types: ["ddns"],
			adminUserId: 1,
			box,
			now: NOW,
		});
		assert.deepEqual(await knex("npmpro_webhook").pluck("name"), ["Keep"]);
		assert.equal((await knex("npmpro_notification_delivery")).length, 1);
	} finally {
		await knex.destroy();
	}
});

it("a webhook references nothing: the preview, the value checks and the page import checks have nothing to say", async () => {
	const knex = await open();
	try {
		const source = data([webhook(1, "Chat")]);
		const preview = await previewReplace({ knex, data: source, types: ["webhooks"], adminUserId: 1 });
		assert.deepEqual(preview.references, []);
		const instance = { ...(await readInstanceRows(knex)), files: {} };
		const plan = planMerge({
			data: source,
			instance,
			stageFiles: {},
			types: ["webhooks"],
			scope: SCOPE,
			secrets: true,
		});
		assert.deepEqual(plan.cleared_links, []);
		assert.deepEqual(plan.needs_secrets, []);
		await checkItemValues({ plan, data: source });
		await checkPageImport({ knex, plan, data: source });
		const result = await replaceTypes({ knex, data: source, types: ["webhooks"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(result.references, []);
	} finally {
		await knex.destroy();
	}
});

it("a merge adds a webhook under a new id, sealed with the box and off without secrets", async () => {
	const knex = await open();
	try {
		await knex("npmpro_webhook").insert({
			id: 4,
			created_on: STAMP,
			modified_on: STAMP,
			name: "Existing",
			url: box.encrypt("https://existing.example.com/"),
			url_hint: "https://existing.example.com/",
			secret: box.encrypt("whsec_existing"),
			events: "[]",
		});
		const withSecrets = await merge(knex, { source: data([webhook(4, "Chat")]), target: otherBox });
		assert.equal(withSecrets.result.counts.webhooks, 1);
		const added = await knex("npmpro_webhook").where({ name: "Chat" }).first();
		assert.notEqual(added.id, 4);
		assert.equal(otherBox.decrypt(added.url), URL_ONE);
		assert.equal(otherBox.decrypt(added.secret), "whsec_Chat");
		assert.equal(Boolean(added.enabled), true);

		const bare = TYPES.webhooks.secrets.strip(data([webhook(7, "Bare")]).webhooks);
		await merge(knex, { source: { webhooks: bare }, secrets: false });
		const off = await knex("npmpro_webhook").where({ name: "Bare" }).first();
		assert.equal(Boolean(off.enabled), false);
		assert.equal(off.disabled_reason, "restore");
		assert.equal(off.url, "");
	} finally {
		await knex.destroy();
	}
});

it("a merge skips a webhook whose name is taken, with a note, and keeps the instance's URL and secret", async () => {
	const knex = await open();
	try {
		await knex("npmpro_webhook").insert({
			id: 4,
			created_on: STAMP,
			modified_on: STAMP,
			name: "chat",
			url: box.encrypt("https://existing.example.com/"),
			url_hint: "https://existing.example.com/",
			secret: box.encrypt("whsec_existing"),
			events: "[]",
		});
		const { plan, result } = await merge(knex, { source: data([webhook(1, "Chat"), webhook(2, "Pager")]) });
		const byLabel = Object.fromEntries(plan.items.map((item) => [item.label, item]));
		assert.equal(byLabel.Chat.action, "skip");
		assert.equal(byLabel.Chat.reason, "same-name");
		assert.deepEqual(byLabel.Chat.choices, ["skip"]);
		assert.equal(byLabel.Pager.action, "add");
		assert.equal(result.counts.webhooks, 1);
		const names = await knex("npmpro_webhook").orderBy("id").pluck("name");
		assert.deepEqual(names, ["chat", "Pager"]);
		assert.equal(box.decrypt((await knex("npmpro_webhook").where({ id: 4 }).first()).secret), "whsec_existing");
	} finally {
		await knex.destroy();
	}
});

it("a page import never takes webhooks", async () => {
	const knex = await open();
	try {
		const page = { ...SCOPE, page: true };
		const instance = { ...(await readInstanceRows(knex)), files: {} };
		const plan = planMerge({
			data: data([webhook(1, "Chat")]),
			instance,
			stageFiles: {},
			types: ["webhooks"],
			scope: page,
			secrets: true,
		});
		assert.deepEqual(plan.items, []);
	} finally {
		await knex.destroy();
	}
});

it("an export holds the webhooks and never their deliveries", async () => {
	const knex = await open();
	try {
		await knex("npmpro_webhook").insert({
			id: 1,
			created_on: STAMP,
			modified_on: STAMP,
			name: "Chat",
			url: box.encrypt(URL_ONE),
			url_hint: "https://hooks.example.com/in/one",
			secret: box.encrypt("whsec_Chat"),
			events: JSON.stringify(["backup.failed"]),
		});
		await delivery(knex, 1);
		const meta = {
			npmproVersion: "1.0.0",
			dbVersion: "1",
			createdBy: { name: "A", email: "a@example.com" },
			createdAt: "2026-11-25T10:00:00.000Z",
		};
		const dataDir = await mkdtemp(path.join(os.tmpdir(), "wh-data-"));
		for (const secrets of [true, false]) {
			const stageDir = await mkdtemp(path.join(os.tmpdir(), "wh-stage-"));
			const { manifest } = await exportStage({
				knex,
				box,
				dataDir,
				stageDir,
				types: ["webhooks"],
				secrets,
				meta,
			});
			assert.equal(manifest.counts.webhooks, 1);
			const exported = JSON.parse(await readFile(path.join(stageDir, "data/webhooks.json"), "utf8"));
			assert.deepEqual(Object.keys(exported), ["npmpro_webhook"]);
			const [row] = exported.npmpro_webhook;
			assert.deepEqual(row.events, ["backup.failed"]);
			assert.deepEqual(
				[row.url, row.url_hint, row.secret],
				secrets ? [URL_ONE, "https://hooks.example.com/in/one", "whsec_Chat"] : ["", "", ""],
			);
			assert.equal(JSON.stringify(exported).includes("msg_"), false);
		}
	} finally {
		await knex.destroy();
	}
});

const unusable = (name, extra = {}) =>
	webhook(1, name, { url: "", secret: "", previous_secret: null, previous_secret_until: null, ...extra });

it("an unopenable value is left out of the export with one warning and the webhook restores off through the real insert", async () => {
	const { global: logger } = await import("../logger.js");
	const warned = [];
	const original = logger.warn;
	logger.warn = (line) => warned.push(String(line));
	let source;
	try {
		const failing = {
			decrypt: () => {
				throw new Error("another key");
			},
		};
		const sealedRow = {
			...webhook(1, "Chat"),
			url: "v1:a:b:c",
			secret: box.encrypt("whsec_Chat"),
			previous_secret: "v1:x:y:z",
		};
		source = data(TYPES.webhooks.secrets.export({ npmpro_webhook: [sealedRow] }, failing).npmpro_webhook);
	} finally {
		logger.warn = original;
	}
	assert.equal(warned.length, 1);
	assert.match(warned[0], WARNED);
	assert.equal(warned[0].includes("whsec_"), false);
	const [row] = source.webhooks.npmpro_webhook;
	assert.deepEqual([row.url, row.previous_secret], ["", ""]);

	const knex = await open();
	try {
		await replaceTypes({ knex, data: source, types: ["webhooks"], adminUserId: 1, box, now: NOW });
		const stored = await knex("npmpro_webhook").first();
		assert.deepEqual(
			[
				Boolean(stored.enabled),
				stored.disabled_reason,
				stored.url,
				stored.secret,
				stored.previous_secret,
				stored.previous_secret_until,
				stored.url_hint,
			],
			[false, "restore", "", "", null, null, ""],
		);
		await merge(knex, { source: data([{ ...row, id: 5, name: "Merged" }]) });
		const merged = await knex("npmpro_webhook").where({ name: "Merged" }).first();
		assert.deepEqual(
			[Boolean(merged.enabled), merged.disabled_reason, merged.url, merged.secret],
			[false, "restore", "", ""],
		);
	} finally {
		await knex.destroy();
	}
});

it("null values and an invalid URL restore off through the real insert, with the secrets cleared together", async () => {
	const knex = await open();
	try {
		const rows = [
			webhook(1, "NullUrl", { url: null }),
			unusable("NullBoth", { id: 2, url: null, secret: null }),
			webhook(3, "BadUrl", { url: "ftp://example.com/x" }),
			webhook(4, "Good"),
		];
		rows[1].name = "NullBoth";
		await replaceTypes({ knex, data: data(rows), types: ["webhooks"], adminUserId: 1, box, now: NOW });
		const stored = Object.fromEntries((await knex("npmpro_webhook")).map((row) => [row.name, row]));
		for (const name of ["NullUrl", "NullBoth", "BadUrl"]) {
			const row = stored[name];
			assert.deepEqual(
				[
					Boolean(row.enabled),
					row.disabled_reason,
					row.url,
					row.secret,
					row.previous_secret,
					row.previous_secret_until,
					row.url_hint,
				],
				[false, "restore", "", "", null, null, ""],
				name,
			);
		}
		assert.equal(Boolean(stored.Good.enabled), true);
	} finally {
		await knex.destroy();
	}
});

it("an unusable previous secret is dropped on a replace and a merge: the webhook stays on, previous_secret null, date cleared", async () => {
	const knex = await open();
	try {
		const bad = webhook(1, "Rotated", { previous_secret: "", previous_secret_until: STAMP });
		await replaceTypes({ knex, data: data([bad]), types: ["webhooks"], adminUserId: 1, box, now: NOW });
		await merge(knex, { source: data([{ ...bad, id: 2, name: "Merged" }]) });
		for (const name of ["Rotated", "Merged"]) {
			const row = await knex("npmpro_webhook").where({ name }).first();
			assert.deepEqual(
				[Boolean(row.enabled), row.disabled_reason, row.previous_secret, row.previous_secret_until],
				[true, null, null, null],
				name,
			);
			assert.equal(box.decrypt(row.secret), "whsec_Rotated");
		}
	} finally {
		await knex.destroy();
	}
});
