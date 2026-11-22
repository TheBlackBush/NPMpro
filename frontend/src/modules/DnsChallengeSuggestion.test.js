import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { challengeSuggestion } from "./DnsChallengeSuggestion.js";

const CASES = JSON.parse(
	readFileSync(new URL("../../../backend/test/fixtures/dns-domain-cases.json", import.meta.url), "utf8"),
);
const ZONES = CASES.zones.map((zone) => ({
	name: zone.name,
	dnsCredentialId: zone.credentialId,
	ownerUserId: zone.ownerUserId,
	credentialName: `C${zone.credentialId}`,
	ownerName: `U${zone.ownerUserId}`,
	provider: "cloudflare",
}));

it("preselects the one covering credential with its note", () => {
	const out = challengeSuggestion({ names: ["a.example.com", "*.example.com"], zones: ZONES, userId: 1 });
	assert.deepEqual(out.preselect, { provider: "cloudflare", credentialId: 1 });
	assert.deepEqual(out.note, { kind: "suggested", credentialName: "C1", zones: ["example.com"], count: 2 });
});

it("a hand pick is kept", () => {
	const names = ["a.example.com"];
	const other = challengeSuggestion({ names, zones: ZONES, userId: 1, handPicked: true, credentialId: 2 });
	assert.equal(other.preselect, null);
	assert.deepEqual(other.note, { kind: "not-covered", credentialName: "C2", names });
	const same = challengeSuggestion({ names, zones: ZONES, userId: 1, handPicked: true, credentialId: 1 });
	assert.deepEqual(same, { preselect: null, note: null });
});

it("spread and conflict preselect nothing", () => {
	const spread = challengeSuggestion({ names: ["a.example.com", "x.lab.example.com"], zones: ZONES, userId: 1 });
	assert.equal(spread.preselect, null);
	assert.equal(spread.note.kind, "spread");
	assert.deepEqual(
		spread.note.groups.map((group) => group.credentialName),
		["C1", "C2"],
	);
	const conflict = challengeSuggestion({ names: ["a.shared.net"], zones: ZONES, userId: 9 });
	assert.equal(conflict.preselect, null);
	assert.equal(conflict.note.kind, "conflict");
	assert.deepEqual(conflict.note.credentials, [
		{ name: "C3", ownerName: "U1" },
		{ name: "C4", ownerName: "U2" },
	]);
});

it("partial coverage names the uncovered", () => {
	const out = challengeSuggestion({ names: ["a.example.com", "foo.test"], zones: ZONES, userId: 1 });
	assert.deepEqual(out, { preselect: null, note: { kind: "partial", names: ["foo.test"] } });
});

it("no names or no covering zone shows nothing", () => {
	assert.deepEqual(challengeSuggestion({ names: [], zones: ZONES, userId: 1 }), { preselect: null, note: null });
	assert.deepEqual(challengeSuggestion({ names: ["foo.test"], zones: ZONES, userId: 1 }), {
		preselect: null,
		note: null,
	});
});

it("the credential's name comes from the credential list when given", () => {
	const out = challengeSuggestion({
		names: ["a.example.com"],
		zones: ZONES,
		userId: 1,
		credentials: [{ id: 1, name: "Cloudflare main" }],
	});
	assert.equal(out.note.credentialName, "Cloudflare main");
});

it("a provider picked by hand without a credential suggests nothing", () => {
	const out = challengeSuggestion({ names: ["a.example.com"], zones: ZONES, userId: 1, handPicked: true });
	assert.deepEqual(out, { preselect: null, note: null });
});

it("counts only names that have a bare name", () => {
	const out = challengeSuggestion({ names: ["a.example.com", ".", "  "], zones: ZONES, userId: 1 });
	assert.equal(out.note.count, 1);
});

it("matches a Unicode-typed name through its stored form", () => {
	const zones = [
		{
			name: "xn--bcher-kva.de",
			dnsCredentialId: 7,
			ownerUserId: 1,
			credentialName: "C7",
			ownerName: "U1",
			provider: "ovh",
		},
	];
	const out = challengeSuggestion({ names: ["www.bücher.de"], zones, userId: 1 });
	assert.deepEqual(out.preselect, { provider: "ovh", credentialId: 7 });
});
