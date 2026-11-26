import assert from "node:assert/strict";
import { it } from "node:test";
import { readPayload } from "./ApiResponse.js";

it("gives null for a 204 without a body", async () => {
	assert.equal(await readPayload(new Response(null, { status: 204 })), null);
});

it("gives null for a 202 without a body", async () => {
	assert.equal(await readPayload(new Response(null, { status: 202 })), null);
});

it("still parses a 200 with JSON", async () => {
	assert.deepEqual(await readPayload(new Response('{"a_b":1}', { status: 200 })), { a_b: 1 });
});

it("still throws on a 200 with an empty body", async () => {
	await assert.rejects(readPayload(new Response(null, { status: 200 })));
});

it("gives an empty object for a failed answer that is not JSON", async () => {
	assert.deepEqual(await readPayload(new Response("<html>", { status: 502 })), {});
});
