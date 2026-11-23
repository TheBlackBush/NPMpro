import assert from "node:assert/strict";
import { it } from "node:test";
import {
	ageOf,
	ddnsStatusOf,
	familiesNeeded,
	familyLineOf,
	nextCheckIn,
	recordAddressOf,
	statusErrorItem,
} from "./DdnsStatus.js";

const NOW = Date.parse("2026-11-23T10:00:00Z");

it("says none without records or status", () => {
	assert.equal(ddnsStatusOf(undefined), "none");
	assert.equal(ddnsStatusOf({ records: 0, ipv4: { address: "203.0.113.5" } }), "none");
});

it("says paused first, then failed, waiting and ok", () => {
	const ok = { records: 1, paused: false, ipv4: { address: "203.0.113.5" }, ipv6: { address: null } };
	assert.equal(ddnsStatusOf(ok), "ok");
	assert.equal(ddnsStatusOf({ ...ok, paused: true, ipv4: { error: "x" } }), "paused");
	assert.equal(ddnsStatusOf({ ...ok, ipv4: { address: null, error: "no" } }), "failed");
	assert.equal(ddnsStatusOf({ ...ok, ipv6: { errorI18n: "error.ddns-ip-failed" } }), "failed");
	assert.equal(ddnsStatusOf({ ...ok, ipv4: { address: null } }), "waiting");
	assert.equal(ddnsStatusOf({ records: 1, paused: false }), "waiting");
	assert.equal(ddnsStatusOf({ records: 1, ipv4: { address: null }, ipv6: { address: "2001:db8::1" } }), "ok");
});

it("picks the first family that holds an error", () => {
	const v4 = { error: "four" };
	const v6 = { errorI18n: "six" };
	assert.equal(statusErrorItem({ ipv4: v4, ipv6: v6 }), v4);
	assert.equal(statusErrorItem({ ipv4: {}, ipv6: v6 }), v6);
	assert.equal(statusErrorItem({ ipv4: {}, ipv6: {} }), null);
	assert.equal(statusErrorItem(undefined), null);
});

it("counts the time to the next check in minutes, hours or days", () => {
	assert.equal(nextCheckIn(null, NOW), null);
	assert.equal(nextCheckIn("junk", NOW), null);
	assert.deepEqual(nextCheckIn("2026-11-23T09:00:00Z", NOW), { value: 1, unit: "minute" });
	assert.deepEqual(nextCheckIn("2026-11-23T10:04:10Z", NOW), { value: 5, unit: "minute" });
	assert.deepEqual(nextCheckIn("2026-11-23T12:30:00Z", NOW), { value: 3, unit: "hour" });
	assert.deepEqual(nextCheckIn("2026-11-25T10:00:00Z", NOW), { value: 2, unit: "day" });
});

it("shows the target of an alias and the written addresses of an address record", () => {
	assert.deepEqual(recordAddressOf({ kind: "alias", target: "home.example.com" }), { alias: "home.example.com" });
	assert.deepEqual(recordAddressOf({ kind: "alias" }), { alias: "" });
	const base = { kind: "address", lastIpv4: "203.0.113.5", lastIpv6: "2001:db8::1" };
	assert.deepEqual(recordAddressOf({ ...base, ipVersion: "ipv4" }), { addresses: ["203.0.113.5"] });
	assert.deepEqual(recordAddressOf({ ...base, ipVersion: "ipv6" }), { addresses: ["2001:db8::1"] });
	assert.deepEqual(recordAddressOf({ ...base, ipVersion: "both" }), { addresses: ["203.0.113.5", "2001:db8::1"] });
	assert.deepEqual(recordAddressOf({ kind: "address", ipVersion: "both" }), { addresses: [] });
});

it("picks the line of an address family", () => {
	assert.equal(familyLineOf({ address: "203.0.113.5" }, false), "address");
	assert.equal(familyLineOf({ error: "no" }, true), "failed");
	assert.equal(familyLineOf({ errorI18n: "error.ddns-ip-failed" }, false), "failed");
	assert.equal(familyLineOf({ address: null }, false), "unchecked");
	assert.equal(familyLineOf({ address: null }, true), "unknown");
	assert.equal(familyLineOf(undefined, true), "unknown");
	assert.equal(familyLineOf(undefined, false), "unchecked");
});

it("needs a family only for an enabled address record that follows it", () => {
	const none = { ipv4: false, ipv6: false };
	assert.deepEqual(familiesNeeded(undefined), none);
	assert.deepEqual(familiesNeeded([{ enabled: true, kind: "alias", ipVersion: "ipv4" }]), none);
	assert.deepEqual(familiesNeeded([{ enabled: false, kind: "address", ipVersion: "ipv6" }]), none);
	assert.deepEqual(familiesNeeded([{ enabled: true, kind: "address", ipVersion: "ipv4" }]), {
		ipv4: true,
		ipv6: false,
	});
	assert.deepEqual(familiesNeeded([{ enabled: true, kind: "address", ipVersion: "ipv6" }]), {
		ipv4: false,
		ipv6: true,
	});
	assert.deepEqual(familiesNeeded([{ enabled: true, kind: "address", ipVersion: "both" }]), {
		ipv4: true,
		ipv6: true,
	});
});

it("gives the age of a time", () => {
	assert.equal(ageOf(null, NOW), null);
	assert.deepEqual(ageOf("2026-11-23T09:58:00Z", NOW), { value: -2, unit: "minute" });
	assert.deepEqual(ageOf("2026-11-23T09:59:50Z", NOW), { value: 0, unit: "minute" });
	assert.deepEqual(ageOf("2026-11-23T10:30:00Z", NOW), { value: 0, unit: "minute" });
	assert.deepEqual(ageOf("2026-11-23T07:10:00Z", NOW), { value: -2, unit: "hour" });
	assert.deepEqual(ageOf("2026-11-20T10:00:00Z", NOW), { value: -3, unit: "day" });
});
