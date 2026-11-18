import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { getCompiledSchema } from "../schema/index.js";

// the order of the UI menu, then the Settings sections, then the technical groups (item 27 PR 4)
const EM_DASH = /\u2014/u;
const WHOLE_TOKEN = /npmpro_[0-9a-f]{16}_[\w-]{43}/u;
const TAG_ORDER = [
	"Dashboard",
	"Proxy Hosts",
	"Redirection Hosts",
	"404 Hosts",
	"Streams",
	"Certificates",
	"DNS Credentials",
	"Access Lists",
	"Monitoring",
	"Settings",
	"Backups",
	"Database",
	"Users",
	"Audit Log",
	"API Tokens",
	"MCP",
	"Sign-in",
	"System",
	"Admin Port Checks",
];

const operations = (schema) =>
	Object.entries(schema.paths).flatMap(([path, methods]) =>
		Object.entries(methods).map(([method, op]) => ({ key: `${method} ${path}`, path, op })),
	);

it("lists the tags in the menu order, each with an intro", async () => {
	const schema = await getCompiledSchema();
	assert.deepEqual(
		schema.tags.map((tag) => tag.name),
		TAG_ORDER,
	);
	for (const tag of schema.tags) assert.ok(tag.description.length >= 60, `${tag.name} has an intro`);
});

it("puts every operation under exactly one listed tag, and every tag has operations", async () => {
	const schema = await getCompiledSchema();
	const used = new Set();
	for (const { key, op } of operations(schema)) {
		assert.equal(op.tags?.length, 1, key);
		assert.ok(TAG_ORDER.includes(op.tags[0]), `${key}: ${op.tags[0]}`);
		used.add(op.tags[0]);
	}
	assert.deepEqual(
		TAG_ORDER.filter((name) => !used.has(name)),
		[],
	);
});

it("splits DNS credentials from certificates and gathers the sign-in routes", async () => {
	const schema = await getCompiledSchema();
	const tagOf = (method, path) => schema.paths[path][method].tags[0];
	assert.equal(tagOf("get", "/nginx/dns-credentials"), "DNS Credentials");
	assert.equal(tagOf("get", "/nginx/certificates"), "Certificates");
	assert.equal(tagOf("post", "/users/setup"), "Sign-in");
	assert.equal(tagOf("get", "/oidc/callback"), "Sign-in");
	assert.equal(tagOf("post", "/tokens"), "Sign-in");
	assert.equal(tagOf("get", "/"), "System");
	assert.equal(tagOf("get", "/reports/hosts"), "Dashboard");
	assert.equal(tagOf("post", "/mcp"), "MCP");
});

it("starts with the Getting started intro from getting-started.md", async () => {
	const schema = await getCompiledSchema();
	const text = readFileSync(new URL("../schema/getting-started.md", import.meta.url), "utf8");
	assert.equal(schema.info.description, text);
	for (const heading of [
		"## Getting started",
		"## What a token may do",
		"## Examples",
		"## MCP for AI assistants",
		"## Limits and errors",
	]) {
		assert.ok(text.includes(`\n${heading}\n`), heading);
	}
	assert.doesNotMatch(text, EM_DASH);
	assert.doesNotMatch(text, WHOLE_TOKEN, "no whole token");
});
