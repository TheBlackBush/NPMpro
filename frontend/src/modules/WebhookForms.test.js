import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import { deliveryStateId, eventsLabel, FAILING_DAYS, needsUrl, statusOf, testOutcome } from "./WebhookForms.js";

const DAYS_PLACEHOLDER = /\{days\}/u;

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

it("tells the status of a row for every reason", () => {
	assert.deepEqual(statusOf(stored), { kind: "active", reasonKey: null });
	assert.deepEqual(statusOf({ ...stored, failingSince: "2026-11-25T08:00:00.000Z" }), {
		kind: "failing",
		reasonKey: "settings.webhooks.reason.failing-since",
	});
	const off = (disabledReason) => statusOf({ ...stored, enabled: false, disabledReason });
	assert.deepEqual(off(null), { kind: "disabled", reasonKey: "settings.webhooks.reason.user" });
	assert.deepEqual(off("gone"), { kind: "disabled", reasonKey: "settings.webhooks.reason.gone" });
	assert.deepEqual(off("failing"), { kind: "disabled", reasonKey: "settings.webhooks.reason.failing" });
	assert.deepEqual(off("restore"), { kind: "disabled", reasonKey: "settings.webhooks.reason.restore" });
	// a reason the UI does not know reads as the user's own choice
	assert.deepEqual(off("later"), { kind: "disabled", reasonKey: "settings.webhooks.reason.user" });
	assert.deepEqual(statusOf({ ...stored, secretError: true }), {
		kind: "error",
		reasonKey: "settings.webhooks.reason.secret-error",
	});
});

it("every reason, state and test text exists in en.json", () => {
	const ids = [
		...["user", "gone", "failing", "restore", "failing-since", "secret-error"].map(
			(reason) => `settings.webhooks.reason.${reason}`,
		),
		...["pending", "sending", "sent", "failed", "dropped"].map((state) => deliveryStateId({ status: state })),
	];
	assert.deepEqual(
		ids.filter((id) => !(id in en)),
		[],
	);
});

it("knows a webhook that needs its URL before it can be turned on", () => {
	assert.equal(needsUrl(stored), false);
	assert.equal(needsUrl({ ...stored, urlSet: false }), true);
	assert.equal(needsUrl({ ...stored, disabledReason: "restore" }), true);
});

it("labels the events column", () => {
	assert.deepEqual(eventsLabel(["*"]), { id: "settings.webhooks.events.all" });
	assert.deepEqual(eventsLabel(["backup.failed", "host.created"]), {
		id: "settings.webhooks.events.count",
		values: { count: 2 },
	});
	assert.deepEqual(eventsLabel([]), { id: "settings.webhooks.events.count", values: { count: 0 } });
	assert.deepEqual(eventsLabel(undefined), { id: "settings.webhooks.events.count", values: { count: 0 } });
});

it("names the last delivery's state", () => {
	assert.equal(deliveryStateId(null), null);
	assert.equal(deliveryStateId({ status: "sent" }), "settings.webhooks.delivery.sent");
	assert.equal(deliveryStateId({ status: "other" }), null);
});

it("tells a test's outcome", () => {
	assert.deepEqual(testOutcome({ ok: true, httpStatus: 204, durationMs: 85, error: null }), {
		ok: true,
		id: "settings.webhooks.test.ok",
		values: { status: 204, ms: 85 },
	});
	assert.deepEqual(testOutcome({ ok: false, httpStatus: 500, durationMs: 40, error: null }), {
		ok: false,
		id: "settings.webhooks.test.failed",
		values: { detail: "HTTP 500", ms: 40 },
	});
	assert.equal(
		testOutcome({ ok: false, httpStatus: null, durationMs: 9, error: "timed out" }).values.detail,
		"timed out",
	);
	assert.equal(
		testOutcome({ ok: false, httpStatus: null, durationMs: 9, error: null }).id,
		"settings.webhooks.test.failed-bare",
	);
});

it("gives the failing reason its days from a constant", () => {
	assert.equal(FAILING_DAYS, 3);
	assert.match(en["settings.webhooks.reason.failing"], DAYS_PLACEHOLDER);
});
