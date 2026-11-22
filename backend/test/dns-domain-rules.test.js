import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { coveringZone, matchNames, uncoveredBy } from "../lib/dns-domain-match.js";
import { normalizeDomainName } from "../lib/dns-domain-name.js";
import { createKeyedLock } from "../lib/keyed-lock.js";

const CASES = JSON.parse(readFileSync(new URL("fixtures/dns-domain-cases.json", import.meta.url), "utf8"));

it("stores a DNS domain lower case and as punycode, and refuses what is no zone name (shared cases)", () => {
	for (const [input, expected] of CASES.names) assert.deepEqual(normalizeDomainName(input), expected, input);
});

it("refuses a label over 63, a name over 253 and anything that is not a string", () => {
	assert.deepEqual(normalizeDomainName(`${"a".repeat(63)}.example.com`), { name: `${"a".repeat(63)}.example.com` });
	for (const input of [`${"a".repeat(64)}.example.com`, `${"a.".repeat(126)}example.com`, null, 42, ["a.com"]]) {
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
		lock(3, async () => {
			throw new Error("boom");
		}),
		/boom/u,
	);
	assert.equal(await lock(3, async () => "free"), "free");
	assert.equal(await lock("3", async () => "same key as a string"), "same key as a string");
});
