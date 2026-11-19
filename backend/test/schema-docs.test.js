import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import Ajv from "ajv/dist/2020.js";
import { getCompiledSchema } from "../schema/index.js";

// the parts several tags reach, checked in full
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
const SUCCESS_CODE = /^[23]/u;
// Needs stands as its own paragraph: one newline would join it to the text before it in the rendered page
const NEEDS_JOINED = /(?:^|[^\n])\nNeeds:/u;
const NEEDS_ALLOW_DELETE = /\nNeeds: [^\n]*Allow delete/u;
const NEEDS_NO_TOKEN = /\nNeeds: [^\n]*\(API tokens are refused\)/u;
const EM_DASH = /\u2014/u;
const API_TOKEN = /npmpro_[0-9a-f]{16}_[\w-]{43}/u;
const PRIVATE_KEY = /PRIVATE KEY-----\\n[A-Za-z0-9+/=]{40}/u;
const PASSWORD_HASH = /\$2[aby]\$\d\d\$|\$argon2id?\$/u;
const JWT = /eyJ[\w-]{10,}\.eyJ[\w-]{10,}/u;
const ANNOTATIONS = new Set(["description", "summary", "example", "examples", "title"]);

const operations = (schema) =>
	Object.entries(schema.paths).flatMap(([path, methods]) =>
		Object.entries(methods).map(([method, op]) => ({ key: `${method} ${path}`, path, op })),
	);
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
		if (!described(response.description) || PLACEHOLDER.test(response.description)) {
			gaps.push(`${key} ${code}: response description`);
		}
		if (!SUCCESS_CODE.test(code)) continue;
		const media = response.content?.["application/json"];
		if (media) gaps.push(...mediaGaps(media, `${key} ${code}`));
	}
	return gaps;
}

it("documents every operation: summary, description, examples that validate, fields", async () => {
	const schema = await getCompiledSchema();
	const gaps = operations(schema).flatMap(operationGaps);
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

it("puts every Needs line after a blank line", async () => {
	const schema = await getCompiledSchema();
	const joined = operations(schema)
		.filter(({ op }) => NEEDS_JOINED.test(op.description ?? ""))
		.map(({ key }) => key);
	assert.deepEqual(joined, [], `${joined.length} descriptions`);
});

it("names Allow delete on every DELETE a token may send, and refuses tokens on the others", async () => {
	const schema = await getCompiledSchema();
	const gaps = operations(schema)
		.filter(({ key }) => key.startsWith("delete "))
		.flatMap(({ key, op }) => {
			const bearer = (op.security ?? []).some((entry) => "bearerAuth" in entry);
			const pattern = bearer ? NEEDS_ALLOW_DELETE : NEEDS_NO_TOKEN;
			return pattern.test(op.description ?? "") ? [] : [key];
		});
	assert.deepEqual(gaps, []);
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
