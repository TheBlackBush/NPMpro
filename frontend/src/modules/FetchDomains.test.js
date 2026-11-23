import assert from "node:assert/strict";
import { it } from "node:test";
import { fetchState, hintIdOf, initialSelection, saveBody } from "./FetchDomains.js";

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

// an error of the API as base.js throws it
const apiError = (messageI18n) =>
	Object.assign(new Error(messageI18n), { payload: { error: { message_i18n: messageI18n } } });

it("is an error with the hint of the provider for a refused credential", () => {
	assert.deepEqual(fetchState(undefined, apiError("error.dns-zones-forbidden"), "cloudflare"), {
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

it("is an error without the hint for every other error", () => {
	for (const error of [
		apiError("error.dns-zones-failed"),
		apiError("error.dns-zones-blocked"),
		apiError("error.dns-zones-not-https"),
		apiError("error.request-failed"),
		new Error("Failed to fetch"),
		{},
	]) {
		assert.deepEqual(fetchState(undefined, error, "cloudflare"), {
			kind: "error",
			rows: [],
			hintId: null,
			truncated: false,
		});
	}
	assert.equal(fetchState(undefined, apiError("error.dns-zones-forbidden"), "gandi").hintId, hintIdOf("gandi"));
});

it("an answer of a provider that does not list is its own state, without a hint", () => {
	assert.deepEqual(fetchState({ supported: false, truncated: false, zones: [] }, null, "duckdns"), {
		kind: "not-supported",
		rows: [],
		hintId: null,
		truncated: false,
	});
});

it("sorts by the name as shown", () => {
	// xn--bcher-kva is bücher: it sorts between "a" and "z" shown, not by its ASCII form
	const out = fetchState(
		{
			supported: true,
			truncated: false,
			zones: [
				{ name: "caffe.example", state: "new" },
				{ name: "xn--bcher-kva.example", state: "new" },
			],
		},
		null,
	);
	assert.deepEqual(
		out.rows.map((row) => row.name),
		["xn--bcher-kva.example", "caffe.example"],
	);
});

it("selects every new zone and no other", () => {
	assert.deepEqual(
		[...initialSelection(ZONES)].sort((a, b) => a.localeCompare(b)),
		["a2.example", "b.example"],
	);
	assert.equal(initialSelection(undefined).size, 0);
});

it("builds one body from the typed names and the ticked zones, each name once", () => {
	assert.deepEqual(saveBody(3, ["a.example", "B.example."], new Set(["b.example", "c.example", "c.example"])), {
		dnsCredentialId: 3,
		names: ["a.example", "B.example."],
		fetchedNames: ["c.example"],
	});
});

it("leaves out an empty list", () => {
	assert.deepEqual(saveBody(3, [], new Set(["c.example"])), { dnsCredentialId: 3, fetchedNames: ["c.example"] });
	assert.deepEqual(saveBody(3, ["a.example", "a.example"], new Set()), { dnsCredentialId: 3, names: ["a.example"] });
	assert.deepEqual(saveBody(3, undefined, new Set()), { dnsCredentialId: 3 });
});
