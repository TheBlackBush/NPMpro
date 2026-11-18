import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { getCompiledSchema } from "../schema/index.js";

// the order of the UI menu, then the Settings sections, then the technical groups (item 27 PR 4)
const EM_DASH = /\u2014/u;
const USE_A_TOKEN = /\*\*Use a token\*\*/u;
const OLD_WORDS = /Authorize|bearerAuth|cookieAuth|Swagger/u;
const WHOLE_TOKEN = /npmpro_[0-9a-f]{16}_[\w-]{43}/u;
const TAG_ORDER = [
	"reports",
	"proxy-hosts",
	"redirection-hosts",
	"404-hosts",
	"streams",
	"certificates",
	"access-lists",
	"monitoring",
	"settings",
	"backups",
	"database",
	"users",
	"audit-log",
	"api-tokens",
	"mcp",
	"tokens",
	"public",
	"version",
	"docs",
	"auth",
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
	for (const tag of schema.tags)
		assert.ok(tag.description.length >= (tag.name === "version" ? 30 : 60), `${tag.name} has an intro`);
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

it("puts every route under its API path name", async () => {
	const schema = await getCompiledSchema();
	const tagOf = (method, path) => schema.paths[path][method].tags[0];
	assert.equal(tagOf("get", "/nginx/dns-credentials"), "certificates");
	assert.equal(tagOf("get", "/nginx/certificates"), "certificates");
	assert.equal(tagOf("post", "/users/setup"), "public");
	assert.equal(tagOf("get", "/oidc/callback"), "public");
	assert.equal(tagOf("get", "/oidc/icon"), "public");
	assert.equal(tagOf("get", "/"), "public");
	assert.equal(tagOf("post", "/tokens"), "tokens");
	assert.equal(tagOf("get", "/version/check"), "version");
	assert.equal(tagOf("get", "/schema"), "docs");
	assert.equal(tagOf("get", "/auth/admin"), "auth");
	assert.equal(tagOf("get", "/reports/hosts"), "reports");
	assert.equal(tagOf("post", "/mcp"), "mcp");
});

it("says how this page runs requests, without Swagger words", async () => {
	const schema = await getCompiledSchema();
	assert.match(schema.info.description, USE_A_TOKEN);
	assert.doesNotMatch(schema.info.description, OLD_WORDS);
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

// the API reference page builds its view model from this schema: every route needs its own anchor and a group
it("the API reference view model of the real schema has one anchor per route, in a group", async () => {
	const { buildReference, legacyAnchor } = await import("../../frontend/src/modules/ApiReference.js");
	const schema = await getCompiledSchema();
	const operationIds = Object.values(schema.paths).flatMap((item) =>
		["get", "post", "put", "patch", "delete"].filter((m) => item[m]).map((m) => item[m].operationId),
	);
	const reference = buildReference(schema);
	const routes = reference.groups.flatMap((group) => group.operations);
	assert.equal(routes.length, operationIds.length, "every route lands in a group");
	assert.equal(new Set(routes.map((route) => route.anchor)).size, routes.length, "unique anchors");
	for (const route of routes) {
		assert.ok(route.needs, `${route.method} ${route.path} has a Needs line`);
		assert.equal(route.auth === "session", route.needs.includes("(API tokens are refused)"), route.anchor);
		assert.equal(route.auth === "public", route.needs.startsWith("nothing (public"), route.anchor);
		assert.equal(legacyAnchor(`#/${route.tag}/${route.operationId}`, reference), route.anchor);
	}
	assert.equal(new Set(operationIds).size, operationIds.length, "unique operationIds");
});
