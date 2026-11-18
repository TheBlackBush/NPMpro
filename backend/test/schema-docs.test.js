import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import Ajv from "ajv/dist/2020.js";
import { getCompiledSchema } from "../schema/index.js";

// Item 27 PR 4 writes the reference part by part: operations of a pending tag or path are not checked yet. Each
// writing task removes its part; the last one removes both lists.
const PENDING_TAGS = new Set([
	"Dashboard",
	"Monitoring",
	"Backups",
	"Database",
	"Users",
	"Audit Log",
	"API Tokens",
	"MCP",
	"Sign-in",
	"System",
	"Admin Port Checks",
]);
const PENDING_PATHS = ["/settings/runtime/"];

// the parts several tags reach, always checked
const SHARED = [
	"common.json",
	"components/error.json",
	"components/error-object.json",
	"components/user-object.json",
	"components/permission-object.json",
	"components/certificate-object.json",
	"components/access-list-object.json",
];

const ajv = new Ajv({ strict: false, allowUnionTypes: true, validateFormats: false });
const PLACEHOLDER = /^\d{3} response$/u;
const NEEDS_LINE = /(?:^|\n)Needs: \S/u;
const EM_DASH = /—/u;
const API_TOKEN = /npmpro_[0-9a-f]{16}_[\w-]{43}/u;
const PRIVATE_KEY = /PRIVATE KEY-----\\n[A-Za-z0-9+/=]{40}/u;
const PASSWORD_HASH = /\$2[aby]\$\d\d\$|\$argon2id?\$/u;
const JWT = /eyJ[\w-]{10,}\.eyJ[\w-]{10,}/u;
const ANNOTATIONS = new Set(["description", "summary", "example", "examples", "title"]);

const operations = (schema) =>
	Object.entries(schema.paths).flatMap(([path, methods]) =>
		Object.entries(methods).map(([method, op]) => ({ key: `${method} ${path}`, path, op })),
	);
const pending = ({ path, op }) =>
	PENDING_TAGS.has(op.tags?.[0]) || PENDING_PATHS.some((prefix) => path.startsWith(prefix));
const described = (value) => typeof value === "string" && value.trim() !== "";

function fieldGaps(schema, at, out = [], stack = new Set()) {
	if (!schema || typeof schema !== "object" || stack.has(schema)) return out;
	stack.add(schema);
	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		if (!described(property.description)) out.push(`${at}.${name}`);
		fieldGaps(property, `${at}.${name}`, out, stack);
	}
	fieldGaps(schema.items, `${at}[]`, out, stack);
	if (typeof schema.additionalProperties === "object") fieldGaps(schema.additionalProperties, `${at}{}`, out, stack);
	for (const key of ["anyOf", "oneOf", "allOf"])
		for (const part of schema[key] ?? []) fieldGaps(part, at, out, stack);
	stack.delete(schema);
	return out;
}

const examplesOf = (media) => {
	if (media.examples) return Object.values(media.examples).map((entry) => entry.value);
	return media.example === undefined ? [] : [media.example];
};

function mediaGaps(media, at) {
	if (!media.schema) return [`${at}: no schema`];
	const values = examplesOf(media);
	if (values.length === 0) return [`${at}: no example`];
	const validate = ajv.compile(media.schema);
	const gaps = values.flatMap((value, index) =>
		validate(value)
			? []
			: [`${at}: example ${index} ${validate.errors[0].instancePath} ${validate.errors[0].message}`],
	);
	return [...gaps, ...fieldGaps(media.schema, at)];
}

function operationGaps({ key, op }) {
	const gaps = [];
	if (!described(op.summary) || op.summary.length > 80) gaps.push(`${key}: summary missing or over 80 characters`);
	if (!described(op.description) || op.description === op.summary) gaps.push(`${key}: no description`);
	else if (!NEEDS_LINE.test(op.description)) gaps.push(`${key}: the description has no Needs line`);
	for (const parameter of op.parameters ?? []) {
		if (!described(parameter.description)) gaps.push(`${key}: parameter ${parameter.name}`);
	}
	const body = op.requestBody?.content?.["application/json"];
	if (body) gaps.push(...mediaGaps(body, `${key} request`));
	for (const [code, response] of Object.entries(op.responses ?? {})) {
		if (!code.startsWith("2")) continue;
		if (!described(response.description) || PLACEHOLDER.test(response.description)) {
			gaps.push(`${key} ${code}: response description`);
		}
		const media = response.content?.["application/json"];
		if (media) gaps.push(...mediaGaps(media, `${key} ${code}`));
	}
	return gaps;
}

it("documents every operation that is not pending: summary, description, examples that validate, fields", async () => {
	const schema = await getCompiledSchema();
	const gaps = operations(schema)
		.filter((entry) => !pending(entry))
		.flatMap(operationGaps);
	assert.deepEqual(gaps.slice(0, 40), [], `${gaps.length} gaps`);
});

it("documents every field of the shared parts", async () => {
	const gaps = [];
	for (const file of SHARED) {
		const schema = await $RefParser.dereference(`${import.meta.dirname}/../schema/${file}`);
		gaps.push(...fieldGaps(schema, file));
	}
	assert.deepEqual(gaps, []);
});

it("lists no pending tag or path that is already complete", async () => {
	const schema = await getCompiledSchema();
	const ops = operations(schema);
	const complete = (match) => ops.filter(match).flatMap(operationGaps).length === 0;
	const stale = [
		...[...PENDING_TAGS].filter((tag) => complete(({ op }) => op.tags?.[0] === tag)).map((tag) => `tag ${tag}`),
		...PENDING_PATHS.filter((prefix) => complete(({ path }) => path.startsWith(prefix))).map(
			(prefix) => `path ${prefix}`,
		),
	];
	assert.deepEqual(stale, [], `complete, remove from the pending lists: ${stale.join(", ")}`);
});

it("names only pending tags and paths that exist", async () => {
	const schema = await getCompiledSchema();
	const tags = new Set(schema.tags.map((tag) => tag.name));
	for (const tag of PENDING_TAGS) assert.ok(tags.has(tag), tag);
	for (const prefix of PENDING_PATHS)
		assert.ok(
			Object.keys(schema.paths).some((path) => path.startsWith(prefix)),
			prefix,
		);
});

const stripped = (value) => {
	if (Array.isArray(value)) return value.map(stripped);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !ANNOTATIONS.has(key))
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, inner]) => [key, stripped(inner)]),
	);
};

it("keeps the request schemas: only descriptions and examples change", async () => {
	const schema = await getCompiledSchema();
	const hashes = Object.fromEntries(
		operations(schema)
			.filter(({ op }) => op.requestBody || op.parameters)
			.map(({ key, op }) => [
				key,
				createHash("sha256")
					.update(JSON.stringify(stripped({ body: op.requestBody?.content, parameters: op.parameters })))
					.digest("hex"),
			]),
	);
	const pinned = JSON.parse(readFileSync(new URL("fixtures/request-schema-hashes.json", import.meta.url), "utf8"));
	assert.deepEqual(hashes, pinned);
});

it("has no secret and no em dash anywhere in the reference", async () => {
	const text = JSON.stringify(await getCompiledSchema());
	assert.doesNotMatch(text, EM_DASH);
	assert.doesNotMatch(text, API_TOKEN, "a whole API token");
	assert.doesNotMatch(text, PRIVATE_KEY, "a private key");
	assert.doesNotMatch(text, PASSWORD_HASH, "a password hash");
	assert.doesNotMatch(text, JWT, "a JWT");
});
