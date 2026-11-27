import assert from "node:assert/strict";
import dns from "node:dns";
import { after, before, it } from "node:test";
import { Webhook as StandardWebhook } from "standardwebhooks";
import { generateApiToken } from "../lib/api-token.js";
import { createGuardedAgent } from "../lib/outbound-guard.js";
import { startApi } from "./support/api.js";

// The webhook routes of Settings, Notifications through the real app: the service, the sealed columns, the audit, the
// test route and the redelivery (the receiver is the undici MockAgent of startApi).

const BASE = "https://hooks.example.com";
const PATH = "/in/hook";
const QUERY = "?token=s3cr3t";
const URL_WITH_TOKEN = `${BASE}${PATH}${QUERY}`;
const SECRET_TOKEN = "s3cr3t";
const SEALED = /^v1:/u;
const WHSEC = /^whsec_[A-Za-z0-9+/]+=*$/u;
const TWO_SIGNATURES = /^v1,\S+ v1,\S+$/u;
const MAY_NOT_REACH = /may not reach/u;
const STATUS_500 = /500/u;
const TOKEN_IN_QUERY = /s3cr3t/u;
const HIDDEN = /\*\*\*/u;
const DAY = 24 * 3_600_000;
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];

const api = await startApi();
const admin = await api.admin();
const knex = api.db;
const { defaultSecretBox } = await import("../lib/secret-box.js");
const { isoToLocal } = await import("../lib/backup/rows.js");
const { msOfDbTime } = await import("../lib/notify/db-time.js");
const { setWebhookAgentFactory, sweep, webhookChannel, worker } = await import("../internal/notify.js");

const logged = [];
const originalLog = console.log;
let counter = 0;
let tokens = 0;

before(() => {
	console.log = (...args) => logged.push(args.map(String).join(" "));
	api.outside.dns.set("hooks.example.com", "203.0.113.10");
	api.outside.dns.set("loop.example.com", "127.0.0.1");
	// the receivers are the MockAgent of startApi: no agent, the global dispatcher
	setWebhookAgentFactory(() => undefined);
	worker.start();
});
after(async () => {
	worker.stop();
	console.log = originalLog;
	await api.stop();
});

const uniqueName = () => {
	counter += 1;
	return `hook ${counter}`;
};
const create = (extra = {}) =>
	admin.post("/webhooks", { name: uniqueName(), url: URL_WITH_TOKEN, events: ["backup.failed"], ...extra });
const row = (id) => knex("npmpro_webhook").where({ id }).first();
const textOf = (value) => JSON.stringify(value);
// a pass that began before the row was added would miss it: two passes
const pass = async () => {
	await worker.runOnce();
	await worker.runOnce();
};
// a pending row that no pass of this file may pick up
const later = () => sql(Date.now() + DAY);
const sql = (ms) => isoToLocal(new Date(ms).toISOString());

// one mocked receiver: the calls it got (headers and the exact body) and the answer it gives
const receiver = (reply = { statusCode: 200, data: "ok" }, times = 1) => {
	const calls = [];
	api.outside.http
		.get(BASE)
		.intercept({ path: `${PATH}${QUERY}`, method: "POST" })
		.reply((options) => {
			calls.push({ headers: options.headers, body: String(options.body) });
			return typeof reply === "function" ? reply(options) : reply;
		})
		.times(times);
	return calls;
};

const delivery = async (hookId, fields = {}) => {
	const now = sql(Date.now());
	const message = `msg_${Math.random().toString(36).slice(2, 12)}`;
	const [inserted] = await knex("npmpro_notification_delivery")
		.insert({
			created_on: now,
			modified_on: now,
			message_id: message,
			event: "backup.failed",
			channel: "webhook",
			target_id: hookId,
			payload: JSON.stringify({
				id: message,
				type: "backup.failed",
				timestamp: "2026-11-27T10:00:00.000Z",
				data: { error: "disk full" },
			}),
			status: "failed",
			attempts: 8,
			...fields,
		})
		.returning("id");
	return { id: Number(inserted?.id ?? inserted), message };
};

// every call from an address of its own: the test route is limited to 5 a minute per address
const testCall = async (id) => (await bearer()).post(`/webhooks/${id}/test`, {});
const bearer = async ({ isAdmin = true, allowDelete = false } = {}) => {
	tokens += 1;
	const made = generateApiToken();
	const now = Math.floor(Date.now() / 1000);
	await knex("npmpro_api_token").insert({
		user_id: (await admin.get("/users/me")).body.id,
		name: `token ${tokens}`,
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		visibility: "user",
		...Object.fromEntries(SECTIONS.map((section) => [section, "manage"])),
		is_admin: isAdmin,
		allow_delete: allowDelete,
		created_on: now,
		expires_on: now + 3600,
	});
	const client = api.client();
	const headers = { authorization: `Bearer ${made.token}` };
	return {
		name: `token ${tokens}`,
		get: (url) => client.get(url, { headers }),
		post: (url, body) => client.post(url, body, { headers }),
		put: (url, body) => client.put(url, body, { headers }),
		delete: (url) => client.delete(url, { headers }),
	};
};

it("creates a webhook: 201, the secret once, never the URL, and a later read has no secret", async () => {
	const created = await create({ name: "Chat bridge", events: ["backup.failed", "certificate.expiring"] });
	assert.equal(created.status, 201);
	assert.match(created.body.secret, WHSEC);
	assert.equal(created.body.url, undefined);
	assert.equal(created.body.url_hint, "https://hooks.example.com/in/hook");
	assert.equal(created.body.url_set, true);
	assert.equal(created.body.secret_set, true);
	assert.equal(created.body.secret_error, false);
	assert.equal(created.body.enabled, true);
	assert.equal(created.body.verify_tls, true);
	assert.equal(created.body.disabled_reason, null);
	assert.deepEqual(created.body.events, ["backup.failed", "certificate.expiring"]);
	assert.equal(created.body.last_delivery, null);
	const { id } = created.body;
	const got = await admin.get(`/webhooks/${id}`);
	assert.equal(got.status, 200);
	assert.equal(got.body.secret, undefined);
	assert.equal(got.body.url, undefined);
	assert.equal(got.body.name, "Chat bridge");
	const listed = await admin.get("/webhooks");
	assert.equal(listed.status, 200);
	const found = listed.body.find((item) => item.id === id);
	assert.equal(found.secret, undefined);
	assert.equal(found.url, undefined);
	assert.equal(found.previous_secret, undefined);
	const stored = await row(id);
	assert.match(stored.url, SEALED);
	assert.notEqual(stored.url, URL_WITH_TOKEN);
	assert.equal(defaultSecretBox.decrypt(stored.url), URL_WITH_TOKEN);
	assert.match(stored.secret, SEALED);
	assert.notEqual(stored.secret, created.body.secret);
	assert.equal(defaultSecretBox.decrypt(stored.secret), created.body.secret);
});

it("refuses a taken name in any letter case, and reads of an unknown or malformed id", async () => {
	const first = await create({ name: "Unique Name" });
	assert.equal(first.status, 201);
	const taken = await create({ name: "unique name" });
	assert.equal(taken.status, 400);
	assert.equal(taken.body.error.message_i18n, "error.webhook-name-taken");
	assert.equal((await admin.get("/webhooks/99999")).status, 404);
	assert.equal((await admin.get("/webhooks/abc")).status, 400);
	assert.equal((await admin.put("/webhooks/99999", { enabled: false })).status, 404);
	assert.equal((await admin.delete("/webhooks/99999")).status, 404);
	assert.equal((await admin.post("/webhooks/99999/test", {})).status, 404);
	assert.equal((await admin.post("/webhooks/99999/rotate-secret", {})).status, 404);
	assert.equal((await admin.get("/webhooks/99999/deliveries")).status, 404);
	const missing = await admin.post("/webhooks", { url: URL_WITH_TOKEN, events: ["backup.failed"] });
	assert.equal(missing.status, 400);
});

it("answers a translated key for each URL problem, and refuses loopback, an unresolved name and a failed lookup", async () => {
	const cases = [
		["not a url", "error.webhook-url-invalid"],
		["ftp://hooks.example.com/x", "error.webhook-url-scheme"],
		["https://user@hooks.example.com/x", "error.webhook-url-userinfo"],
		["https://127.0.0.1/", "error.webhook-host-blocked"],
		["http://127.0.0.1:8080/", "error.webhook-host-blocked"],
		["https://loop.example.com/x", "error.webhook-host-blocked"],
		["http://hooks.example.com/x", "error.webhook-host-blocked"],
		["https://nowhere.example.com/x", "error.webhook-host-unresolved"],
	];
	for (const [url, key] of cases) {
		const refused = await create({ url });
		assert.equal(refused.status, 400, url);
		assert.equal(refused.body.error.message_i18n, key, url);
	}
	// a resolver outage is its own answer: the admin may try again
	const lookup = dns.lookup;
	dns.lookup = (_host, _options, callback) => {
		const done = typeof _options === "function" ? _options : callback;
		done(Object.assign(new Error("try again"), { code: "EAI_AGAIN" }));
	};
	try {
		const outage = await create({ url: "https://flaky.example.com/x" });
		assert.equal(outage.status, 400);
		assert.equal(outage.body.error.message_i18n, "error.webhook-host-lookup-failed");
	} finally {
		dns.lookup = lookup;
	}
	assert.equal((await knex("npmpro_webhook").where({ url_hint: "https://127.0.0.1/" })).length, 0);
});

it("checks the events: a list of selectable ids or *, never notification.test or an unknown id", async () => {
	const all = await create({ events: ["backup.failed", "*"] });
	assert.equal(all.status, 201);
	assert.deepEqual(all.body.events, ["*"]);
	const repeated = await create({ events: ["backup.failed", "backup.failed", "host.created"] });
	assert.deepEqual(repeated.body.events, ["backup.failed", "host.created"]);
	for (const events of [["notification.test"], ["no.such.event"]]) {
		const refused = await create({ events });
		assert.equal(refused.status, 400, textOf(events));
		assert.equal(refused.body.error.message_i18n, "error.notify-event-not-for-webhook");
	}
	assert.equal((await create({ events: [] })).status, 400);
});

it("seals the URL and the secrets on every write path: create, a new URL, rotate and the restored re-enable", async () => {
	const created = await create();
	const { id } = created.body;
	// a new URL
	const moved = "https://hooks.example.com/other?token=zzz";
	const stored = await row(id);
	const updated = await admin.put(`/webhooks/${id}`, { url: moved });
	assert.equal(updated.status, 200);
	assert.equal(updated.body.secret, undefined);
	const afterUrl = await row(id);
	assert.notEqual(afterUrl.url, stored.url);
	assert.notEqual(afterUrl.url, moved);
	assert.match(afterUrl.url, SEALED);
	assert.equal(defaultSecretBox.decrypt(afterUrl.url), moved);
	assert.equal(afterUrl.url_hint, "https://hooks.example.com/other");
	assert.equal(afterUrl.secret, stored.secret);
	// rotate: the new secret and the old one as the previous secret
	const rotated = await admin.post(`/webhooks/${id}/rotate-secret`, {});
	assert.equal(rotated.status, 200);
	assert.match(rotated.body.secret, WHSEC);
	assert.notEqual(rotated.body.secret, created.body.secret);
	const afterRotate = await row(id);
	assert.match(afterRotate.secret, SEALED);
	assert.notEqual(afterRotate.secret, rotated.body.secret);
	assert.equal(defaultSecretBox.decrypt(afterRotate.secret), rotated.body.secret);
	assert.match(afterRotate.previous_secret, SEALED);
	assert.notEqual(afterRotate.previous_secret, created.body.secret);
	assert.equal(defaultSecretBox.decrypt(afterRotate.previous_secret), created.body.secret);
	const until = msOfDbTime(afterRotate.previous_secret_until) - Date.now();
	assert.ok(until > DAY - 120_000 && until <= DAY, `the old secret signs for 24 hours (${until})`);
	// a webhook restored without secrets: it needs its URL, gets a new secret, answered once
	const restored = await create();
	await knex("npmpro_webhook")
		.where({ id: restored.body.id })
		.update({ url: "", secret: "", enabled: false, disabled_reason: "restore" });
	const shown = await admin.get(`/webhooks/${restored.body.id}`);
	assert.equal(shown.body.url_set, false);
	assert.equal(shown.body.secret_set, false);
	assert.equal(shown.body.disabled_reason, "restore");
	const needsUrl = await admin.put(`/webhooks/${restored.body.id}`, { enabled: true });
	assert.equal(needsUrl.status, 400);
	assert.equal(needsUrl.body.error.message_i18n, "error.webhook-url-required");
	const again = await admin.put(`/webhooks/${restored.body.id}`, { url: URL_WITH_TOKEN, enabled: true });
	assert.equal(again.status, 200);
	assert.match(again.body.secret, WHSEC);
	assert.equal(again.body.enabled, true);
	assert.equal(again.body.disabled_reason, null);
	const afterRestore = await row(restored.body.id);
	assert.notEqual(afterRestore.url, URL_WITH_TOKEN);
	assert.equal(defaultSecretBox.decrypt(afterRestore.url), URL_WITH_TOKEN);
	assert.notEqual(afterRestore.secret, again.body.secret);
	assert.equal(defaultSecretBox.decrypt(afterRestore.secret), again.body.secret);
	assert.equal(afterRestore.previous_secret, null);
	assert.equal((await admin.get(`/webhooks/${restored.body.id}`)).body.secret, undefined);
});

it("updates: an empty url keeps it, a refused new url changes nothing, enabling clears the reason and the failing period", async () => {
	const created = await create();
	const { id } = created.body;
	const stored = await row(id);
	const kept = await admin.put(`/webhooks/${id}`, { url: "", name: "renamed", events: ["*"], verify_tls: false });
	assert.equal(kept.status, 200);
	assert.equal(kept.body.name, "renamed");
	assert.deepEqual(kept.body.events, ["*"]);
	assert.equal(kept.body.verify_tls, false);
	assert.equal((await row(id)).url, stored.url);
	const refused = await admin.put(`/webhooks/${id}`, { url: "https://127.0.0.1/x" });
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.message_i18n, "error.webhook-host-blocked");
	assert.equal((await row(id)).url, stored.url);
	const clash = await admin.put(`/webhooks/${id}`, { name: "Unique Name" });
	assert.equal(clash.body.error.message_i18n, "error.webhook-name-taken");
	assert.equal((await admin.put(`/webhooks/${id}`, { name: "renamed" })).status, 200);
	assert.equal((await admin.put(`/webhooks/${id}`, {})).status, 400);
	await knex("npmpro_webhook")
		.where({ id })
		.update({ enabled: false, disabled_reason: "failing", failing_since: sql(Date.now() - DAY) });
	const enabled = await admin.put(`/webhooks/${id}`, { enabled: true });
	assert.equal(enabled.body.enabled, true);
	assert.equal(enabled.body.disabled_reason, null);
	assert.equal(enabled.body.failing_since, null);
});

it("a save that keeps a webhook on leaves its failing period running; only turning it on clears it", async () => {
	const { id } = (await create()).body;
	const since = sql(Date.now() - DAY);
	await knex("npmpro_webhook").where({ id }).update({ failing_since: since });
	const kept = await admin.put(`/webhooks/${id}`, { enabled: true, name: uniqueName() });
	assert.equal(kept.status, 200);
	assert.equal(kept.body.enabled, true);
	assert.notEqual(kept.body.failing_since, null);
	assert.equal((await row(id)).failing_since, since);
});

it("disabling drops the pending deliveries, and deleting removes the webhook with its deliveries", async () => {
	const { id } = (await create()).body;
	const pending = await delivery(id, { status: "pending", attempts: 0 });
	const sent = await delivery(id, { status: "sent", payload: null });
	const disabled = await admin.put(`/webhooks/${id}`, { enabled: false });
	assert.equal(disabled.body.enabled, false);
	const rows = await knex("npmpro_notification_delivery").whereIn("id", [pending.id, sent.id]).orderBy("id");
	assert.deepEqual(
		rows.map((item) => item.status),
		["dropped", "sent"],
	);
	assert.equal(rows[0].payload, null);
	const other = (await create()).body.id;
	const otherRow = await delivery(other, { status: "sent", payload: null });
	assert.equal((await admin.delete(`/webhooks/${id}`)).body, true);
	assert.equal(await row(id), undefined);
	assert.equal((await knex("npmpro_notification_delivery").where({ target_id: id, channel: "webhook" })).length, 0);
	assert.ok(
		await knex("npmpro_notification_delivery").where({ id: otherRow.id }).first(),
		"other webhooks keep theirs",
	);
});

it("sends a test delivery: signed for the secret, 200 with the outcome, a 500 as ok false", async () => {
	const created = await create();
	const calls = receiver({ statusCode: 200, data: "received" });
	const sent = await testCall(created.body.id);
	assert.equal(sent.status, 200);
	assert.equal(sent.body.ok, true);
	assert.equal(sent.body.http_status, 200);
	assert.equal(sent.body.response, "received");
	assert.equal(sent.body.error, null);
	assert.equal(typeof sent.body.duration_ms, "number");
	assert.equal(calls.length, 1);
	const body = JSON.parse(calls[0].body);
	assert.equal(body.type, "notification.test");
	new StandardWebhook(created.body.secret).verify(calls[0].body, calls[0].headers);
	assert.equal((await knex("npmpro_notification_delivery").where({ target_id: created.body.id })).length, 0);
	receiver({ statusCode: 500, data: "broke" });
	const failed = await testCall(created.body.id);
	assert.equal(failed.status, 200);
	assert.equal(failed.body.ok, false);
	assert.equal(failed.body.http_status, 500);
	assert.equal(failed.body.response, "broke");
	assert.match(failed.body.error, STATUS_500);
	const state = await row(created.body.id);
	assert.equal(state.failing_since, null);
	assert.equal(Boolean(Number(state.enabled)), true);
});

it("a test hides the URL, its query and the secret in what the receiver echoes", async () => {
	const created = await create();
	receiver((options) => ({ statusCode: 502, data: `bad gateway for ${BASE}${options.path} ${created.body.secret}` }));
	const failed = await testCall(created.body.id);
	assert.equal(failed.body.ok, false);
	assert.doesNotMatch(failed.text, TOKEN_IN_QUERY);
	assert.equal(failed.text.includes(created.body.secret), false);
	assert.match(failed.body.response, HIDDEN);
});

it("refuses a test of a webhook without a URL, and a receiver that is not reachable is ok false", async () => {
	const created = await create();
	await knex("npmpro_webhook")
		.where({ id: created.body.id })
		.update({ url: "", enabled: false, disabled_reason: "restore" });
	const refused = await testCall(created.body.id);
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.message_i18n, "error.webhook-url-required");
	const unreachable = await create({ url: "https://hooks.example.com/no-mock" });
	const failed = await testCall(unreachable.body.id);
	assert.equal(failed.status, 200);
	assert.equal(failed.body.ok, false);
	assert.equal(failed.body.http_status, null);
	assert.equal(typeof failed.body.error, "string");
});

it("rotating keeps the old secret for 24 hours: a test carries both signatures", async () => {
	const created = await create();
	const rotated = await admin.post(`/webhooks/${created.body.id}/rotate-secret`, {});
	const calls = receiver();
	assert.equal((await testCall(created.body.id)).body.ok, true);
	assert.match(calls[0].headers["webhook-signature"], TWO_SIGNATURES);
	new StandardWebhook(rotated.body.secret).verify(calls[0].body, calls[0].headers);
	new StandardWebhook(created.body.secret).verify(calls[0].body, calls[0].headers);
});

it("lists the deliveries newest first, in pages, never their content", async () => {
	const { id } = (await create()).body;
	const ids = [];
	for (let at = 0; at < 7; at += 1) {
		ids.push((await delivery(id, at === 0 ? { payload: null } : {})).id);
	}
	const first = await admin.get(`/webhooks/${id}/deliveries?limit=3`);
	assert.equal(first.status, 200);
	assert.equal(first.headers.get("x-total-count"), "7");
	assert.deepEqual(
		first.body.map((item) => item.id),
		[ids[6], ids[5], ids[4]],
	);
	const second = await admin.get(`/webhooks/${id}/deliveries?limit=3&offset=3`);
	assert.deepEqual(
		second.body.map((item) => item.id),
		[ids[3], ids[2], ids[1]],
	);
	const last = await admin.get(`/webhooks/${id}/deliveries?limit=3&offset=6`);
	assert.deepEqual(
		last.body.map((item) => item.id),
		[ids[0]],
	);
	assert.equal(last.body[0].redeliverable, false);
	assert.equal(first.body[0].redeliverable, true);
	for (const item of [...first.body, ...second.body]) {
		assert.equal(item.payload, undefined);
		assert.equal(item.target_id, undefined);
		assert.equal(item.status, "failed");
	}
	assert.equal(first.text.includes("disk full"), false);
	assert.equal((await admin.get(`/webhooks/${id}/deliveries?limit=101`)).status, 400);
	assert.equal((await admin.get(`/webhooks/${id}/deliveries?offset=-1`)).status, 400);
	const defaults = await admin.get(`/webhooks/${id}/deliveries`);
	assert.equal(defaults.body.length, 7);
	const listed = (await admin.get("/webhooks")).body.find((item) => item.id === id);
	assert.equal(listed.last_delivery.status, "failed");
});

it("redelivers a failed row: the same row and the same webhook-id at the receiver", async () => {
	const created = await create();
	const failed = await delivery(created.body.id);
	const calls = receiver();
	const queued = await admin.post(`/webhooks/${created.body.id}/deliveries/${failed.id}/redeliver`, {});
	assert.equal(queued.status, 200);
	assert.equal(queued.body.id, failed.id);
	assert.equal(queued.body.message_id, failed.message);
	assert.equal(queued.body.status, "pending");
	await pass();
	assert.equal(calls.length, 1);
	assert.equal(calls[0].headers["webhook-id"], failed.message);
	assert.equal(JSON.parse(calls[0].body).data.error, "disk full");
	new StandardWebhook(created.body.secret).verify(calls[0].body, calls[0].headers);
	const done = await knex("npmpro_notification_delivery").where({ id: failed.id }).first();
	assert.equal(done.status, "sent");
	assert.equal(done.message_id, failed.message);
	assert.equal(done.payload, null);
	const ok = await admin.get(`/webhooks/${created.body.id}`);
	assert.notEqual(ok.body.last_success_on, null);
	const gone = await admin.post(`/webhooks/${created.body.id}/deliveries/${failed.id}/redeliver`, {});
	assert.equal(gone.status, 409);
	assert.equal(gone.body.error.message_i18n, "error.webhook-payload-gone");
});

it("answers 409 for a row whose payload is gone, a row not failed, a disabled webhook, and 404 for a row of another webhook", async () => {
	const created = await create();
	const old = await delivery(created.body.id, { payload: null });
	const gone = await admin.post(`/webhooks/${created.body.id}/deliveries/${old.id}/redeliver`, {});
	assert.equal(gone.status, 409);
	assert.equal(gone.body.error.message_i18n, "error.webhook-payload-gone");
	const waiting = await delivery(created.body.id, { status: "pending", attempts: 1, next_try_on: later() });
	const busy = await admin.post(`/webhooks/${created.body.id}/deliveries/${waiting.id}/redeliver`, {});
	assert.equal(busy.status, 409);
	assert.equal(busy.body.error.message_i18n, "error.webhook-delivery-not-failed");
	const failed = await delivery(created.body.id);
	await admin.put(`/webhooks/${created.body.id}`, { enabled: false });
	const off = await admin.post(`/webhooks/${created.body.id}/deliveries/${failed.id}/redeliver`, {});
	assert.equal(off.status, 409);
	assert.equal(off.body.error.message_i18n, "error.webhook-disabled");
	// the list says the same: nothing can be redelivered while the webhook is off, and again once it is on
	const listed = await admin.get(`/webhooks/${created.body.id}/deliveries`);
	assert.equal(listed.body.find((item) => item.id === failed.id).redeliverable, false);
	await admin.put(`/webhooks/${created.body.id}`, { enabled: true });
	const back = await admin.get(`/webhooks/${created.body.id}/deliveries`);
	assert.equal(back.body.find((item) => item.id === failed.id).redeliverable, true);
	// a pending row keeps its payload, but only a failed one can be sent again (the disable dropped the first one)
	const pending = await delivery(created.body.id, { status: "pending", attempts: 1, next_try_on: later() });
	const rows = (await admin.get(`/webhooks/${created.body.id}/deliveries`)).body;
	assert.equal(rows.find((item) => item.id === pending.id).redeliverable, false);
	const other = await create();
	assert.equal((await admin.post(`/webhooks/${other.body.id}/deliveries/${failed.id}/redeliver`, {})).status, 404);
	assert.equal((await admin.post(`/webhooks/${other.body.id}/deliveries/99999/redeliver`, {})).status, 404);
});

it("prunes a webhook's finished deliveries to 100 and 30 days through the sweep", async () => {
	const { id } = (await create()).body;
	const old = sql(Date.now() - 40 * DAY);
	const recent = sql(Date.now() - 1000);
	for (let at = 0; at < 3; at += 1) await delivery(id, { status: "sent", payload: null, modified_on: old });
	for (let at = 0; at < 105; at += 1) await delivery(id, { status: "sent", payload: null, modified_on: recent });
	const keep = await delivery(id, { status: "pending", attempts: 0, modified_on: old, next_try_on: later() });
	await sweep.runOnce();
	const rows = await knex("npmpro_notification_delivery").where({ channel: "webhook", target_id: id });
	assert.equal(rows.filter((item) => item.status === "sent").length, 100);
	assert.ok(rows.every((item) => item.status !== "sent" || item.modified_on === recent));
	assert.ok(
		rows.some((item) => item.id === keep.id),
		"a pending row is never pruned",
	);
});

it("audits created, updated, secret-rotated, test-sent, deleted and a disable by the channel, without URL or secret", async () => {
	const created = await create({ name: "Audited" });
	const { id } = created.body;
	await admin.put(`/webhooks/${id}`, { name: "Audited too" });
	await admin.post(`/webhooks/${id}/rotate-secret`, {});
	receiver();
	await testCall(id);
	// the receiver says 410: the channel disables the webhook (user 0)
	await delivery(id, { status: "pending", attempts: 0, next_try_on: null });
	receiver({ statusCode: 410, data: "gone" });
	await pass();
	assert.equal((await admin.get(`/webhooks/${id}`)).body.disabled_reason, "gone");
	await admin.delete(`/webhooks/${id}`);
	const audit = await knex("audit_log").where({ object_type: "webhook", object_id: id }).orderBy("id");
	assert.deepEqual(
		audit.map((item) => item.action),
		["created", "updated", "secret-rotated", "test-sent", "disabled", "deleted"],
	);
	for (const item of audit) {
		const meta = typeof item.meta === "string" ? JSON.parse(item.meta) : item.meta;
		const keys = Object.keys(meta).toSorted((left, right) => left.localeCompare(right));
		assert.deepEqual(
			keys,
			item.action === "disabled" ? ["events", "id", "name", "reason"] : ["events", "id", "name"],
		);
		assert.equal(meta.id, id);
		assert.deepEqual(meta.events, ["backup.failed"]);
	}
	assert.equal(Number(audit[4].user_id), 0);
	assert.equal(Number(audit[0].user_id) > 0, true);
});

it("never shows the URL, its query or a secret in an answer, an audit row, a delivery row or the log", async () => {
	const secrets = [SECRET_TOKEN];
	const created = await create({ name: "Quiet" });
	secrets.push(created.body.secret);
	const { id } = created.body;
	const answers = [];
	answers.push((await admin.get("/webhooks")).text, (await admin.get(`/webhooks/${id}`)).text);
	receiver({ statusCode: 500, data: `echo ${URL_WITH_TOKEN} ${created.body.secret}` });
	answers.push((await testCall(id)).text);
	const rotated = await admin.post(`/webhooks/${id}/rotate-secret`, {});
	secrets.push(rotated.body.secret);
	answers.push((await admin.put(`/webhooks/${id}`, { events: ["*"] })).text);
	// a queued delivery that fails: its row holds the error and the cut answer
	const queued = await delivery(id, { status: "pending", attempts: 0 });
	receiver({ statusCode: 500, data: `echo ${URL_WITH_TOKEN} ${rotated.body.secret}` });
	await pass();
	answers.push((await admin.get(`/webhooks/${id}/deliveries`)).text);
	const rows = await knex("npmpro_notification_delivery").where({ id: queued.id });
	assert.equal(rows[0].status, "pending");
	const audit = await knex("audit_log").where({ object_type: "webhook", object_id: id });
	const everything = [...answers, textOf(rows), textOf(audit), logged.join("\n")].join("\n");
	for (const secret of secrets) assert.equal(everything.includes(secret), false, `no ${secret.slice(0, 8)}`);
	assert.equal(everything.includes("hooks.example.com/in/hook?"), false);
	assert.equal(textOf(audit).includes("hooks.example.com"), false);
});

it("holds to the permissions: an administrator session and token, no other user, token or visitor", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id } = (await create()).body;
	const calls = [
		["GET", "/webhooks"],
		["POST", "/webhooks"],
		["GET", `/webhooks/${id}`],
		["PUT", `/webhooks/${id}`],
		["POST", `/webhooks/${id}/test`],
		["POST", `/webhooks/${id}/rotate-secret`],
		["GET", `/webhooks/${id}/deliveries`],
		["POST", `/webhooks/${id}/deliveries/1/redeliver`],
		["DELETE", `/webhooks/${id}`],
	];
	const view = await bearer({ isAdmin: false, allowDelete: true });
	for (const [method, url] of calls) {
		const body = method === "GET" || method === "DELETE" ? undefined : {};
		assert.equal((await user.send(method, url, { body })).status, 403, `${method} ${url} user`);
		assert.equal((await api.client().send(method, url, { body })).status, 401, `${method} ${url} visitor`);
		const response = await view[method.toLowerCase()](url, body);
		assert.equal(response.status, 403, `${method} ${url} view token`);
	}
	// an administrator's token works; DELETE needs its Allow delete switch
	const token = await bearer();
	assert.equal((await token.get("/webhooks")).status, 200);
	// create, update and rotate are session only: an administrator's token is refused
	const denied = await token.post("/webhooks", { name: uniqueName(), url: URL_WITH_TOKEN, events: ["*"] });
	assert.equal(denied.status, 403);
	const made = await create();
	assert.equal((await token.put(`/webhooks/${made.body.id}`, { enabled: false })).status, 403);
	assert.equal((await token.post(`/webhooks/${made.body.id}/rotate-secret`, {})).status, 403);
	assert.equal((await token.get(`/webhooks/${made.body.id}`)).status, 200);
	assert.equal((await token.delete(`/webhooks/${made.body.id}`)).status, 403);
	const deleter = await bearer({ allowDelete: true });
	assert.equal((await deleter.delete(`/webhooks/${made.body.id}`)).status, 200);
	// the audit row of the delete names the token that acted
	const tokenRow = await knex("audit_log")
		.where({ object_type: "webhook", object_id: made.body.id, action: "deleted" })
		.orderBy("id", "desc")
		.first();
	assert.equal(tokenRow.npmpro_api_token_name, deleter.name);
});

it("limits the test route to 5 a minute per address and one at a time", async () => {
	const { id } = (await create()).body;
	const client = await bearer();
	const statuses = [];
	for (let at = 0; at < 6; at += 1) statuses.push((await client.post(`/webhooks/${id}/test`, {})).status);
	assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
	assert.equal(statuses[5], 429);
});

it("runs one test at a time per webhook: two webhooks tested at once both run, the same one twice answers 429", async () => {
	const first = (await create()).body.id;
	const second = (await create()).body.id;
	api.outside.http
		.get(BASE)
		.intercept({ path: `${PATH}${QUERY}`, method: "POST" })
		.reply(200, "slow")
		.delay(300)
		.times(2);
	// the clients are made one after another (their names are counted), the tests run at once
	const clients = [await bearer(), await bearer(), await bearer(), await bearer()];
	const sendTestWith = (client, id) => client.post(`/webhooks/${id}/test`, {});
	const both = await Promise.all([sendTestWith(clients[0], first), sendTestWith(clients[1], second)]);
	assert.deepEqual(
		both.map((answer) => [answer.status, answer.body.ok]),
		[
			[200, true],
			[200, true],
		],
	);
	api.outside.http
		.get(BASE)
		.intercept({ path: `${PATH}${QUERY}`, method: "POST" })
		.reply(200, "slow")
		.delay(300);
	const [running, again] = await Promise.all([
		sendTestWith(clients[2], first),
		new Promise((resolve) => setTimeout(resolve, 100)).then(() => sendTestWith(clients[3], first)),
	]);
	assert.equal(running.status, 200);
	assert.equal(again.status, 429);
});

it("a test hides the part of the path the hint does not show, also when the receiver echoes only the token", async () => {
	const token = "pAtHt0kEnAbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
	const path = `/api/webhooks/123/${token}`;
	const created = await create({ url: `${BASE}${path}` });
	api.outside.http
		.get(BASE)
		.intercept({ path, method: "POST" })
		.reply(404, `Cannot POST ${path} (token ${token}, {"path":"${path.replaceAll("/", "\\/")}"})`);
	const failed = await testCall(created.body.id);
	assert.equal(failed.body.http_status, 404);
	const shown = created.body.url_hint.slice(BASE.length + "/api/webhooks/123/".length);
	assert.ok(shown.length > 0 && shown.length < token.length);
	assert.equal(failed.body.response.includes(token), false, failed.body.response);
	assert.equal(failed.body.response.includes(token.slice(shown.length)), false);
	assert.match(failed.body.response, HIDDEN);
});

it("refuses to enable a webhook whose secret or URL cannot be opened, until it is rotated or saved again", async () => {
	const { id } = (await create()).body;
	await admin.put(`/webhooks/${id}`, { enabled: false });
	await knex("npmpro_webhook").where({ id }).update({ secret: "v1:bad:bad:bad" });
	assert.equal((await admin.get(`/webhooks/${id}`)).body.secret_error, true);
	const refused = await admin.put(`/webhooks/${id}`, { enabled: true });
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.message_i18n, "error.webhook-secret-unusable");
	assert.equal((await admin.post(`/webhooks/${id}/rotate-secret`, {})).status, 200);
	assert.equal((await admin.put(`/webhooks/${id}`, { enabled: true })).body.enabled, true);
});

it("a restored webhook saved with its URL and no enabled switch is on again, with an explicit false it stays off", async () => {
	const restore = async () => {
		const { id } = (await create()).body;
		await knex("npmpro_webhook")
			.where({ id })
			.update({ url: "", secret: "", enabled: false, disabled_reason: "restore" });
		return id;
	};
	const on = await admin.put(`/webhooks/${await restore()}`, { url: URL_WITH_TOKEN });
	assert.equal(on.body.enabled, true);
	assert.equal(on.body.disabled_reason, null);
	const off = await admin.put(`/webhooks/${await restore()}`, { url: URL_WITH_TOKEN, enabled: false });
	assert.equal(off.body.enabled, false);
	assert.equal(off.body.disabled_reason, null);
});

it("the production agent still refuses a loopback target with the test environment values set", async () => {
	assert.equal(process.env.NPMPRO_TEST_OUTBOUND, "mock");
	assert.ok(process.env.NPMPRO_TEST_ROOT);
	setWebhookAgentFactory(createGuardedAgent);
	try {
		const { id } = (await create()).body;
		await knex("npmpro_webhook")
			.where({ id })
			.update({ url: defaultSecretBox.encrypt("http://127.0.0.1:9/x") });
		const hook = await row(id);
		const result = await webhookChannel.sendTest(hook);
		assert.equal(result.ok, false);
		assert.match(result.error, MAY_NOT_REACH);
	} finally {
		setWebhookAgentFactory(() => undefined);
	}
});
