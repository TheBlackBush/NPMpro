import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import { isResolverAddress, isResolverValid, resolverAddressProblem, resolverValidate } from "./ResolverAddress.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));

// the cases of backend/test/resolver-address.test.js
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
	assert.equal(resolverAddressProblem([]), null);
	assert.equal(resolverAddressProblem(eight), null);
	assert.deepEqual(resolverAddressProblem([...eight, "10.0.0.9"]), { error: "too-many" });
	assert.deepEqual(resolverAddressProblem(["1.1.1.1", "1.1.1.1"]), { error: "duplicate", address: "1.1.1.1" });
	assert.deepEqual(resolverAddressProblem(["1.1.1.1", "dns.example"]), { error: "invalid", address: "dns.example" });
	assert.deepEqual(resolverAddressProblem("1.1.1.1"), { error: "list" });
});

it("the cache time is empty, a bare number other than 0, or ordered parts, never ms", () => {
	for (const ok of ["", "30", "30s", "5m", "1h30m", "1y2M3w4d5h6m7s"]) assert.equal(isResolverValid(ok), true, ok);
	for (const bad of ["0", "500ms", "1s500ms", "30x", "1m1h", "10 s", `${"1".repeat(32)}s`, undefined, 30]) {
		assert.equal(isResolverValid(bad), false, String(bad));
	}
});

it("a duplicate and a stored value", () => {
	assert.deepEqual(resolverValidate(rules, { resolverAddresses: ["1.1.1.1", "1.1.1.1"], resolverValid: "" }, {}), {
		resolverAddresses: "1.1.1.1 is listed twice",
	});
	// a stored value that fails the rule passes while it is unchanged, and is refused once changed
	const stored = { resolverAddresses: ["dns.example"], resolverValid: "500ms" };
	const same = { resolverAddresses: ["dns.example"], resolverValid: " 500ms " };
	assert.deepEqual(resolverValidate(rules, same, stored), {});
	const changed = { resolverAddresses: ["dns.example", "x"], resolverValid: "0" };
	assert.deepEqual(Object.keys(resolverValidate(rules, changed, stored)), ["resolverAddresses", "resolverValid"]);
});

it("the resolver fields' errors name the address and the time", () => {
	const ok = { resolverAddresses: ["1.1.1.1"], resolverValid: "" };
	assert.deepEqual(resolverValidate(rules, ok), {});
	assert.deepEqual(resolverValidate(rules, { ...ok, resolverAddresses: ["dns.example"] }), {
		resolverAddresses:
			"dns.example is not an IP address with an optional port; IPv6 goes in brackets, such as [2606:4700::1111]:53",
	});
	const nine = Array.from({ length: 9 }, (_, i) => `10.0.0.${i + 1}`);
	assert.deepEqual(resolverValidate(rules, { ...ok, resolverAddresses: nine }), {
		resolverAddresses: "At most 8 addresses",
	});
	assert.deepEqual(resolverValidate(rules, { ...ok, resolverValid: " 5m " }), {});
	assert.deepEqual(resolverValidate(rules, { ...ok, resolverValid: "0" }), {
		resolverValid: "Leave empty, or enter a time in seconds or longer such as 30s or 5m (not 0, not ms)",
	});
});
