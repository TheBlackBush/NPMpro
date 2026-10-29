import assert from "node:assert/strict";
import { it } from "node:test";
import { pathHash } from "../lib/traffic/path-hash.js";

it("gives a stable 53-bit number per path", () => {
	assert.equal(pathHash("/a"), pathHash("/a"));
	assert.notEqual(pathHash("/a"), pathHash("/b"));
	assert.notEqual(pathHash("/a"), pathHash("/A"));
	for (const path of ["/", "/a", "/café", `/${"x".repeat(199)}`]) {
		const hash = pathHash(path);
		assert.ok(Number.isSafeInteger(hash) && hash >= 0, path);
	}
});
