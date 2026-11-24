import assert from "node:assert/strict";
import { it } from "node:test";
import { autoSelection, fetchState, hasUnsavedWork, hintIdOf, limitState, saveBody } from "./FetchDomains.js";

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
	for (const id of ["linode", "vultr", "desec", "bunny", "porkbun"]) {
		assert.equal(hintIdOf(id), `dns-domains.fetch.hint.${id}`);
	}
	assert.equal(hintIdOf("ionos"), "dns-domains.fetch.hint.other");
	assert.equal(hintIdOf("godaddy"), "dns-domains.fetch.hint.other");
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

it("ticks the new zones in display order and no other", () => {
	assert.deepEqual([...autoSelection(ZONES)], ["a2.example", "b.example"]);
	assert.equal(autoSelection(undefined).size, 0);
});

it("ticks at most the room the typed names leave", () => {
	assert.deepEqual([...autoSelection(ZONES, 1)], ["a2.example"]);
	assert.equal(autoSelection(ZONES, 0).size, 0);
	assert.equal(autoSelection(ZONES, -3).size, 0);
	const many = Array.from({ length: 250 }, (_, i) => ({
		name: `z${String(i).padStart(3, "0")}.example`,
		state: "new",
	}));
	assert.equal(autoSelection(many).size, 100);
	assert.equal(autoSelection(many, 100 - 30).size, 70);
});

it("knows when a save is full, over, and when the provider has more", () => {
	assert.deepEqual(limitState(0, 99, 99), { full: false, over: false, more: false });
	assert.deepEqual(limitState(0, 100, 150), { full: true, over: false, more: true });
	assert.deepEqual(limitState(5, 96, 96), { full: true, over: true, more: true });
	assert.deepEqual(limitState(100, 0, 1), { full: true, over: false, more: true });
});

it("asks to discard only what the user did", () => {
	const auto = new Set(["a", "b"]);
	const base = { typed: [], pending: false, ticked: new Set(["a", "b"]), auto };
	assert.equal(hasUnsavedWork(base), false);
	assert.equal(hasUnsavedWork({ ...base, ticked: new Set(), auto: new Set() }), false);
	assert.equal(hasUnsavedWork({ ...base, typed: ["x.example"] }), true);
	assert.equal(hasUnsavedWork({ ...base, typed: undefined }), false);
	assert.equal(hasUnsavedWork({ ...base, pending: true }), true);
	assert.equal(hasUnsavedWork({ ...base, ticked: new Set(["a"]) }), true);
	assert.equal(hasUnsavedWork({ ...base, ticked: new Set(["a", "b", "c"]) }), true);
	assert.equal(hasUnsavedWork({ ...base, ticked: new Set(["a", "c"]) }), true);
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
