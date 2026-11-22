import assert from "node:assert/strict";
import { it } from "node:test";
import { covers, uncoveredHosts } from "./CertificateDomains.js";

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
