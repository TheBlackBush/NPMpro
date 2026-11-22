import assert from "node:assert/strict";
import { it } from "node:test";
import { domainSuggestions } from "./DomainSuggestions.js";

const ZONES = [
	{ name: "example.com", dnsCredentialId: 1, credentialName: "Cloudflare main" },
	{ name: "other.org", dnsCredentialId: 1, credentialName: "Cloudflare main" },
	{ name: "example.com", dnsCredentialId: 4, credentialName: "Bob" },
];
const NAMES = [
	{ name: "api.example.com", source: "proxy_host" },
	{ name: "ap.legacy.net", source: "certificate" },
	{ name: "map.example.com", source: "redirection_host" },
];
const values = (list) => list.map((entry) => entry.value);
const base = { zones: ZONES, names: NAMES, values: [], wildcards: false };

it("offers nothing for an empty query", () => {
	assert.deepEqual(domainSuggestions({ ...base, query: "  " }), []);
});

it("puts typed text without a dot in front of each zone, then the used names that contain it", () => {
	const out = domainSuggestions({ ...base, query: "ap" });
	assert.deepEqual(values(out), [
		"ap.example.com",
		"ap.other.org",
		"ap.legacy.net",
		"api.example.com",
		"map.example.com",
	]);
	assert.equal(out[0].groupLabelId, "domain-names.group.zones");
	assert.deepEqual(out[0].detail, { kind: "zone", credentialName: "Bob" });
	assert.deepEqual(out[2].detail, { kind: "used", source: "certificate" });
});

it("completes dotted text against the zones and the used names", () => {
	assert.deepEqual(values(domainSuggestions({ ...base, query: "app.ex" })), ["app.example.com"]);
	assert.deepEqual(values(domainSuggestions({ ...base, query: "other" })).slice(0, 1), ["other.example.com"]);
	assert.deepEqual(values(domainSuggestions({ ...base, query: "example.c" })), [
		"example.com",
		"api.example.com",
		"map.example.com",
	]);
});

it("offers wildcards only when permitted", () => {
	assert.equal(
		values(domainSuggestions({ ...base, query: "ap" })).some((v) => v.startsWith("*")),
		false,
	);
	const out = domainSuggestions({ ...base, query: "exam", wildcards: true });
	assert.deepEqual(
		values(out).filter((v) => v.startsWith("*")),
		["*.example.com"],
	);
	assert.deepEqual(out.find((entry) => entry.value === "*.example.com").detail.kind, "wildcard");
	assert.deepEqual(values(domainSuggestions({ ...base, query: "*", wildcards: true })), [
		"*.example.com",
		"*.other.org",
	]);
	assert.deepEqual(values(domainSuggestions({ ...base, query: "*", wildcards: false })), []);
});

it("lists wildcards only for a query that starts with a star or names part of a zone", () => {
	const wild = (query) =>
		values(domainSuggestions({ ...base, query, wildcards: true })).filter((v) => v.startsWith("*"));
	assert.deepEqual(wild("ap"), []);
	assert.deepEqual(wild("lc"), []);
	assert.deepEqual(wild("exam"), ["*.example.com"]);
	assert.deepEqual(wild("*"), ["*.example.com", "*.other.org"]);
	assert.deepEqual(wild("*.oth"), ["*.other.org"]);
});

it("leaves out names the field holds (any case) and names the field refuses", () => {
	const out = domainSuggestions({ ...base, query: "ap", values: ["AP.example.com", "api.example.com"] });
	assert.deepEqual(values(out), ["ap.other.org", "ap.legacy.net", "map.example.com"]);
	const valid = (name) => !name.endsWith(".org");
	assert.equal(values(domainSuggestions({ ...base, query: "ap", isValid: valid })).includes("ap.other.org"), false);
});

it("offers at most eight of each group", () => {
	const zones = Array.from({ length: 12 }, (_, i) => ({
		name: `z${i}.test`,
		dnsCredentialId: 1,
		credentialName: "c",
	}));
	const names = Array.from({ length: 12 }, (_, i) => ({ name: `ap${i}.used.test`, source: "proxy_host" }));
	const out = domainSuggestions({ query: "ap", zones, names, values: [], wildcards: true });
	assert.equal(out.filter((entry) => entry.groupLabelId === "domain-names.group.zones").length, 8);
	const wild = domainSuggestions({ query: "*", zones, names, values: [], wildcards: true });
	assert.equal(wild.filter((entry) => entry.groupLabelId === "domain-names.group.zones").length, 8);
	assert.equal(out.filter((entry) => entry.groupLabelId === "domain-names.group.used").length, 8);
});

it("shows Unicode text, carries the ASCII value, and matches typed Unicode", () => {
	const zones = [{ name: "xn--bcher-kva.de", dnsCredentialId: 1, credentialName: "c" }];
	const out = domainSuggestions({ query: "www", zones, names: [], values: [], wildcards: false });
	assert.equal(out[0].value, "www.xn--bcher-kva.de");
	assert.equal(out[0].label, "www.bücher.de");
	const typed = domainSuggestions({ query: "www.bücher", zones, names: [], values: [], wildcards: false });
	assert.deepEqual(values(typed), ["www.xn--bcher-kva.de"]);
});

it("finds IDN names from a typed Unicode prefix", () => {
	const zones = [{ name: "xn--bcher-kva.de", dnsCredentialId: 1, credentialName: "c" }];
	const names = [{ name: "shop.xn--bcher-kva.de", source: "proxy_host" }];
	const input = { zones, names, values: [], wildcards: true };
	// "bü" has no ASCII form that is part of the stored names: it is matched against the Unicode form
	const partial = values(domainSuggestions({ ...input, query: "bü" }));
	assert.ok(partial.includes("*.xn--bcher-kva.de"));
	assert.ok(partial.includes("shop.xn--bcher-kva.de"));
	const dotted = values(domainSuggestions({ ...input, query: "www.bü" }));
	assert.ok(dotted.includes("www.xn--bcher-kva.de"));
	const zone = values(domainSuggestions({ ...input, query: "bücher.d" }));
	assert.ok(zone.includes("xn--bcher-kva.de"));
});

it("offers no wildcard in any form where the field takes none", () => {
	const names = [{ name: "*.example.com", source: "certificate" }, ...NAMES];
	const plain = values(domainSuggestions({ ...base, names, query: "exam" }));
	assert.equal(
		plain.some((value) => value.startsWith("*")),
		false,
	);
	assert.equal(plain.includes("api.example.com"), true);
	assert.deepEqual(values(domainSuggestions({ ...base, names, query: "*x" })), []);
	assert.deepEqual(values(domainSuggestions({ ...base, names, query: "*.ex" })), []);
	const out = domainSuggestions({ ...base, names, query: "exam", wildcards: true });
	assert.equal(values(out).includes("*.example.com"), true);
});

it("takes a star only as the leading wildcard label", () => {
	for (const query of ["*x", "a*", "a*b", "*.a*", "**"]) {
		assert.deepEqual(values(domainSuggestions({ ...base, query, wildcards: true })), [], query);
	}
	assert.deepEqual(values(domainSuggestions({ ...base, query: "*.ex", wildcards: true })), ["*.example.com"]);
});
