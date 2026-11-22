import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { coveringZone, matchNames, uncoveredBy } from "./DnsDomainMatch.js";

const CASES = JSON.parse(
	readFileSync(new URL("../../../backend/test/fixtures/dns-domain-cases.json", import.meta.url), "utf8"),
);

it("matches names like the backend (shared cases)", () => {
	for (const { title, names, userId, expected } of CASES.match) {
		assert.deepEqual(matchNames(names, CASES.zones, userId), expected, title);
	}
});

it("lists uncovered names like the backend (shared cases)", () => {
	for (const { title, credentialId, names, expected } of CASES.uncovered) {
		assert.deepEqual(uncoveredBy(names, credentialId, CASES.zones), expected, title);
	}
});

it("gives the covering zone or null", () => {
	assert.deepEqual(coveringZone("a.lab.example.com", CASES.zones, 1), {
		zone: "lab.example.com",
		credentialIds: [2],
	});
	assert.equal(coveringZone("example.net", CASES.zones, 1), null);
});
