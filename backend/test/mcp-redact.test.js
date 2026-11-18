import assert from "node:assert/strict";
import { it } from "node:test";
import { redact, SECRET_KEYS } from "../lib/mcp/redact.js";

it("removes every secret key at any depth and keeps the rest", () => {
	const secrets = Object.fromEntries([...SECRET_KEYS].map((key) => [key, "x"]));
	const input = {
		id: 1,
		name: "kept",
		...secrets,
		list: [{ id: 2, ...secrets, nested: { deep: [{ ...secrets, ok: true }] } }, 3, null, "text"],
	};
	assert.deepEqual(redact(input), {
		id: 1,
		name: "kept",
		list: [{ id: 2, nested: { deep: [{ ok: true }] } }, 3, null, "text"],
	});
});

it("turns a Date into ISO text and leaves primitives alone", () => {
	assert.equal(redact(new Date("2026-01-02T03:04:05Z")), "2026-01-02T03:04:05.000Z");
	assert.deepEqual(redact({ at: new Date(0) }), { at: "1970-01-01T00:00:00.000Z" });
	assert.equal(redact(5), 5);
	assert.equal(redact(null), null);
});
