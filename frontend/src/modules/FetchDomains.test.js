import assert from "node:assert/strict";
import { it } from "node:test";
import { fetchState, hintIdOf, initialSelection } from "./FetchDomains.js";

const ZONES = [
	{ name: "b.example", state: "new" },
	{ name: "a.example", state: "here" },
	{ name: "c.example", state: "other", credentialName: "Other" },
	{ name: "a2.example", state: "new" },
];

it("is loading while nothing has answered", () => {
	assert.deepEqual(fetchState(undefined, null), { kind: "loading", rows: [], hintId: null, truncated: false });
});

it("lists the zones sorted by name, and says when the answer was cut", () => {
	const out = fetchState({ supported: true, truncated: true, zones: ZONES }, null);
	assert.equal(out.kind, "list");
	assert.equal(out.truncated, true);
	assert.deepEqual(
		out.rows.map((row) => row.name),
		["a.example", "a2.example", "b.example", "c.example"],
	);
	assert.equal(out.hintId, null);
});

it("is empty for an answer without zones", () => {
	assert.equal(fetchState({ supported: true, truncated: false, zones: [] }, null).kind, "empty");
});

it("is an error with the hint of the provider", () => {
	assert.deepEqual(fetchState(undefined, new Error("x"), "cloudflare"), {
		kind: "error",
		rows: [],
		hintId: "dns-domains.fetch.hint.cloudflare",
		truncated: false,
	});
	assert.equal(hintIdOf("digitalocean"), "dns-domains.fetch.hint.digitalocean");
	assert.equal(hintIdOf("ovh"), "dns-domains.fetch.hint.ovh");
	assert.equal(hintIdOf("hetzner-cloud"), "dns-domains.fetch.hint.other");
	assert.equal(hintIdOf(undefined), "dns-domains.fetch.hint.other");
});

it("an answer of a provider that does not list is an error too", () => {
	assert.equal(fetchState({ supported: false, truncated: false, zones: [] }, null, "duckdns").kind, "error");
});

it("selects every new zone and no other", () => {
	assert.deepEqual(
		[...initialSelection(ZONES)].sort((a, b) => a.localeCompare(b)),
		["a2.example", "b.example"],
	);
	assert.equal(initialSelection(undefined).size, 0);
});
