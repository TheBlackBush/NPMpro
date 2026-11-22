import assert from "node:assert/strict";
import { it } from "node:test";
import { covers, sameNames, uncoveredHosts, uncoveredNames } from "./CertificateDomains.js";

it("covers a name exactly or through a one-label wildcard", () => {
	assert.equal(covers("A.example.com", "a.example.com"), true);
	assert.equal(covers("*.example.com", "a.example.com"), true);
	assert.equal(covers("*.example.com", "example.com"), false);
	assert.equal(covers("*.example.com", "a.b.example.com"), false);
	assert.equal(covers("a.example.com", "*.example.com"), false);
	assert.equal(covers("*.example.com", "*.example.com"), true);
	assert.equal(covers("*.example.com", "*.other.com"), false);
});

it("lists the hosts whose names the new list no longer covers", () => {
	const certificate = {
		proxyHosts: [{ id: 1, domainNames: ["a.example.com", "b.example.com"] }],
		redirectionHosts: [{ id: 2, domainNames: ["c.example.com"] }],
		deadHosts: [],
	};
	assert.deepEqual(uncoveredHosts(["a.example.com", "*.example.com"], certificate), []);
	assert.deepEqual(uncoveredHosts(["a.example.com"], certificate), [
		{ type: "proxy", id: 1, domains: ["b.example.com"] },
		{ type: "redirection", id: 2, domains: ["c.example.com"] },
	]);
});

it("treats a bare apex and a deeper name as uncovered by a wildcard", () => {
	const certificate = { deadHosts: [{ id: 3, domainNames: ["example.com", "a.b.example.com", "x.example.com"] }] };
	assert.deepEqual(uncoveredHosts(["*.example.com"], certificate), [
		{ type: "dead", id: 3, domains: ["example.com", "a.b.example.com"] },
	]);
});

it("handles a row without host lists and a host without names", () => {
	assert.deepEqual(uncoveredHosts(["a.example.com"], {}), []);
	assert.deepEqual(uncoveredHosts(["a.example.com"], { proxyHosts: [{ id: 1 }] }), []);
});

it("compares a Unicode name and its punycode form as the same name, in both directions", () => {
	assert.equal(covers("bücher.example", "xn--bcher-kva.example"), true);
	assert.equal(covers("xn--bcher-kva.example", "bücher.example"), true);
	assert.equal(covers("*.bücher.example", "a.xn--bcher-kva.example"), true);
	assert.equal(covers("*.xn--bcher-kva.example", "a.bücher.example"), true);
	assert.equal(covers("bücher.example", "other.example"), false);
});

it("compares lists as sets in any order and case", () => {
	assert.equal(sameNames(["B.example.com", "a.example.com"], ["a.example.com", "b.example.com"]), true);
	assert.equal(sameNames(["a.example.com"], ["a.example.com", "b.example.com"]), false);
	assert.equal(sameNames(["bücher.example"], ["xn--bcher-kva.example"]), true);
});

it("names each uncovered name once", () => {
	assert.deepEqual(
		uncoveredNames([
			{ type: "proxy", id: 1, domains: ["a.example.com", "b.example.com"] },
			{ type: "dead", id: 2, domains: ["a.example.com"] },
		]),
		["a.example.com", "b.example.com"],
	);
});

it("compares a name the URL parser refuses as typed", () => {
	assert.equal(covers("a b", "A B"), true);
});
