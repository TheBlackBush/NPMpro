import assert from "node:assert/strict";
import { it } from "node:test";
import { createHostCache, MAX_ENTRIES, REUSE_MS } from "../lib/dns-check/host-cache.js";
import { canonical, checkName } from "../lib/dns-check/host-check.js";

const IP4 = "203.0.113.7";
const IP6 = "2001:db8::7";

const fakeLookup = (map) => (name, type) => {
	const entry = map[`${name}|${type}`];
	if (entry === undefined) return Promise.resolve({ ok: false, code: "nxdomain" });
	return Promise.resolve(Array.isArray(entry) ? { ok: true, values: entry } : { ok: false, code: entry.code });
};
const publicIp = ({ ipv4 = IP4, ipv6 = IP6 } = {}) => {
	const asked = { ipv6: 0 };
	return {
		ipv4,
		ipv6: () => {
			asked.ipv6 += 1;
			return Promise.resolve(ipv6);
		},
		asked,
	};
};
const noCoverage = () => Promise.resolve(null);
const run = ({ name = "app.example.com", dns = {}, ip = publicIp(), coverage = noCoverage } = {}) =>
	checkName({ name, publicIp: ip, lookup: fakeLookup(dns), coverage });

it("is here by DNS, and asks no IPv6 address when the name has no AAAA record", async () => {
	const ip = publicIp();
	const result = await run({ dns: { "app.example.com|A": [IP4] }, ip });
	assert.equal(result.state, "here");
	assert.equal(result.via, "dns");
	assert.equal(result.proxied, false);
	assert.deepEqual(result.ipv4, { found: [IP4], public: IP4 });
	assert.equal(ip.asked.ipv6, 0);
});

it("is here by DNS with an IPv6 spelled another way", async () => {
	const result = await run({
		dns: { "app.example.com|A": [IP4], "app.example.com|AAAA": ["2001:0db8:0:0:0:0:0:7"] },
	});
	assert.equal(result.state, "here");
	assert.equal(canonical("2001:0DB8::0007"), "2001:db8::7");
});

it("is here by the provider's record, and proxied when the record is", async () => {
	const dns = { "app.example.com|A": ["104.16.0.1"], "app.example.com|AAAA": ["2606:4700::1"] };
	const asked = [];
	const coverage = (name, { dnsHere }) => {
		asked.push([name, dnsHere]);
		return Promise.resolve({ record: { values: [IP4], proxied: true }, wildcard: null });
	};
	const result = await run({ dns, coverage });
	assert.deepEqual(asked, [["app.example.com", false]]);
	assert.equal(result.state, "here");
	assert.equal(result.via, "record");
	assert.equal(result.proxied, true);
	assert.deepEqual(result.ipv4.found, ["104.16.0.1"]);
});

it("is here by the wildcard only when the name has no record of its own", async () => {
	const wildcard = { name: "*.example.com", values: [IP4], proxied: false };
	const dns = { "app.example.com|A": ["198.51.100.1"] };
	const found = await run({ dns, coverage: async () => ({ record: null, wildcard }) });
	assert.equal(found.state, "here");
	assert.equal(found.via, "wildcard");
	const own = await run({
		dns,
		coverage: () => Promise.resolve({ record: { values: ["198.51.100.1"], proxied: false }, wildcard }),
	});
	assert.equal(own.state, "elsewhere");
});

it("is partly when A is here and AAAA elsewhere, or the reverse", async () => {
	const a = await run({ dns: { "app.example.com|A": [IP4], "app.example.com|AAAA": ["2001:db8::99"] } });
	assert.equal(a.state, "partly");
	assert.equal(a.via, "dns");
	const b = await run({ dns: { "app.example.com|A": ["198.51.100.1"], "app.example.com|AAAA": [IP6] } });
	assert.equal(b.state, "partly");
});

it("is elsewhere with the addresses it found", async () => {
	const result = await run({ dns: { "app.example.com|A": ["198.51.100.1"] } });
	assert.equal(result.state, "elsewhere");
	assert.deepEqual(result.ipv4.found, ["198.51.100.1"]);
	assert.deepEqual(result.ipv6.found, []);
});

it("is none with no A and no AAAA record, and elsewhere when only the provider has a record", async () => {
	const none = await run({ dns: { "app.example.com|A": { code: "nodata" } } });
	assert.equal(none.state, "none");
	const only = await run({
		coverage: () => Promise.resolve({ record: { values: ["198.51.100.1"], proxied: false }, wildcard: null }),
	});
	assert.equal(only.state, "elsewhere");
	assert.deepEqual(only.ipv4.found, ["198.51.100.1"]);
});

it("is unknown when a lookup fails, with the reason", async () => {
	const result = await run({ dns: { "app.example.com|A": { code: "timeout" } } });
	assert.equal(result.state, "unknown");
	assert.equal(result.reason, "lookup-timeout");
});

it("is unknown when the public address is unknown, and none when there is nothing to compare", async () => {
	const unknown = await run({ dns: { "app.example.com|A": [IP4] }, ip: publicIp({ ipv4: null }) });
	assert.equal(unknown.state, "unknown");
	assert.equal(unknown.reason, "public-address-unknown");
	const none = await run({ ip: publicIp({ ipv4: null }) });
	assert.equal(none.state, "none");
	const six = await run({
		dns: { "app.example.com|A": [IP4], "app.example.com|AAAA": [IP6] },
		ip: publicIp({ ipv6: null }),
	});
	assert.equal(six.state, "unknown");
	assert.equal(six.reason, "public-ipv6-unknown");
});

it("skips wildcard and regular expression names without a lookup", async () => {
	for (const name of ["*.example.com", "~^app[0-9]+\\.example\\.com$", "a b.example.com"]) {
		const result = await checkName({
			name,
			publicIp: publicIp(),
			lookup: () => {
				throw new Error("no lookup");
			},
			coverage: noCoverage,
		});
		assert.equal(result.state, "skipped", name);
		assert.equal(result.reason, "skipped-pattern");
	}
});

it("keeps the DNS state and names a failed provider read, scrubbed by the caller", async () => {
	const failed = () => Promise.resolve({ record: null, wildcard: null, error: "The provider refused the key" });
	const here = await run({ dns: { "app.example.com|A": [IP4] }, coverage: failed });
	assert.equal(here.state, "here");
	assert.equal(here.reason, "provider-read-failed");
	assert.equal(here.message, "The provider refused the key");
	const away = await run({ dns: { "app.example.com|A": ["198.51.100.1"] }, coverage: failed });
	assert.equal(away.state, "unknown");
	assert.equal(away.message, "The provider refused the key");
});

it("passes dnsHere to the coverage so a provider can skip the read", async () => {
	let seen = null;
	await run({
		dns: { "app.example.com|A": [IP4] },
		coverage: (_name, options) => {
			seen = options;
			return Promise.resolve(null);
		},
	});
	assert.deepEqual(seen, { dnsHere: true });
});

it("keeps a host's result for 30 s per scope, clears it by the service's or the API's type, and drops the oldest", () => {
	let time = 1000;
	const cache = createHostCache({ now: () => time });
	cache.set("proxy", 1, "all", { checked_on: "t", names: [] });
	cache.set("proxy", 1, "view", { checked_on: "t", names: [] });
	assert.ok(cache.fresh(cache.get("proxy", 1, "all")));
	time += REUSE_MS;
	assert.ok(!cache.fresh(cache.get("proxy", 1, "all")));
	assert.ok(!cache.fresh(undefined));
	assert.equal(cache.ofScope("view").length, 1);
	cache.clearHost("proxy_host", 1);
	assert.equal(cache.size(), 0);
	cache.set("dead", 2, "all", { names: [] });
	cache.clearHost("dead", "2");
	assert.equal(cache.size(), 0);
	for (let id = 1; id <= MAX_ENTRIES + 5; id++) cache.set("proxy", id, "all", { names: [] });
	assert.equal(cache.size(), MAX_ENTRIES);
	assert.equal(cache.get("proxy", 1, "all"), undefined);
	assert.ok(cache.get("proxy", MAX_ENTRIES + 5, "all"));
});
