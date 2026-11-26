import assert from "node:assert/strict";
import net from "node:net";
import { after, before, it } from "node:test";
import { generateApiToken } from "../lib/api-token.js";
import { startApi } from "./support/api.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

// The alert settings of Settings, Notifications and the events route through the real app.

const STATE_EVENTS = [
	"certificate.expiring",
	"certificate.renewal_failed",
	"host.config_error",
	"backup.failed",
	"geoip.failed",
	"crowdsec.unreachable",
	"ddns.record_failed",
	"ddns.record_stopped",
];
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const NOT_FOR_MAIL = "error.notify-event-not-for-mail";
const ADDRESSES_INVALID = "settings.notifications.alerts-addresses.invalid";

const unwrap = (raw) => raw.replace(/[=]\r?\n/gu, "");
const SUBJECT_SAMPLE = /^Subject: \[NPMpro [^\]]*\] Sample: /mu;
const RECIPIENT = /^To: (?<address>.+)$/mu;
const NO_SUCH_USER = /no such user/u;
const TOO_MANY = /Too many requests/u;

let api;
let admin;
let accept;
let flaky;

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
	admin = await api.admin();
	accept = await startFakeSmtp();
	flaky = await startFakeSmtp({ rejectTo: ["bad@"] });
});
after(async () => {
	delete process.env.ALERT_ADDRESSES;
	await accept?.close();
	await flaky?.close();
	await api?.stop();
});

it("starts with the defaults: admins, no extra address, every state event, a reminder every 24 hours", async () => {
	const got = await admin.get("/settings/notifications");
	assert.equal(got.status, 200);
	assert.equal(got.body.alerts_admins, true);
	assert.deepEqual(got.body.alerts_addresses, []);
	assert.deepEqual(got.body.alerts_events, STATE_EVENTS);
	assert.equal(got.body.reminder_hours, 24);
	assert.deepEqual(got.body.config_errors, []);
});

it("saves the four keys and answers them back", async () => {
	const patch = {
		alerts_admins: false,
		alerts_addresses: ["ops@example.com", "Oncall@Example.com"],
		alerts_events: ["backup.failed", "webhook.disabled"],
		reminder_hours: 0,
	};
	const saved = await admin.put("/settings/notifications", patch);
	assert.equal(saved.status, 200, JSON.stringify(saved.body));
	for (const [key, value] of Object.entries(patch)) assert.deepEqual(saved.body[key], value, key);
	assert.deepEqual((await admin.get("/settings/notifications")).body.alerts_events, patch.alerts_events);
	const restored = await admin.put("/settings/notifications", {
		alerts_admins: true,
		alerts_addresses: [],
		alerts_events: STATE_EVENTS,
		reminder_hours: 168,
	});
	assert.equal(restored.status, 200);
	assert.equal(restored.body.reminder_hours, 168);
});

it("refuses an action event, a wildcard and an unknown id in alerts_events", async () => {
	for (const events of [
		["host.created"],
		["backup.failed", "backup.succeeded"],
		["*"],
		["nope"],
		["notification.test"],
	]) {
		const refused = await admin.put("/settings/notifications", { alerts_events: events });
		assert.equal(refused.status, 400, JSON.stringify(events));
		assert.equal(refused.body.error.message_i18n, NOT_FOR_MAIL, JSON.stringify(events));
	}
	const refused = await admin.put("/settings/notifications", { alerts_events: ["host.created"] });
	assert.equal(refused.body.error.message_values.event, "host.created");
	// nothing was saved
	assert.deepEqual((await admin.get("/settings/notifications")).body.alerts_events, STATE_EVENTS);
});

it("accepts webhook.disabled and refuses a .resolved id: ticking the base event covers its recovery", async () => {
	const saved = await admin.put("/settings/notifications", { alerts_events: ["webhook.disabled", "backup.failed"] });
	assert.equal(saved.status, 200);
	for (const id of ["backup.failed.resolved", "webhook.disabled.resolved"]) {
		const refused = await admin.put("/settings/notifications", { alerts_events: [id] });
		assert.equal(refused.status, 400, id);
		assert.equal(refused.body.error.message_i18n, NOT_FOR_MAIL);
	}
	await admin.put("/settings/notifications", { alerts_events: STATE_EVENTS });
});

it("saves alerts_events and alerts_addresses without repeats", async () => {
	const saved = await admin.put("/settings/notifications", {
		alerts_events: ["backup.failed", "backup.failed", "geoip.failed"],
		alerts_addresses: ["Ops@Example.com", "ops@example.com", "other@example.com", "OTHER@example.com"],
	});
	assert.equal(saved.status, 200);
	assert.deepEqual(saved.body.alerts_events, ["backup.failed", "geoip.failed"]);
	assert.deepEqual(saved.body.alerts_addresses, ["Ops@Example.com", "other@example.com"]);
	// a long list of repeats is a list of one
	const repeated = await admin.put("/settings/notifications", {
		alerts_events: Array.from({ length: 50 }, () => "backup.failed"),
	});
	assert.deepEqual(repeated.body.alerts_events, ["backup.failed"]);
	await admin.put("/settings/notifications", { alerts_events: STATE_EVENTS, alerts_addresses: [] });
});

it("refuses 21 addresses and names the index of a bad address", async () => {
	const many = Array.from({ length: 21 }, (_, index) => `user${index}@example.com`);
	const tooMany = await admin.put("/settings/notifications", { alerts_addresses: many });
	assert.equal(tooMany.status, 400);
	assert.equal(tooMany.body.error.message_i18n, ADDRESSES_INVALID);
	const twenty = await admin.put("/settings/notifications", { alerts_addresses: many.slice(0, 20) });
	assert.equal(twenty.status, 200);

	for (const [list, index] of [
		[["ok@example.com", "not an address"], 1],
		[["a@b.c, d@e.f"], 0],
		[["ok@example.com", "ok2@example.com", "Name <x@example.com>"], 2],
	]) {
		const refused = await admin.put("/settings/notifications", { alerts_addresses: list });
		assert.equal(refused.status, 400, JSON.stringify(list));
		assert.equal(refused.body.error.message_i18n, ADDRESSES_INVALID);
		assert.deepEqual(refused.body.error.message_values, { index });
	}
	await admin.put("/settings/notifications", { alerts_addresses: [] });
});

it("refuses a reminder interval outside 0 to 168 and a non-boolean alerts_admins", async () => {
	for (const patch of [
		{ reminder_hours: -1 },
		{ reminder_hours: 169 },
		{ reminder_hours: 1.5 },
		{ alerts_admins: "yes" },
	]) {
		assert.equal((await admin.put("/settings/notifications", patch)).status, 400, JSON.stringify(patch));
	}
	assert.equal((await admin.put("/settings/notifications", { reminder_hours: 0 })).status, 200);
	assert.equal((await admin.put("/settings/notifications", { reminder_hours: 24 })).status, 200);
});

it("locks alerts_addresses with ALERT_ADDRESSES and ignores a save of it", async () => {
	process.env.ALERT_ADDRESSES = " ops@example.com , Second@example.com,,";
	try {
		const got = await admin.get("/settings/notifications");
		assert.deepEqual(got.body.alerts_addresses, ["ops@example.com", "Second@example.com"]);
		assert.ok(got.body.locked.includes("alerts_addresses"));
		assert.equal(got.body.locked_by.alerts_addresses, "ALERT_ADDRESSES");
		const saved = await admin.put("/settings/notifications", { alerts_addresses: ["other@example.com"] });
		assert.equal(saved.status, 200);
		assert.deepEqual(saved.body.alerts_addresses, ["ops@example.com", "Second@example.com"]);
		const environment = await admin.get("/settings/environment");
		assert.ok(
			environment.body.locked_runtime.some(
				({ group, env }) => group === "notifications" && env === "ALERT_ADDRESSES",
			),
		);
		process.env.ALERT_ADDRESSES = "ok@example.com,broken";
		assert.deepEqual((await admin.get("/settings/notifications")).body.config_errors, ["alerts_addresses"]);
		process.env.ALERT_ADDRESSES = Array.from({ length: 21 }, (_, index) => `user${index}@example.com`).join(",");
		assert.deepEqual((await admin.get("/settings/notifications")).body.config_errors, ["alerts_addresses"]);
	} finally {
		delete process.env.ALERT_ADDRESSES;
	}
	assert.deepEqual((await admin.get("/settings/notifications")).body.alerts_addresses, []);
});

it("lists the events: state events and webhook.disabled for mail, all but the test for webhooks", async () => {
	const got = await admin.get("/notifications/events");
	assert.equal(got.status, 200);
	const forMail = got.body.filter(({ channels }) => channels.includes("mail")).map(({ id }) => id);
	assert.deepEqual(forMail, [...STATE_EVENTS, "webhook.disabled"]);
	assert.ok(!forMail.some((id) => id.endsWith(".resolved")));
	assert.deepEqual(got.body.find(({ id }) => id === "backup.failed.resolved").channels, ["webhook"]);
	assert.ok(!forMail.includes("host.created"));
	const forWebhook = got.body.filter(({ channels }) => channels.includes("webhook")).map(({ id }) => id);
	assert.ok(forWebhook.includes("host.created"));
	assert.ok(forWebhook.includes("webhook.disabled"));
	assert.ok(!got.body.some(({ id }) => id === "notification.test"));
	assert.deepEqual(
		got.body.find(({ id }) => id === "host.created"),
		{
			id: "host.created",
			kind: "action",
			channels: ["webhook"],
		},
	);
});

it("answers the events route to administrators only", async () => {
	const user = await api.limited({
		visibility: "user",
		...Object.fromEntries(SECTIONS.map((section) => [section, "manage"])),
	});
	assert.equal((await user.get("/notifications/events")).status, 403);
	assert.equal((await api.client().get("/notifications/events")).status, 401);
});

// a token of the administrator with its own client (and address), so its rate limit is its own
let tokens = 0;
const bearer = async (isAdmin = true) => {
	tokens += 1;
	const made = generateApiToken();
	const now = Math.floor(Date.now() / 1000);
	await api.db("npmpro_api_token").insert({
		user_id: (await admin.get("/users/me")).body.id,
		name: `token ${tokens}`,
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		visibility: "user",
		...Object.fromEntries(SECTIONS.map((section) => [section, "manage"])),
		is_admin: isAdmin,
		created_on: now,
		expires_on: now + 3600,
	});
	const client = api.client();
	const headers = { authorization: `Bearer ${made.token}` };
	return { post: (url, body) => client.post(url, body, { headers }) };
};
const auditRows = () => api.db("audit_log").where({ object_type: "setting", action: "test-sent" }).orderBy("id", "asc");
const parsed = (meta) => (typeof meta === "string" ? JSON.parse(meta) : meta);
const serverOf = (fake) => ({
	host: "127.0.0.1",
	port: fake.port,
	security: "none",
	from_address: "npmpro@example.com",
});

it("refuses a sample alert while mail is not set up, and from a user, a session-less client and a plain token", async () => {
	const refused = await admin.post("/settings/notifications/test-alert", {});
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.message_i18n, "error.mail-not-configured");
	const user = await api.limited({
		visibility: "user",
		...Object.fromEntries(SECTIONS.map((section) => [section, "manage"])),
	});
	assert.equal((await user.post("/settings/notifications/test-alert", {})).status, 403);
	assert.equal((await api.client().post("/settings/notifications/test-alert", {})).status, 401);
	assert.equal((await (await bearer(false)).post("/settings/notifications/test-alert", {})).status, 403);
});

it("answers error.notify-no-recipients when nobody gets alert mails", async () => {
	assert.equal((await admin.put("/settings/email", serverOf(accept))).status, 200);
	assert.equal(
		(await admin.put("/settings/notifications", { alerts_admins: false, alerts_addresses: [] })).status,
		200,
	);
	const none = await admin.post("/settings/notifications/test-alert", {});
	assert.equal(none.status, 400);
	assert.equal(none.body.error.message_i18n, "error.notify-no-recipients");
	assert.equal(accept.messages.length, 0);
	assert.equal((await auditRows()).length, 0);
});

it("sends one sample mail per recipient with two sample events, in the language of each, and audits it", async () => {
	assert.equal(
		(
			await admin.put("/settings/notifications", {
				alerts_admins: true,
				alerts_addresses: ["ops@example.com", "ADMIN@example.com"],
				default_language: "de",
				public_url: "https://npm.example.test/",
			})
		).status,
		200,
	);
	assert.equal((await admin.put("/users/me/language", { language: "fr" })).status, 204);
	const sent = await admin.post("/settings/notifications/test-alert", {});
	assert.equal(sent.status, 200, sent.text);
	// the admin address is listed too (another case): one mail for it, the other for ops
	assert.deepEqual(sent.body, { sent: 2 });
	assert.equal(accept.messages.length, 2);
	const byTo = Object.fromEntries(
		accept.messages.map((raw) => [RECIPIENT.exec(raw).groups.address.toLowerCase(), unwrap(raw)]),
	);
	const adminMail = byTo["admin@example.com"];
	const opsMail = byTo["ops@example.com"];
	assert.ok(adminMail.includes("Ceci est un e-mail"), "French for the administrator");
	assert.ok(opsMail.includes("Beispiel"), "German for the listed address");
	for (const text of ["example.com", "app.example.com", "https://npm.example.test"])
		assert.ok(opsMail.includes(text), text);
	const rows = await auditRows();
	assert.equal(rows.length, 1);
	assert.deepEqual(parsed(rows[0].meta), { id: "notifications", recipients: 2, failed: 0, skipped: 0 });
	assert.equal(JSON.stringify(rows).includes("ops@example.com"), false);
});

it("puts Sample in the English subject", async () => {
	assert.equal((await admin.put("/users/me/language", { language: "en" })).status, 204);
	assert.equal(
		(await admin.put("/settings/notifications", { alerts_addresses: [], default_language: "en" })).status,
		200,
	);
	const already = accept.messages.length;
	const sent = await admin.post("/settings/notifications/test-alert", {});
	assert.equal(sent.status, 200, sent.text);
	assert.deepEqual(sent.body, { sent: 1 });
	const raw = accept.messages[already];
	assert.match(raw, SUBJECT_SAMPLE);
	assert.ok(unwrap(raw).includes("Certificate example.com expires in 5 days"));
	assert.ok(unwrap(raw).includes("The nginx configuration of app.example.com has an error"));
});

it("tries every recipient when one is refused and names the first failure with its address", async () => {
	assert.equal((await admin.put("/settings/email", serverOf(flaky))).status, 200);
	assert.equal(
		(await admin.put("/settings/notifications", { alerts_addresses: ["bad@example.com", "good@example.com"] }))
			.status,
		200,
	);
	const rowsBefore = (await auditRows()).length;
	const failed = await admin.post("/settings/notifications/test-alert", {});
	assert.equal(failed.status, 400, failed.text);
	assert.equal(failed.body.error.message_i18n, "error.mail-test-failed");
	assert.match(failed.body.error.message_values.error, NO_SUCH_USER);
	assert.equal(failed.body.error.message_values.address, "bad@example.com");
	assert.equal(failed.body.error.message_values.failed, 1);
	assert.equal(failed.body.error.message_values.sent, 2);
	// the others were sent (the admin and good@), and the audit counts the mails that went out
	assert.ok(flaky.messages.some((raw) => raw.includes("To: good@example.com")));
	assert.ok(flaky.messages.some((raw) => raw.includes("To: admin@example.com")));
	const rows = await auditRows();
	assert.equal(rows.length, rowsBefore + 1);
	assert.deepEqual(parsed(rows.at(-1).meta), { id: "notifications", recipients: 2, failed: 1, skipped: 0 });
	assert.equal(failed.body.error.message_values.skipped, 0);
});

it("answers the scrubbed error when the server refuses every recipient, and records no audit row", async () => {
	const reject = await startFakeSmtp({ mode: "rcpt-550" });
	const other = await bearer();
	try {
		assert.equal((await admin.put("/settings/email", serverOf(reject))).status, 200);
		const rowsBefore = (await auditRows()).length;
		const failed = await other.post("/settings/notifications/test-alert", {});
		assert.equal(failed.status, 400);
		assert.equal(failed.body.error.message_i18n, "error.mail-test-failed");
		assert.equal(failed.body.error.message_values.sent, 0);
		assert.equal(failed.body.error.message_values.failed, 3);
		assert.equal((await auditRows()).length, rowsBefore);
	} finally {
		await reject.close();
		await admin.put("/settings/email", serverOf(accept));
	}
});

const TABLES = ["npmpro_notification_delivery", "npmpro_notification_state"];
const countRows = async () =>
	Promise.all(TABLES.map(async (table) => (await api.db(table).count({ n: "*" }).first()).n));

// a server that counts connections and closes each at once, or holds them until released
const startCounter = async ({ hold = false } = {}) => {
	const sockets = new Set();
	let connections = 0;
	const server = net.createServer((socket) => {
		connections += 1;
		sockets.add(socket);
		socket.on("error", () => {});
		if (!hold) socket.destroy();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: server.address().port,
		connections: () => connections,
		release: () => {
			for (const socket of sockets) socket.destroy();
		},
		close: () => new Promise((resolve) => server.close(resolve)),
	};
};

it("stops at a failure of the server: one connection attempt, the rest skipped, no audit", async () => {
	const dead = await startCounter();
	try {
		assert.equal((await admin.put("/settings/email", serverOf(dead))).status, 200);
		assert.equal(
			(
				await admin.put("/settings/notifications", {
					alerts_addresses: ["a@example.com", "b@example.com", "c@example.com"],
				})
			).status,
			200,
		);
		const rowsBefore = (await auditRows()).length;
		const failed = await (await bearer()).post("/settings/notifications/test-alert", {});
		assert.equal(failed.status, 400, failed.text);
		const values = failed.body.error.message_values;
		assert.equal(values.failed, 1);
		assert.equal(values.sent, 0);
		// the administrator and three listed addresses: one tried, three not
		assert.equal(values.skipped, 3);
		assert.equal(dead.connections(), 1);
		assert.equal((await auditRows()).length, rowsBefore);
	} finally {
		await dead.close();
		await admin.put("/settings/email", serverOf(accept));
	}
});

it("keeps the notify tables as they are after a sample", async () => {
	assert.equal((await admin.put("/settings/notifications", { alerts_addresses: ["a@example.com"] })).status, 200);
	const rowsBefore = await countRows();
	const sent = await (await bearer()).post("/settings/notifications/test-alert", {});
	assert.equal(sent.status, 200, sent.text);
	assert.deepEqual(await countRows(), rowsBefore);
});

it("runs one sample at a time: a second request while one runs answers 429", async () => {
	const holding = await startCounter({ hold: true });
	try {
		assert.equal((await admin.put("/settings/email", serverOf(holding))).status, 200);
		const first = (await bearer()).post("/settings/notifications/test-alert", {});
		for (let wait = 0; wait < 200 && holding.connections() === 0; wait += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(holding.connections(), 1, "the first sample is running");
		const second = await (await bearer()).post("/settings/notifications/test-alert", {});
		assert.equal(second.status, 429);
		assert.match(second.body.error.message, TOO_MANY);
		holding.release();
		assert.equal((await first).status, 400);
		assert.equal(holding.connections(), 1, "the second request sent nothing");
	} finally {
		holding.release();
		await holding.close();
		await admin.put("/settings/email", serverOf(accept));
	}
});

it("counts the test mail and the sample together: 5 a minute per address", async () => {
	const other = await bearer();
	for (let n = 0; n < 3; n += 1) assert.equal((await other.post("/settings/email/test", {})).status, 200);
	for (let n = 0; n < 2; n += 1)
		assert.equal((await other.post("/settings/notifications/test-alert", {})).status, 200);
	assert.equal((await other.post("/settings/email/test", {})).status, 429);
	assert.equal((await other.post("/settings/notifications/test-alert", {})).status, 429);
});

it("limits the sample to 5 a minute per address", async () => {
	const other = await bearer();
	let last;
	for (let n = 0; n < 6; n += 1) last = await other.post("/settings/notifications/test-alert", {});
	assert.equal(last.status, 429);
});
