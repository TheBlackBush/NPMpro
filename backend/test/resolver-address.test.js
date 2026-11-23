import assert from "node:assert/strict";
import { it } from "node:test";
import { isResolverAddress, resolverAddressList } from "../lib/resolver-address.js";

const AT_MOST_8 = /at most 8/u;
const TWICE = /"1\.1\.1\.1" is listed twice/u;
const NOT_DNS = /"dns\.example" is not a DNS server address/u;
const IS_LIST = /list/u;

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
	assert.match(resolverAddressList([...eight, "10.0.0.9"]), AT_MOST_8);
	assert.match(resolverAddressList(["1.1.1.1", "1.1.1.1"]), TWICE);
	assert.match(resolverAddressList(["1.1.1.1", "dns.example"]), NOT_DNS);
	assert.match(resolverAddressList("1.1.1.1"), IS_LIST);
});
