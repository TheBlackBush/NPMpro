import assert from "node:assert/strict";
import { it } from "node:test";
import { CAA_MAX_LINES, caaBadge, caaById, caaLine, caaLines, caaRequest, worstCaa } from "./Caa.js";

const result = (state, extra = {}) => ({
	name: "a.example.com",
	state,
	reason: null,
	foundAt: null,
	record: null,
	errorI18n: null,
	...extra,
});

it("asks only with a usable name", () => {
	assert.equal(caaRequest({ names: [], server: "https://ca.example/dir" }), null);
	assert.equal(caaRequest({ names: undefined }), null);
	assert.equal(caaRequest({ names: ["~^a\\.example\\.com$", "host:8080", " ", "a b"] }), null);
});

it("does not ask for a name with a bad label", () => {
	const bad = [
		"a..example.com",
		".example.com",
		"-x.example.com",
		"x-.example.com",
		"a.-x.com",
		`${"a".repeat(64)}.example.com`,
	];
	for (const name of bad) assert.equal(caaRequest({ names: [name] }), null, name);
	const good = [
		`${"a".repeat(63)}.example.com`,
		"x-y.example.com",
		"_acme.example.com",
		"*.a-b.example.com",
		"example.com.",
	];
	assert.equal(caaRequest({ names: good }).domainNames.length, good.length);
});

it("builds the request with the usable names once each", () => {
	assert.deepEqual(
		caaRequest({
			names: [" a.example.com ", "A.example.com", "*.example.com", "~^x$", "b.example.com"],
			server: "https://ca.example/dir",
			dnsChallenge: true,
		}),
		{
			domainNames: ["a.example.com", "*.example.com", "b.example.com"],
			acmeServer: "https://ca.example/dir",
			dnsChallenge: true,
		},
	);
});

it("leaves the CA out for the instance CA and waits for a chosen CA when asked", () => {
	assert.deepEqual(caaRequest({ names: ["a.example.com"] }), { domainNames: ["a.example.com"], dnsChallenge: false });
	assert.equal(caaRequest({ names: ["a.example.com"], needsServer: true }), null);
	assert.equal(
		caaRequest({ names: ["a.example.com"], server: "https://ca.example/dir", needsServer: true }).acmeServer,
		"https://ca.example/dir",
	);
});

it("keeps at most 100 names", () => {
	const names = Array.from({ length: 120 }, (_, index) => `h${index}.example.com`);
	assert.equal(caaRequest({ names }).domainNames.length, 100);
});

it("shows the worst state: refused, then limited, then unknown", () => {
	const names = [
		result("allowed"),
		result("unknown", { name: "u" }),
		result("limited", { name: "l" }),
		result("refused", { name: "r1" }),
		result("refused", { name: "r2" }),
	];
	const worst = worstCaa(names);
	assert.equal(worst.state, "refused");
	assert.equal(worst.tone, "destructive");
	assert.deepEqual(
		worst.results.map((item) => item.name),
		["r1", "r2"],
	);
	assert.equal(worstCaa(names.slice(0, 3)).state, "limited");
	assert.equal(worstCaa(names.slice(0, 2)).tone, "warning");
});

it("shows nothing for allowed names or names that were not looked at", () => {
	assert.equal(
		worstCaa([result("allowed", { reason: "none" }), result("not-checked", { reason: "skipped-pattern" })]),
		null,
	);
	assert.equal(worstCaa(undefined), null);
	assert.equal(worstCaa([]), null);
});

it("says when the CA names no CAA identity, unless something worse was found", () => {
	const unnamed = result("not-checked", { reason: "no-identity", errorI18n: "error.caa-no-identity" });
	assert.deepEqual(worstCaa([unnamed, { ...unnamed, name: "b" }]), {
		state: "no-identity",
		tone: "info",
		results: [unnamed],
	});
	assert.equal(worstCaa([unnamed, result("unknown")]).state, "unknown");
});

it("words a refusal with where it was found and the record", () => {
	const line = caaLine(
		result("refused", { reason: "not-listed", foundAt: "example.com", record: '0 issue "other.example"' }),
	);
	assert.deepEqual(line, {
		state: "refused",
		tone: "destructive",
		messageId: "certificates.caa.refused",
		values: { name: "a.example.com", at: "example.com", record: '0 issue "other.example"' },
		reasonId: "certificates.caa.reason.not-listed",
	});
});

it("words every reason of a state with its own text", () => {
	for (const reason of ["forbidden", "validationmethods", "critical-unknown-tag"]) {
		assert.equal(caaLine(result("refused", { reason })).reasonId, `certificates.caa.reason.${reason}`);
	}
	assert.equal(caaLine(result("limited", { reason: "accounturi" })).messageId, "certificates.caa.limited");
	for (const reason of ["lookup-timeout", "lookup-servfail", "lookup-error", "lookup-too-deep"]) {
		const line = caaLine(result("unknown", { reason }));
		assert.equal(line.messageId, "certificates.caa.unknown");
		assert.equal(line.reasonId, `certificates.caa.reason.${reason}`);
	}
});

it("reads an unknown lookup code as the general failure and an unknown state as unknown", () => {
	assert.equal(
		caaLine(result("unknown", { reason: "lookup-weird" })).reasonId,
		"certificates.caa.reason.lookup-error",
	);
	assert.equal(caaLine(result("unknown", { reason: null })).reasonId, "certificates.caa.reason.lookup-error");
	assert.equal(caaLine(result("surprise")).state, "unknown");
	assert.equal(caaLine(result("refused", { reason: "surprise" })).reasonId, null);
});

it("uses the backend's text key for a CA without a CAA identity", () => {
	const line = caaLine(result("not-checked", { reason: "no-identity", errorI18n: "error.caa-no-identity" }));
	assert.equal(line.messageId, "error.caa-no-identity");
	assert.equal(line.reasonId, null);
	assert.equal(
		caaLine(result("not-checked", { reason: "no-identity" })).messageId,
		"certificates.caa.reason.no-identity",
	);
});

it("cuts the lines and counts the rest", () => {
	const many = Array.from({ length: CAA_MAX_LINES + 2 }, (_, index) => result("refused", { name: `n${index}` }));
	const { lines, more } = caaLines(many);
	assert.equal(lines.length, CAA_MAX_LINES);
	assert.equal(lines[0].name, "n0");
	assert.equal(more, 2);
	assert.deepEqual(caaLines(undefined), { lines: [], more: 0 });
});

it("gives a badge only for refused, limited and unknown entries", () => {
	const names = [result("allowed"), result("refused", { name: "r" }), result("unknown", { name: "u" })];
	assert.equal(caaBadge({ certificateId: 1, state: "allowed", names }), null);
	assert.equal(caaBadge({ certificateId: 1, state: "not-checked", names: [] }), null);
	assert.equal(caaBadge(undefined), null);
	const refused = caaBadge({ certificateId: 1, state: "refused", names });
	assert.equal(refused.tone, "destructive");
	assert.deepEqual(
		refused.results.map((item) => item.name),
		["r"],
	);
	assert.equal(caaBadge({ certificateId: 1, state: "unknown", names: [names[2]] }).tone, "warning");
});

it("still warns for an entry whose names do not show its state", () => {
	assert.deepEqual(caaBadge({ certificateId: 1, state: "limited", names: [] }), {
		state: "limited",
		tone: "warning",
		results: [],
	});
});

it("finds the cached entries by certificate id", () => {
	const map = caaById([
		{ certificateId: 4, state: "refused" },
		{ certificateId: 9, state: "allowed" },
	]);
	assert.equal(map.get(4).state, "refused");
	assert.equal(map.size, 2);
	assert.equal(caaById(undefined).size, 0);
});
