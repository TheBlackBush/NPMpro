import assert from "node:assert/strict";
import { it } from "node:test";
import errs from "../lib/error.js";
import { handleMessage, INSTRUCTIONS, PROTOCOL_VERSIONS } from "../lib/mcp/server.js";

const INVALID = /Invalid arguments/u;
const DENIED = /Permission Denied/u;
const INTERNAL = /Internal Error/u;
const DETAIL = /secret detail/u;
const echoSchema = {
	type: "object",
	properties: { text: { type: "string" } },
	required: ["text"],
	additionalProperties: false,
};
const tools = [
	{ name: "echo", run: async (_, args) => ({ said: args.text }) },
	{
		name: "forbidden",
		run: () => {
			throw new errs.PermissionError();
		},
	},
	{
		name: "broken",
		run: () => {
			throw new Error("secret detail");
		},
	},
];
const registry = {
	visibleTools: () => tools,
	findTool: (_, name) => tools.find((item) => item.name === name) ?? null,
	describe: (tool) => ({ name: tool.name, description: tool.name, inputSchema: { ...echoSchema, required: [] } }),
};
const strictRegistry = {
	...registry,
	describe: (tool) => ({ name: tool.name, description: tool.name, inputSchema: structuredClone(echoSchema) }),
};
const call = (message, reg = registry) => handleMessage(message, { access: {}, registry: reg, version: "9.9.9" });
const rpc = (method, params) => ({ jsonrpc: "2.0", id: 1, method, params });

it("negotiates the protocol version", async () => {
	const kept = await call(rpc("initialize", { protocolVersion: "2025-06-18" }));
	assert.equal(kept.result.protocolVersion, "2025-06-18");
	const other = await call(rpc("initialize", { protocolVersion: "1999-01-01" }));
	assert.equal(other.result.protocolVersion, PROTOCOL_VERSIONS[0]);
	assert.equal(other.result.protocolVersion, "2025-11-25");
	assert.ok(other.result.capabilities.tools);
	assert.equal(other.result.serverInfo.name, "npmpro");
	assert.equal(other.result.serverInfo.version, "9.9.9");
	assert.equal(other.result.instructions, INSTRUCTIONS);
});

it("answers a notification with null, ping with {}", async () => {
	assert.equal(await call({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
	assert.deepEqual((await call(rpc("ping"))).result, {});
});

it("refuses an unknown method, a batch and a wrong version", async () => {
	assert.equal((await call(rpc("nope"))).error.code, -32601);
	assert.equal((await call([rpc("ping")])).error.code, -32600);
	assert.equal((await call({ jsonrpc: "1.0", id: 1, method: "ping" })).error.code, -32600);
	assert.equal((await call(null)).error.code, -32600);
});

it("lists the visible tools", async () => {
	const answer = await call(rpc("tools/list"));
	assert.deepEqual(
		answer.result.tools.map((tool) => tool.name),
		["echo", "forbidden", "broken"],
	);
});

it("calls a tool", async () => {
	const answer = await call(rpc("tools/call", { name: "echo", arguments: { text: "hi" } }));
	assert.deepEqual(JSON.parse(answer.result.content[0].text), { said: "hi" });
	assert.deepEqual(answer.result.structuredContent, { said: "hi" });
	assert.equal(answer.result.isError, undefined);
});

it("wraps an array result in items", async () => {
	const only = [{ name: "list", run: async () => [1, 2] }];
	const list = { ...registry, visibleTools: () => only, findTool: () => only[0] };
	const answer = await call(rpc("tools/call", { name: "list" }), list);
	assert.deepEqual(answer.result.structuredContent, { items: [1, 2] });
});

it("returns invalid arguments, public errors and internal errors as tool errors", async () => {
	const invalid = await call(rpc("tools/call", { name: "echo", arguments: {} }), strictRegistry);
	assert.equal(invalid.result.isError, true);
	assert.match(invalid.result.content[0].text, INVALID);
	const denied = await call(rpc("tools/call", { name: "forbidden" }));
	assert.equal(denied.result.isError, true);
	assert.match(denied.result.content[0].text, DENIED);
	const broken = await call(rpc("tools/call", { name: "broken" }));
	assert.equal(broken.result.isError, true);
	assert.match(broken.result.content[0].text, INTERNAL);
	assert.doesNotMatch(broken.result.content[0].text, DETAIL);
});

it("answers an unknown tool with -32602", async () => {
	assert.equal((await call(rpc("tools/call", { name: "missing" }))).error.code, -32602);
});

it("answers a client's response message with nothing, and refuses a bad id", async () => {
	assert.equal(await call({ jsonrpc: "2.0", id: 1, result: {} }), null);
	assert.equal(await call({ jsonrpc: "2.0", id: "a", error: { code: -1, message: "x" } }), null);
	for (const id of [null, {}, true]) {
		const bad = await call({ jsonrpc: "2.0", id, method: "ping" });
		assert.equal(bad.error.code, -32600);
	}
	assert.equal((await call({ jsonrpc: "2.0", id: "s", method: "ping" })).id, "s");
});
