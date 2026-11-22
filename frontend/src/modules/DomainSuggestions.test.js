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
	const out = domainSuggestions({ ...base, query: "ap", wildcards: true });
	assert.deepEqual(
		values(out).filter((v) => v.startsWith("*")),
		["*.example.com", "*.other.org"],
	);
	assert.deepEqual(out.find((entry) => entry.value === "*.example.com").detail.kind, "wildcard");
	assert.deepEqual(values(domainSuggestions({ ...base, query: "*", wildcards: true })), [
		"*.example.com",
		"*.other.org",
	]);
	assert.deepEqual(values(domainSuggestions({ ...base, query: "*", wildcards: false })), []);
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
