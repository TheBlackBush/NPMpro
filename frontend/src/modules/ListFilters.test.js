import assert from "node:assert/strict";
import { it } from "node:test";
import { activeFilterCount, filterCertificates, filterHosts, hostStatus, parseFilters } from "./ListFilters.js";

const rows = [
	{ id: 1, enabled: true, npmproNginxOnline: true, certificate: { id: 9 }, dir: "Prod", name: "alpha.example.com" },
	{ id: 2, enabled: true, npmproNginxOnline: false, certificate: null, dir: "", name: "beta.example.com" },
	{ id: 3, enabled: false, npmproNginxOnline: false, certificate: null, dir: "Prod", name: "gamma.example.com" },
];
const opts = { searchText: (r) => r.name, getGroup: (r) => r.dir };
const ids = (list) => list.map((r) => r.id);
const parse = (qs, groups = ["Prod"]) => parseFilters(new URLSearchParams(qs), { groups });

it("falls back to all for unknown values", () => {
	assert.deepEqual(parse("status=bogus&tls=x&group=deleted&expiry=never&q=a"), {
		q: "a",
		status: "all",
		tls: "all",
		group: null,
		expiry: "all",
	});
});

it("derives the host status", () => {
	assert.deepEqual(rows.map(hostStatus), ["online", "error", "disabled"]);
});

it("filters by status, tls, group and search", () => {
	assert.deepEqual(ids(filterHosts(rows, parse("status=error"), opts)), [2]);
	assert.deepEqual(ids(filterHosts(rows, parse("tls=with"), opts)), [1]);
	assert.deepEqual(ids(filterHosts(rows, parse("tls=without"), opts)), [2, 3]);
	assert.deepEqual(ids(filterHosts(rows, parse("group=Prod"), opts)), [1, 3]);
	assert.deepEqual(ids(filterHosts(rows, parse("q=GAMMA"), opts)), [3]);
	assert.deepEqual(ids(filterHosts(rows, parse(""), opts)), [1, 2, 3]);
});

it("filters certificates by expiry", () => {
	const now = new Date("2026-10-23T12:00:00Z");
	const certs = [
		{ id: 1, provider: "letsencrypt", expiresOn: "2026-10-22T12:00:00Z", niceName: "a" },
		{ id: 2, provider: "other", expiresOn: "2026-10-30T12:00:00Z", niceName: "b" },
		{ id: 3, provider: "letsencrypt", expiresOn: "2027-01-01T00:00:00Z", niceName: "c" },
		{ id: 4, provider: "mtls", expiresOn: "2026-10-22T12:00:00Z", niceName: "d" },
	];
	assert.deepEqual(
		ids(filterCertificates(certs, parse("expiry=soon"), { searchText: (c) => c.niceName, now })),
		[1, 2],
	);
});

it("counts active filters", () => {
	const hostKinds = ["status", "tls", "group"];
	assert.equal(activeFilterCount(parse(""), hostKinds), 0);
	assert.equal(activeFilterCount(parse("status=error&q=x&group=Prod"), hostKinds), 3);
});

it("ignores filters the page does not use", () => {
	assert.equal(activeFilterCount(parse("status=error&q=x"), ["expiry"]), 1);
	assert.equal(activeFilterCount(parse("expiry=soon"), ["status", "tls", "group"]), 0);
});
