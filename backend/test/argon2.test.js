import assert from "node:assert/strict";
import { it } from "node:test";
import { hash, hashParams, verify } from "../lib/argon2.js";

// lib/argon2.js: the cost of a new hash. The image runs the strong cost; only the backend tests lower it.

const STRONG = { memory: 65536, passes: 3, parallelism: 4 };
const MINIMAL = { memory: 19456, passes: 2, parallelism: 1 };
const TEST_ROOT = { NPMPRO_TEST_ROOT: "/tmp/npa-x", NPMPRO_TEST_ARGON2: "fast" };
const costOf = (stored) => {
	const { memory, passes, parallelism } = JSON.parse(stored);
	return { memory, passes, parallelism };
};

it("hashes with RFC 9106's second recommended option, and with the OWASP minimum for random secrets", async () => {
	assert.deepEqual(hashParams(false, {}), STRONG);
	assert.deepEqual(hashParams(true, {}), MINIMAL);
	// this file starts no API, so nothing set the test cost: a real hash carries the production cost
	assert.equal(process.env.NPMPRO_TEST_ARGON2, undefined);
	assert.deepEqual(costOf(await hash("a password")), STRONG);
	assert.deepEqual(costOf(await hash("a backup code", true)), MINIMAL);
});

it("keeps the production cost when the test switch is set without the tests' root", () => {
	assert.deepEqual(hashParams(false, { NPMPRO_TEST_ARGON2: "fast" }), STRONG);
	assert.deepEqual(hashParams(true, { NPMPRO_TEST_ARGON2: "fast" }), MINIMAL);
	assert.deepEqual(hashParams(false, { NPMPRO_TEST_ROOT: "/tmp/npa-x" }), STRONG);
	assert.deepEqual(hashParams(false, { NPMPRO_TEST_ROOT: "/tmp/npa-x", NPMPRO_TEST_ARGON2: "1" }), STRONG);
	assert.deepEqual(hashParams(false, { NPMPRO_TEST_ROOT: "", NPMPRO_TEST_ARGON2: "fast" }), STRONG);
});

it("lowers the cost under the tests' root, and verify reads the cost each hash carries", async () => {
	const cheap = hashParams(false, TEST_ROOT);
	assert.deepEqual(cheap, hashParams(true, TEST_ROOT));
	assert.ok(cheap.memory < MINIMAL.memory && cheap.passes <= MINIMAL.passes);
	const strong = await hash("secret");
	assert.equal(await verify("secret", strong), true);
	assert.equal(await verify("other", strong), false);
});
