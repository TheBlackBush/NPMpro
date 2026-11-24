import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalIpv6, isIpv6Suffix, withSuffix } from "../lib/ddns/ipv6.js";

const ADDRESS = "2a00:1450:4001:80b:1234:5678:9abc:def0";
const BAD_SUFFIX = /suffix/u;
const BAD_ADDRESS = /not an IPv6/u;

describe("ddns ipv6 suffix", () => {
	it("keeps the first 64 bits and the suffix", () => {
		assert.equal(withSuffix(ADDRESS, "::1"), "2a00:1450:4001:80b::1");
		assert.equal(withSuffix(ADDRESS, "::a:b:c:d"), "2a00:1450:4001:80b:a:b:c:d");
		assert.equal(withSuffix("2A00:1450:4001:80B::5", "::2"), "2a00:1450:4001:80b::2");
	});

	it("accepts interface ids of at most 64 bits", () => {
		for (const text of ["::1", "::a:b:c:d", "0:0:0:0:1:2:3:4", "::ffff:ffff:ffff:ffff"]) {
			assert.equal(isIpv6Suffix(text), true, text);
		}
	});

	it("refuses a suffix over 64 bits and other text", () => {
		for (const text of [
			"1::1",
			"2a00::1",
			"::1:0:0:0:0",
			"1:2:3:4:5:6:7:8",
			"",
			"zz",
			"1.2.3.4",
			"::1::2",
			5,
			null,
		]) {
			assert.equal(isIpv6Suffix(text), false, String(text));
		}
		assert.throws(() => withSuffix(ADDRESS, "1::1"), BAD_SUFFIX);
		assert.throws(() => withSuffix("not an address", "::1"), BAD_ADDRESS);
	});

	it("writes one canonical spelling to compare two", () => {
		assert.equal(canonicalIpv6("2A00:1450:4001:080B:0:0:0:1"), "2a00:1450:4001:80b::1");
		assert.equal(canonicalIpv6("81.2.69.160"), "81.2.69.160");
	});
});
