import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

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

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(async () => {
	delete process.env.ALERT_ADDRESSES;
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
