import assert from "node:assert/strict";
import { it } from "node:test";
import { activeFilterCount, filterCertificates, filterHosts, hostStatus, parseFilters } from "./ListFilters.js";

const rows = [
	{
		id: 1,
		enabled: true,
		npmproNginxOnline: true,
		certificate: { id: 9 },
		dir: "Prod",
		name: "alpha.example.com",
		tags: ["Prod", "Lab"],
	},
	{
		id: 2,
		enabled: true,
		npmproNginxOnline: false,
		certificate: null,
		dir: "",
		name: "beta.example.com",
		tags: ["prod"],
	},
	{
		id: 3,
		enabled: false,
		npmproNginxOnline: false,
		certificate: null,
		dir: "Prod",
		name: "gamma.example.com",
		tags: [],
	},
];
const opts = { searchText: (r) => r.name, getGroup: (r) => r.dir, getTags: (r) => r.tags };
const ids = (list) => list.map((r) => r.id);
const parse = (qs, groups = ["Prod"], tags = ["Prod", "Lab"]) =>
	parseFilters(new URLSearchParams(qs), { groups, tags });

it("falls back to all for unknown values", () => {
	assert.deepEqual(parse("status=bogus&tls=x&group=deleted&expiry=never&q=a"), {
		q: "a",
		status: "all",
		tls: "all",
		group: null,
		tags: [],
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

it("filters certificates by the lifetime window", () => {
	const now = new Date("2026-10-23T12:00:00Z");
	const certs = [
		// a 6 day certificate with 4 days left: outside its 2 day window
		{ id: 1, provider: "letsencrypt", expiresOn: "2026-10-27T12:00:00Z", npmproValidFrom: "2026-10-21T12:00:00Z" },
		{ id: 2, provider: "letsencrypt", expiresOn: "2026-10-24T12:00:00Z", npmproValidFrom: "2026-10-18T12:00:00Z" },
		{ id: 3, provider: "letsencrypt", expiresOn: "2026-11-01T12:00:00Z", npmproValidFrom: "2026-08-03T12:00:00Z" },
	];
	const options = { searchText: () => "", now };
	assert.deepEqual(ids(filterCertificates(certs, parse("expiry=soon"), options)), [2, 3]);
	// cert 3 has 9 days left: ok with 7 warning days, soon with 10
	assert.deepEqual(ids(filterCertificates(certs, parse("expiry=soon"), { ...options, days: 7 })), [2]);
	assert.deepEqual(ids(filterCertificates(certs, parse("expiry=soon"), { ...options, days: 10 })), [2, 3]);
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

it("reads tags from the URL in any case, once, unknown ones dropped", () => {
	assert.deepEqual(parse("tag=prod&tag=PROD&tag=gone&tag=lab").tags, ["Prod", "Lab"]);
});

it("shows only hosts that have every picked tag", () => {
	assert.deepEqual(ids(filterHosts(rows, parse("tag=Prod"), opts)), [1, 2]);
	assert.deepEqual(ids(filterHosts(rows, parse("tag=Prod&tag=Lab"), opts)), [1]);
});

it("counts the Tags filter once", () => {
	assert.equal(activeFilterCount(parse("tag=Prod&tag=Lab"), ["status", "tls", "group", "tags"]), 1);
	assert.equal(activeFilterCount(parse("tag=Prod"), ["status"]), 0);
});

it("works without tag data: no allowed tags, no getTags, filters from before tags", () => {
	assert.deepEqual(parseFilters(new URLSearchParams("tag=Prod")).tags, []);
	assert.deepEqual(
		ids(
			filterHosts(
				rows,
				{ ...parse(""), tags: ["Prod"] },
				{ searchText: opts.searchText, getGroup: opts.getGroup },
			),
		),
		[],
	);
	const { tags: _tags, ...old } = parse("");
	assert.deepEqual(ids(filterHosts(rows, old, opts)), [1, 2, 3]);
	assert.equal(activeFilterCount(old, ["tags"]), 0);
});
