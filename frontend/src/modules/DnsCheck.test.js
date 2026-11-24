import assert from "node:assert/strict";
import { it } from "node:test";
import { testAvailability, testStateOf } from "./DnsCheck.js";

const answer = (state, extra = {}) => ({ supported: true, state, zonesSeen: 2, needs: null, message: null, ...extra });

it("has no state before an answer", () => {
	assert.equal(testStateOf(undefined), null);
	assert.equal(testStateOf(null), null);
});

it("shows works green and without a detail", () => {
	assert.deepEqual(testStateOf(answer("works", { message: "ignored" })), {
		state: "works",
		tone: "success",
		messageId: "dns-credentials.test.works",
		values: {},
		detail: null,
	});
});

it("shows a wrong key, a missing right and a refusal red", () => {
	assert.equal(testStateOf(answer("wrong-key")).tone, "destructive");
	assert.equal(testStateOf(answer("wrong-key")).messageId, "dns-credentials.test.wrong-key");
	assert.equal(testStateOf(answer("refused")).tone, "destructive");
	assert.equal(testStateOf(answer("refused")).messageId, "dns-credentials.test.refused");
	const missing = testStateOf(answer("missing-right", { needs: "domain:read", message: "Access refused (403)" }));
	assert.equal(missing.tone, "destructive");
	assert.equal(missing.messageId, "dns-credentials.test.missing-right");
	assert.deepEqual(missing.values, { hint: "domain:read" });
	assert.equal(missing.detail, "Access refused (403)");
});

it("reads a missing right without a named right as a refusal", () => {
	const out = testStateOf(answer("missing-right"));
	assert.equal(out.state, "missing-right");
	assert.equal(out.tone, "destructive");
	assert.equal(out.messageId, "dns-credentials.test.refused");
	assert.deepEqual(out.values, {});
});

it("shows failed, unreachable and blocked amber with the provider's message", () => {
	for (const state of ["failed", "unreachable", "blocked"]) {
		const out = testStateOf(answer(state, { message: "boom" }));
		assert.equal(out.tone, "warning", state);
		assert.equal(out.messageId, `dns-credentials.test.${state}`);
		assert.equal(out.detail, "boom");
	}
	assert.equal(testStateOf(answer("failed", { message: "" })).detail, null);
});

it("reads an unknown state as failed", () => {
	const out = testStateOf(answer("surprise"));
	assert.equal(out.state, "failed");
	assert.equal(out.tone, "warning");
});

it("says unsupported for a provider without a read call", () => {
	assert.deepEqual(testStateOf({ supported: false, state: null, needs: null, message: null }), {
		state: "unsupported",
		tone: "muted",
		messageId: "dns-credentials.test.unsupported",
		values: {},
		detail: null,
	});
});

it("enables the button for a supported provider and a saved form", () => {
	assert.deepEqual(testAvailability({ supported: true, dirty: false }), { disabled: false, reasonId: null });
});

it("disables the button while the form is changed, and for an unsupported provider first", () => {
	assert.deepEqual(testAvailability({ supported: true, dirty: true }), {
		disabled: true,
		reasonId: "dns-credentials.test.save-first",
	});
	assert.deepEqual(testAvailability({ supported: false, dirty: true }), {
		disabled: true,
		reasonId: "dns-credentials.test.unsupported",
	});
});
