import assert from "node:assert/strict";
import { it } from "node:test";
import { isResolverAddress, resolverAddressList } from "../lib/resolver-address.js";

it("accepts an IPv4 address or a bracketed IPv6 address with an optional port", () => {
	for (const ok of [
		"1.1.1.1",
		"1.1.1.1:53",
		"[2606:4700::1111]",
		"[2606:4700::1111]:5353",
		"[::1]:53",
		"1.1.1.1:65535",
	]) {
		assert.equal(isResolverAddress(ok), true, ok);
	}
});

it("refuses host names, bare IPv6, bad ports and malformed addresses", () => {
	const bad = [
		"dns.example",
		"2606:4700::1111",
		"1.1.1.1:0",
		"1.1.1.1:65536",
		"1.1.1",
		"[1.1.1.1]",
		"1.1.1.1 :53",
		"300.1.1.1",
		"[zz::1]",
		"",
	];
	for (const text of bad) assert.equal(isResolverAddress(text), false, text);
	assert.equal(isResolverAddress(undefined), false);
	assert.equal(isResolverAddress(7), false);
});

it("checks a list: at most 8, no duplicates, each a resolver address", () => {
	const eight = Array.from({ length: 8 }, (_, i) => `10.0.0.${i + 1}`);
	assert.equal(resolverAddressList([]), null);
	assert.equal(resolverAddressList(eight), null);
	assert.match(resolverAddressList([...eight, "10.0.0.9"]), /at most 8/u);
	assert.match(resolverAddressList(["1.1.1.1", "1.1.1.1"]), /"1\.1\.1\.1" is listed twice/u);
	assert.match(resolverAddressList(["1.1.1.1", "dns.example"]), /"dns\.example" is not a DNS server address/u);
	assert.match(resolverAddressList("1.1.1.1"), /list/u);
});
