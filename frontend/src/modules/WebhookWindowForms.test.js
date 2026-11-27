import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	isPlainHttp,
	urlMayStayEmpty,
	webhookEventGroups,
	webhookPayload,
	webhookValidate,
	webhookValues,
} from "./WebhookWindowForms.js";

const stored = {
	id: 3,
	name: "Chat bridge",
	urlHint: "https://hooks.example.com/npmpro",
	urlSet: true,
	secretSet: true,
	secretError: false,
	events: ["backup.failed"],
	enabled: true,
	verifyTls: true,
	disabledReason: null,
	failingSince: null,
	lastSuccessOn: null,
	lastDelivery: null,
};

const good = {
	name: "Chat",
	url: "https://hooks.example.com/x",
	allEvents: true,
	events: [],
	verifyTls: true,
	enabled: true,
};

it("accepts a complete new webhook", () => {
	assert.deepEqual(webhookValidate(good, { editing: false }), {});
});

it("asks for a name, a URL and at least one event", () => {
	const errors = webhookValidate({ ...good, name: "  ", url: "", allEvents: false, events: [] }, { editing: false });
	assert.equal(errors.name.id, "error.required");
	assert.equal(errors.url.id, "error.required");
	assert.equal(errors.events.id, "settings.webhooks.events.required");
});

it("lets an edit leave the URL empty, a new or restored webhook not", () => {
	assert.deepEqual(webhookValidate({ ...good, url: "" }, { editing: true }), {});
	assert.equal(webhookValidate({ ...good, url: "" }, { editing: false }).url.id, "error.required");
	assert.equal(urlMayStayEmpty(stored), true);
	assert.equal(urlMayStayEmpty(null), false);
	assert.equal(urlMayStayEmpty({ ...stored, urlSet: false }), false);
	assert.equal(urlMayStayEmpty({ ...stored, enabled: false, disabledReason: "restore" }), false);
});

it("refuses the URLs the backend refuses", () => {
	const idOf = (url) => webhookValidate({ ...good, url }, { editing: false }).url?.id;
	assert.equal(idOf("not a url"), "error.webhook-url-invalid");
	assert.equal(idOf("ftp://hooks.example.com/x"), "error.webhook-url-scheme");
	assert.equal(idOf("https://user:pw@hooks.example.com/x"), "error.webhook-url-userinfo");
	assert.equal(idOf("https://:@hooks.example.com/x"), "error.webhook-url-userinfo");
	assert.equal(idOf(`https://hooks.example.com/${"a".repeat(2050)}`), "error.max-character-length");
	assert.equal(idOf("http://192.168.1.5/hook"), undefined);
	assert.equal(idOf(" https://hooks.example.com/x "), undefined);
});

it("limits the name to 100 characters", () => {
	const errors = webhookValidate({ ...good, name: "n".repeat(101) }, { editing: false });
	assert.deepEqual(errors.name, { id: "error.max-character-length", values: { max: 100 } });
	assert.deepEqual(webhookValidate({ ...good, name: "n".repeat(100) }, { editing: false }), {});
});

it("knows a plain http address", () => {
	assert.equal(isPlainHttp("http://10.0.0.5/hook"), true);
	assert.equal(isPlainHttp(" HTTP://10.0.0.5/hook"), true);
	assert.equal(isPlainHttp("https://hooks.example.com"), false);
	assert.equal(isPlainHttp(""), false);
	assert.equal(isPlainHttp(undefined), false);
});

it("starts a new webhook with all events and a webhook as it is stored", () => {
	assert.deepEqual(webhookValues(null), {
		name: "",
		url: "",
		allEvents: true,
		events: [],
		verifyTls: true,
		enabled: true,
	});
	assert.deepEqual(webhookValues({ ...stored, events: ["*"] }).events, []);
	assert.equal(webhookValues({ ...stored, events: ["*"] }).allEvents, true);
	const values = webhookValues({ ...stored, enabled: false, disabledReason: null });
	assert.deepEqual([values.allEvents, values.events, values.enabled], [false, ["backup.failed"], false]);
	assert.equal(values.url, "");
});

it("starts a webhook restored without its URL enabled", () => {
	const restored = { ...stored, urlSet: false, enabled: false, disabledReason: "restore", urlHint: "" };
	assert.equal(webhookValues(restored).enabled, true);
	// a webhook the receiver turned off stays off until the user turns it on
	assert.equal(webhookValues({ ...stored, enabled: false, disabledReason: "gone" }).enabled, false);
});

it("sends every field of a new webhook", () => {
	const payload = webhookPayload({ ...good, name: " Chat ", url: " https://hooks.example.com/x " }, null);
	assert.deepEqual(payload, {
		name: "Chat",
		url: "https://hooks.example.com/x",
		events: ["*"],
		enabled: true,
		verifyTls: true,
	});
	const chosen = webhookPayload({ ...good, allEvents: false, events: ["backup.failed", "host.created"] }, null);
	assert.deepEqual(chosen.events, ["backup.failed", "host.created"]);
});

it("sends only what changed in an edit and keeps the stored URL when none is typed", () => {
	const same = {
		name: "Chat bridge",
		url: "",
		allEvents: false,
		events: ["backup.failed"],
		verifyTls: true,
		enabled: true,
	};
	assert.equal(webhookPayload(same, stored), null);
	assert.deepEqual(webhookPayload({ ...same, name: "Bridge" }, stored), { name: "Bridge" });
	assert.deepEqual(webhookPayload({ ...same, url: "https://other.example.com/y" }, stored), {
		url: "https://other.example.com/y",
	});
	assert.deepEqual(webhookPayload({ ...same, allEvents: true }, stored), { events: ["*"] });
	assert.deepEqual(webhookPayload({ ...same, verifyTls: false, enabled: false }, stored), {
		verifyTls: false,
		enabled: false,
	});
});

it("sends the URL, the new state and nothing else when a restored webhook is saved again", () => {
	const restored = { ...stored, urlSet: false, enabled: false, disabledReason: "restore", urlHint: "" };
	const values = { ...webhookValues(restored), url: "https://hooks.example.com/x" };
	assert.deepEqual(webhookPayload(values, restored), { url: "https://hooks.example.com/x", enabled: true });
});

const catalogue = [
	{ id: "certificate.expiring", kind: "state", channels: ["mail", "webhook"] },
	{ id: "certificate.expiring.resolved", kind: "state", channels: ["webhook"] },
	{ id: "host.created", kind: "action", channels: ["webhook"] },
	{ id: "backup.failed", kind: "state", channels: ["mail"] },
	{ id: "future.event", kind: "action", channels: ["webhook"] },
	{ id: "webhook.disabled", kind: "action", channels: ["mail", "webhook"] },
];

it("groups the events of the webhook channel by area, a resolved twin under its event", () => {
	const groups = webhookEventGroups(catalogue);
	assert.deepEqual(
		groups.map((group) => [group.area, group.events.map((event) => event.id)]),
		[
			["certificates", ["certificate.expiring", "certificate.expiring.resolved"]],
			["hosts", ["host.created"]],
			["webhooks", ["webhook.disabled"]],
		],
	);
	assert.deepEqual(
		groups[0].events.map((event) => event.resolved),
		[false, true],
	);
});

it("leaves an event the UI has no line for out, and handles no list", () => {
	const ids = webhookEventGroups(catalogue).flatMap((group) => group.events.map((event) => event.id));
	assert.equal(ids.includes("future.event"), false);
	assert.deepEqual(webhookEventGroups(undefined), []);
});

it("has a text for every event line and area", () => {
	const all = webhookEventGroups(
		[
			"certificate.expiring",
			"certificate.expiring.resolved",
			"certificate.renewal_failed",
			"certificate.renewal_failed.resolved",
			"certificate.issued",
			"certificate.renewed",
			"certificate.deleted",
			"host.config_error",
			"host.config_error.resolved",
			"host.created",
			"host.updated",
			"host.deleted",
			"host.enabled",
			"host.disabled",
			"backup.failed",
			"backup.failed.resolved",
			"backup.succeeded",
			"backup.restored",
			"database.moved",
			"database.move_failed",
			"geoip.failed",
			"geoip.failed.resolved",
			"crowdsec.unreachable",
			"crowdsec.unreachable.resolved",
			"ddns.record_failed",
			"ddns.record_failed.resolved",
			"ddns.record_stopped",
			"ddns.record_stopped.resolved",
			"webhook.disabled",
		].map((id) => ({ id, channels: ["webhook"] })),
	);
	assert.equal(all.flatMap((group) => group.events).length, 29);
	const missing = all
		.flatMap((group) => [group.title, ...group.events.map((event) => event.label)])
		.filter((id) => !(id in en));
	assert.deepEqual(missing, []);
});

it("sends enabled as ticked for a restored webhook, also when it stays off", () => {
	const restored = { ...stored, urlSet: false, enabled: false, disabledReason: "restore", urlHint: "" };
	const values = { ...webhookValues(restored), url: "https://hooks.example.com/x", enabled: false };
	assert.deepEqual(webhookPayload(values, restored), { url: "https://hooks.example.com/x", enabled: false });
});

it("compares the events without their order", () => {
	const two = { ...stored, events: ["backup.failed", "host.created"] };
	const same = { ...webhookValues(two), events: ["host.created", "backup.failed"] };
	assert.equal(webhookPayload(same, two), null);
	assert.deepEqual(webhookPayload({ ...same, events: ["host.created"] }, two), { events: ["host.created"] });
});
