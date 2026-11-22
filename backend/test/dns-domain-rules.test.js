import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { domainToUnicode } from "node:url";
import { coveringZone, matchNames, uncoveredBy } from "../lib/dns-domain-match.js";
import { normalizeDomainName } from "../lib/dns-domain-name.js";
import { createKeyedLock } from "../lib/keyed-lock.js";

const BOOM = /boom/u;
const SYNC = /sync/u;
const CASES = JSON.parse(readFileSync(new URL("fixtures/dns-domain-cases.json", import.meta.url), "utf8"));

it("stores a DNS domain lower case and as punycode, and refuses what is no zone name (shared cases)", () => {
	for (const [input, expected] of CASES.names) assert.deepEqual(normalizeDomainName(input), expected, input);
});

it("the stored names of the display cases show as the frontend shows them (shared cases)", () => {
	for (const [name, shown] of CASES.display) {
		assert.equal(normalizeDomainName(shown).name, name, shown);
		assert.equal(domainToUnicode(name), shown, name);
	}
});

it("refuses anything that is not a string", () => {
	for (const input of [null, undefined, 42, ["a.com"]]) {
		assert.deepEqual(normalizeDomainName(input), { error: "error.dns-domain-invalid" }, String(input));
	}
});

it("matches names to the credential with the longest covering zone (shared cases)", () => {
	for (const { title, names, userId, expected } of CASES.match) {
		assert.deepEqual(matchNames(names, CASES.zones, userId), expected, title);
	}
});

it("lists the names a credential's zones do not cover (shared cases)", () => {
	for (const { title, credentialId, names, expected } of CASES.uncovered) {
		assert.deepEqual(uncoveredBy(names, credentialId, CASES.zones), expected, title);
	}
});

it("gives the covering zone and its credentials, or null", () => {
	assert.deepEqual(coveringZone("a.lab.example.com", CASES.zones, 1), {
		zone: "lab.example.com",
		credentialIds: [2],
	});
	assert.deepEqual(coveringZone("a.team.io", CASES.zones, 1), { zone: "team.io", credentialIds: [5, 6] });
	assert.equal(coveringZone("example.net", CASES.zones, 1), null);
	assert.equal(coveringZone("", CASES.zones, 1), null);
	assert.equal(coveringZone("a.example.com", [], 1), null);
});

it("runs one function at a time per key, other keys freely, and frees a key after a failure", async () => {
	const lock = createKeyedLock();
	const order = [];
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const first = lock(1, async () => {
		await gate;
		order.push("first");
	});
	const second = lock(1, async () => order.push("second"));
	await lock(2, async () => order.push("other"));
	assert.deepEqual(order, ["other"]);
	release();
	await Promise.all([first, second]);
	assert.deepEqual(order, ["other", "first", "second"]);
	await assert.rejects(
		lock(3, () => Promise.reject(new Error("boom"))),
		BOOM,
	);
	assert.equal(await lock(3, async () => "free"), "free");
	assert.equal(await lock("3", async () => "same key as a string"), "same key as a string");
});

it("frees a key after a synchronous throw and still runs the run queued behind it", async () => {
	const lock = createKeyedLock();
	const failing = lock(4, () => {
		throw new Error("sync");
	});
	const queued = lock(4, () => "queued ran");
	await assert.rejects(failing, SYNC);
	assert.equal(await queued, "queued ran");
});

it("keeps no state for a key once its work has settled", async () => {
	const lock = createKeyedLock();
	const order = [];
	await lock(5, () => order.push("a"));
	await new Promise((resolve) => setImmediate(resolve));
	// a key with no pending work starts at once, in the same tick as the call
	const run = lock(5, () => order.push("b"));
	await run;
	assert.deepEqual(order, ["a", "b"]);
});

it("calls each run without arguments: no run sees the result of the run before it", async () => {
	const lock = createKeyedLock();
	await lock(6, () => "the first owner's data");
	const pending = lock(6, () => "queued result");
	const seen = await lock(6, (...args) => args);
	assert.equal(await pending, "queued result");
	assert.deepEqual(seen, []);
});
