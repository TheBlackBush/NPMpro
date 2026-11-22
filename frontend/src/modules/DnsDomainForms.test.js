import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { dnsDomainNamesRule, normalizeDnsDomain, storedForm, takenNames, toAscii } from "./DnsDomainForms.js";

const CASES = JSON.parse(
	readFileSync(new URL("../../../backend/test/fixtures/dns-domain-cases.json", import.meta.url), "utf8"),
);

it("normalizes a DNS domain like the backend (shared cases)", () => {
	for (const [input, expected] of CASES.names) assert.deepEqual(normalizeDnsDomain(input), expected, input);
});

it("refuses what is not a string and what the URL rules refuse", () => {
	assert.deepEqual(normalizeDnsDomain(undefined), { error: "error.dns-domain-invalid" });
	assert.equal(toAscii("a b"), "");
	assert.equal(toAscii("bücher.de"), "xn--bcher-kva.de");
	assert.deepEqual(normalizeDnsDomain("1.2.3.4"), { error: "error.dns-domain-invalid" });
	assert.deepEqual(normalizeDnsDomain("0x7f.1"), { error: "error.dns-domain-invalid" });
});

it("finds the names the owner keeps on another credential", () => {
	const domains = [
		{ name: "example.com", dnsCredentialId: 1, credential: { name: "Cloudflare main", ownerUserId: 1 } },
		{ name: "lab.example.com", dnsCredentialId: 2, credential: { name: "Hetzner lab", ownerUserId: 1 } },
		{ name: "other.org", dnsCredentialId: 3, credential: { name: "Bob's", ownerUserId: 2 } },
	];
	const taken = takenNames(["Example.COM", "lab.example.com", "other.org", "new.example"], {
		credentialId: 2,
		ownerUserId: 1,
		domains,
	});
	assert.deepEqual([...taken], [["Example.COM", "Cloudflare main"]]);
	assert.equal(takenNames(["example.com"], { credentialId: null, ownerUserId: 1, domains }).size, 1);
	assert.equal(takenNames(["other.org"], { credentialId: null, ownerUserId: 1, domains }).size, 0);
	assert.equal(takenNames([], { credentialId: null, ownerUserId: 1, domains: undefined }).size, 0);
	assert.equal(takenNames(undefined, { credentialId: null, ownerUserId: 1, domains }).size, 0);
});

it("gives the rule of the domain names field its message", () => {
	const rules = { message: (id, values) => ({ id, values }) };
	assert.deepEqual(dnsDomainNamesRule(rules, new Map())(["example.com", "*.example.com"]), {
		id: "error.dns-domain-wildcard",
		values: { domain: "*.example.com" },
	});
	assert.deepEqual(dnsDomainNamesRule(rules, new Map([["example.com", "Cloudflare main"]]))(["example.com"]), {
		id: "dns-domains.taken",
		values: { domain: "example.com", credential: "Cloudflare main" },
	});
	assert.equal(dnsDomainNamesRule(rules, new Map())(["example.com"]), undefined);
	assert.equal(dnsDomainNamesRule(rules, new Map())(undefined), undefined);
});

it("never refuses a stored name, names every taken name and keeps each name once", () => {
	const rules = { message: (id, values) => ({ id, values }) };
	const rule = dnsDomainNamesRule(rules, new Map(), ["Legacy_Name.example.com"]);
	assert.equal(rule(["Legacy_Name.example.com", "example.com"]), undefined);
	assert.equal(rule(["Other_Name.example.com"]).id, "error.dns-domain-invalid");
	const taken = new Map([
		["a.com", "One"],
		["b.com", "Two"],
		["c.com", "Two"],
	]);
	assert.deepEqual(dnsDomainNamesRule(rules, taken)(["a.com"]), {
		id: "dns-domains.taken-more",
		values: { domain: "a.com", credential: "One", count: 2 },
	});
	assert.deepEqual(storedForm(["Example.com", "example.com", "bücher.de", "bad name"]), [
		"example.com",
		"xn--bcher-kva.de",
		"bad name",
	]);
});
