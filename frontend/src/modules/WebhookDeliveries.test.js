import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	detailOf,
	formatDeliveryTime,
	REFRESH_MS,
	redeliverState,
	refreshInterval,
	statusKind,
	WATCH_MS,
	WATCH_REFRESH_MS,
} from "./WebhookDeliveries.js";

const DATE = /Nov 26, 2026/u;
const CLOCK = /09:12:00/u;
const ZONE = /UTC/u;

it("gives every state a badge and shows a deferred or unknown one as pending", () => {
	for (const status of ["pending", "sending", "sent", "failed", "dropped"]) {
		assert.ok(en[statusKind(status).id], status);
	}
	assert.equal(statusKind("sent").tone, "success");
	assert.equal(statusKind("failed").tone, "destructive");
	assert.deepEqual(statusKind("deferred"), statusKind("pending"));
	assert.deepEqual(statusKind(undefined), statusKind("pending"));
});

it("offers Redeliver on a failed row only, disabled with the reason", () => {
	const failed = { status: "failed", redeliverable: true };
	assert.deepEqual(redeliverState(failed, true), { show: true, disabled: false, reasonId: null });
	const gone = redeliverState({ status: "failed", redeliverable: false }, true);
	assert.deepEqual(gone, { show: true, disabled: true, reasonId: "settings.webhooks.deliveries.payload-gone" });
	assert.equal(en[gone.reasonId], "The payload is no longer kept");
	const off = redeliverState({ status: "failed", redeliverable: false }, false);
	assert.equal(off.disabled, true);
	assert.ok(en[off.reasonId]);
	for (const status of ["pending", "sending", "sent", "dropped"]) {
		assert.equal(redeliverState({ status, redeliverable: false }, true).show, false, status);
	}
});

it("opens a row only when it has an error or a response", () => {
	assert.equal(detailOf({ error: null, response: "" }), null);
	assert.deepEqual(detailOf({ error: "boom", response: null }), { error: "boom", response: null });
	assert.deepEqual(detailOf({ error: null, response: "<b>x</b>" }), { error: null, response: "<b>x</b>" });
});

it("formats a time with its zone name", () => {
	const text = formatDeliveryTime("2026-11-26T09:12:00.000Z", "en", "UTC");
	assert.match(text, DATE);
	assert.match(text, CLOCK);
	assert.match(text, ZONE);
});

it("shows a dash for a missing or invalid time", () => {
	assert.equal(formatDeliveryTime(null, "en"), "-");
	assert.equal(formatDeliveryTime(undefined, "en"), "-");
	assert.equal(formatDeliveryTime("", "en"), "-");
	assert.equal(formatDeliveryTime("not a date", "en"), "-");
});

it("refreshes fast for 20 seconds after a redeliver while a row is waiting, else every 10 seconds", () => {
	const waiting = [{ status: "sent" }, { status: "pending" }];
	const done = [{ status: "sent" }, { status: "failed" }];
	assert.equal(refreshInterval(waiting, 0, 1000), REFRESH_MS);
	assert.equal(refreshInterval(waiting, 1000 + WATCH_MS, 1000), WATCH_REFRESH_MS);
	assert.equal(refreshInterval([{ status: "sending" }], 1000 + WATCH_MS, 1000), WATCH_REFRESH_MS);
	assert.equal(refreshInterval(done, 1000 + WATCH_MS, 1000), REFRESH_MS);
	assert.equal(refreshInterval(waiting, 1000 + WATCH_MS, 1000 + WATCH_MS), REFRESH_MS);
});
