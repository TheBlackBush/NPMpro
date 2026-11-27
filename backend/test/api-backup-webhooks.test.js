import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// The webhooks backup type through the real app: a backup with secrets restores the webhook enabled and signing with
// the same secret (sealed with this instance's box), a backup without secrets restores it off with the reason restore,
// and a restore queues no webhook.disabled event.

const BASE = "/backups";
const PASSPHRASE = "a long passphrase 1";
const TYPES = ["webhooks"];
const SEALED = /^v1:/u;
const WHSEC = /^whsec_/u;
const URL_ONE = "https://hooks.example.com/in/hook?token=s3cr3t";

let api;
let admin;
let secretBox;

before(async () => {
	api = await startApi();
	admin = await api.admin();
	secretBox = (await import("../lib/secret-box.js")).defaultSecretBox;
	api.outside.dns.set("hooks.example.com", "203.0.113.10");
});
after(async () => {
	await api?.stop();
});

const ok = (done) => {
	if (done.status !== 200 && done.status !== 201) throw new Error(`${done.status} ${done.text}`);
	return done;
};
const keep = async (body) => ok(await admin.post(BASE, { types: TYPES, keep: true, ...body })).body.entry;
const restore = async (entry, body = {}, types = TYPES) => {
	const { token } = ok(await admin.post(`${BASE}/${entry.name}/inspect`, body)).body;
	return ok(await admin.post(`${BASE}/restore/${token}`, { types, confirm: true }));
};
const row = (name) => api.db("npmpro_webhook").where({ name }).first();
const create = async (name) =>
	ok(await admin.post("/webhooks", { name, url: URL_ONE, events: ["backup.failed"] })).body;

it("a backup with secrets restores the webhook enabled, sealed with this box, signing with the same secret", async () => {
	const created = await create("With secrets");
	const entry = await keep({ secrets: true, passphrase: PASSPHRASE });
	await ok(await admin.delete(`/webhooks/${created.id}`));
	assert.equal(await row("With secrets"), undefined);

	await restore(entry, { passphrase: PASSPHRASE });
	const stored = await row("With secrets");
	for (const column of ["url", "secret"]) assert.match(stored[column], SEALED);
	assert.equal(secretBox.decrypt(stored.url), URL_ONE);
	assert.equal(secretBox.decrypt(stored.secret), created.secret);
	assert.equal(Boolean(stored.enabled), true);
	const got = (await admin.get(`/webhooks/${stored.id}`)).body;
	assert.deepEqual([got.url_set, got.secret_set, got.secret_error, got.enabled], [true, true, false, true]);
	assert.equal(got.url_hint, "https://hooks.example.com/in/hook");
	assert.equal(JSON.stringify(got).includes("s3cr3t"), false);
});

it("a backup without secrets restores the webhook off, asking for its URL again, and queues no event", async () => {
	await create("Without secrets");
	const entry = await keep({ secrets: false });
	await restore(entry);
	const stored = await row("Without secrets");
	assert.equal(Boolean(stored.enabled), false);
	assert.equal(stored.disabled_reason, "restore");
	const got = (await admin.get(`/webhooks/${stored.id}`)).body;
	assert.deepEqual([got.url_set, got.url_hint, got.disabled_reason], [false, "", "restore"]);
	// no webhook.disabled for it: nothing in the queue, for the webhook or for mail
	const events = await api.db("npmpro_notification_delivery").where({ event: "webhook.disabled" });
	assert.deepEqual(events, []);

	// entering the URL again turns it on with a new secret
	const again = ok(await admin.put(`/webhooks/${stored.id}`, { url: URL_ONE })).body;
	assert.equal(again.enabled, true);
	assert.match(again.secret, WHSEC);
});

it("a restore removes the deliveries of the replaced webhooks", async () => {
	const created = await create("Deliveries");
	const entry = await keep({ secrets: true, passphrase: PASSPHRASE });
	const stamp = "2026-11-23 12:00:00";
	await api.db("npmpro_notification_delivery").insert({
		created_on: stamp,
		modified_on: stamp,
		message_id: "msg_pending_1",
		event: "backup.failed",
		channel: "webhook",
		target_id: created.id,
		payload: "{}",
		status: "pending",
		attempts: 0,
		next_try_on: "2999-01-01 00:00:00",
	});
	await restore(entry, { passphrase: PASSPHRASE });
	assert.deepEqual(await api.db("npmpro_notification_delivery").where({ channel: "webhook" }), []);
});

it("a backup of other types leaves the webhooks alone", async () => {
	await create("Untouched");
	const entry = await keep({ types: ["settings_default_site"], secrets: false });
	await restore(entry, {}, ["settings_default_site"]);
	assert.ok(await row("Untouched"));
});
