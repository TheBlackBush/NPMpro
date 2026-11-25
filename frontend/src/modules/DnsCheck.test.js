import assert from "node:assert/strict";
import { it } from "node:test";
import {
	CHECK_LIMIT,
	cardLines,
	checkBatches,
	checkCounts,
	checkOfHost,
	checksOfType,
	hostCheckBadge,
	mergeChecks,
	NAME_LIMIT,
	nameLine,
	namesChanged,
	testAvailability,
	testStateOf,
} from "./DnsCheck.js";

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

const found = (v4 = [], v6 = []) => ({ ipv4: { found: v4, public: null }, ipv6: { found: v6, public: null } });
const result = (name, state, extra = {}) => ({
	name,
	state,
	via: null,
	proxied: false,
	reason: null,
	message: null,
	...found(),
	...extra,
});

it("shows the worst state of a host and ignores skipped names", () => {
	const badge = (...states) => hostCheckBadge(states.map((state) => result("a.example.com", state)));
	assert.deepEqual(badge("here"), { state: "here", tone: "success" });
	assert.deepEqual(badge("here", "partly"), { state: "partly", tone: "warning" });
	assert.deepEqual(badge("here", "unknown"), { state: "unknown", tone: "warning" });
	assert.deepEqual(badge("partly", "unknown"), { state: "partly", tone: "warning" });
	assert.deepEqual(badge("partly", "elsewhere", "here"), { state: "elsewhere", tone: "destructive" });
	assert.deepEqual(badge("elsewhere", "none"), { state: "none", tone: "destructive" });
	assert.deepEqual(badge("here", "skipped"), { state: "here", tone: "success" });
	assert.equal(badge("skipped"), null);
	assert.equal(hostCheckBadge([]), null);
	assert.equal(hostCheckBadge(undefined), null);
});

it("reads a state this version does not know as unknown", () => {
	assert.equal(hostCheckBadge([result("a.example.com", "later")]).state, "unknown");
	assert.equal(nameLine(result("a.example.com", "later")).state, "unknown");
});

it("shows a name that reaches this instance with its addresses and how it was found", () => {
	const line = nameLine(result("a.example.com", "here", { via: "dns", ...found(["192.0.2.1"], ["2001:db8::1"]) }));
	assert.deepEqual(line, {
		state: "here",
		tone: "success",
		stateId: "dns-check.state.here",
		addresses: ["192.0.2.1", "2001:db8::1"],
		via: null,
		proxied: false,
		reason: null,
	});
	assert.deepEqual(nameLine(result("a.example.com", "here", { via: "record" })).via, {
		id: "dns-check.via.record",
		values: {},
	});
	assert.deepEqual(nameLine(result("a.b.example.com", "here", { via: "wildcard" })).via, {
		id: "dns-check.via.wildcard",
		values: { name: "*.b.example.com" },
	});
	assert.equal(nameLine(result("a.example.com", "here", { via: "alias" })).via.id, "dns-check.via.alias");
	assert.equal(nameLine(result("a.example.com", "here", { via: "record", proxied: true })).proxied, true);
});

it("shows via and proxied only for a name that reaches this instance", () => {
	const line = nameLine(
		result("a.example.com", "elsewhere", { via: "record", proxied: true, ...found(["198.51.100.4"]) }),
	);
	assert.equal(line.via, null);
	assert.equal(line.proxied, false);
	assert.deepEqual(line.addresses, ["198.51.100.4"]);
	assert.equal(line.tone, "destructive");
	assert.equal(nameLine(result("a.example.com", "none")).stateId, "dns-check.state.none");
});

it("explains why a name was not checked, with the provider's message only for a failed read", () => {
	assert.deepEqual(nameLine(result("*.example.com", "skipped", { reason: "skipped-pattern" })).reason, {
		id: "dns-check.reason.skipped-pattern",
		detail: null,
	});
	assert.deepEqual(
		nameLine(result("a.example.com", "elsewhere", { reason: "provider-read-failed", message: "Forbidden" })).reason,
		{ id: "dns-check.reason.provider-read-failed", detail: "Forbidden" },
	);
	assert.deepEqual(nameLine(result("a.example.com", "here", { reason: "provider-read-skipped" })).reason, {
		id: "dns-check.reason.provider-read-skipped",
		detail: null,
	});
	assert.deepEqual(nameLine(result("a.example.com", "unknown", { reason: "timeout" })).reason, {
		id: "dns-check.reason.timeout",
		detail: null,
	});
	assert.equal(
		nameLine(result("a.example.com", "unknown", { reason: "lookup-timeout", message: "x" })).reason.detail,
		null,
	);
	assert.equal(
		nameLine(result("a.example.com", "unknown", { reason: "newer-code" })).reason.id,
		"dns-check.reason.check-failed",
	);
});

it("makes one line per name of the form with the result of that name", () => {
	const results = [result("A.example.com", "here"), result("b.example.com", "none")];
	const lines = cardLines(["a.example.com", "c.example.com", "A.EXAMPLE.COM"], results);
	assert.deepEqual(
		lines.map((line) => [line.name, line.result?.state ?? null]),
		[
			["a.example.com", "here"],
			["c.example.com", null],
		],
	);
	assert.deepEqual(cardLines(undefined, results), []);
});

it("notices names that changed since the check", () => {
	const results = [result("a.example.com", "here"), result("b.example.com", "none")];
	assert.equal(namesChanged(["B.example.com", "a.example.com"], results), false);
	assert.equal(namesChanged(["a.example.com"], results), true);
	assert.equal(namesChanged(["a.example.com", "c.example.com"], results), true);
});

it("finds, merges and picks checks by host", () => {
	const one = { type: "proxy", id: 1, names: [] };
	const two = { type: "dead", id: 1, names: [] };
	assert.equal(checkOfHost([one, two], "dead", 1), two);
	assert.equal(checkOfHost([one], "dead", 1), undefined);
	assert.equal(checkOfHost(undefined, "dead", 1), undefined);
	assert.deepEqual([...checksOfType([one, two], "proxy").keys()], [1]);
	const fresh = { type: "proxy", id: 1, names: [{ name: "x" }] };
	assert.deepEqual(mergeChecks([one, two], [fresh]), [fresh, two]);
	assert.deepEqual(mergeChecks(undefined, [one]), [one]);
	assert.deepEqual(mergeChecks([one], undefined), [one]);
});

it("checks every host of the page in requests of at most 50", () => {
	const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
	assert.equal(CHECK_LIMIT, 50);
	const batches = checkBatches("proxy", rows(120));
	assert.deepEqual(
		batches.map((batch) => batch.length),
		[50, 50, 20],
	);
	assert.deepEqual(batches[0][0], { type: "proxy", id: 1 });
	assert.deepEqual(batches[2][19], { type: "proxy", id: 120 });
	assert.deepEqual(
		checkBatches("dead", rows(50)).map((batch) => batch.length),
		[50],
	);
	assert.deepEqual(checkBatches("dead", [{ id: 7 }]), [[{ type: "dead", id: 7 }]]);
	assert.deepEqual(checkBatches("dead", []), []);
	assert.deepEqual(checkBatches("dead", undefined), []);
});

it("keeps each request within 200 names across its hosts", () => {
	assert.equal(NAME_LIMIT, 200);
	const named = (id, count) => ({ id, domainNames: Array.from({ length: count }, (_, i) => `n${i}.h${id}.example`) });
	assert.deepEqual(
		checkBatches("proxy", [named(1, 100), named(2, 90), named(3, 20), named(4, 100), named(5, 100)]).map((batch) =>
			batch.map((host) => host.id),
		),
		[[1, 2], [3, 4], [5]],
	);
	// names that differ only in case count once, as the backend counts them
	const twice = { id: 6, domainNames: ["A.example", "a.example"] };
	assert.deepEqual(
		checkBatches("proxy", [named(1, 199), twice]).map((batch) => batch.length),
		[2],
	);
});

it("counts the names a check looked at", () => {
	const hosts = [
		{ names: [result("a", "here"), result("b", "partly"), result("*.c", "skipped")] },
		{ names: [result("d", "elsewhere"), result("e", "none"), result("f", "unknown"), result("g", "here")] },
	];
	assert.deepEqual(checkCounts(hosts), { checked: 6, here: 2, away: 2, none: 1, unknown: 1 });
	assert.deepEqual(checkCounts(undefined), { checked: 0, here: 0, away: 0, none: 0, unknown: 0 });
});

it("counts a row without names as none in a batch", () => {
	assert.deepEqual(checkBatches("proxy", [{ id: 1 }, { id: 2, domainNames: undefined }]), [
		[
			{ type: "proxy", id: 1 },
			{ type: "proxy", id: 2 },
		],
	]);
});
