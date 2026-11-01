import assert from "node:assert/strict";
import { it } from "node:test";
import { keyUsesOf, unusedKeys } from "./TranslationUsage.js";

// source text with template literals: #{x} stands for a substitution, so no test string holds a real one
const code = (text) => text.replaceAll("#{", "${");

const KEYS = [
	"settings.nginx",
	"settings.default-site.404",
	"settings.default-site.html.description",
	"settings.monitoring.show-ips.confirm",
	"backup.error.too-large",
	"logs.live",
	"offline",
];

it("counts a key held as a whole string, in any quotes", () => {
	assert.deepEqual(unusedKeys(KEYS, ['<T id="settings.nginx" />', "x = 'offline';", "y = `logs.live`;"]), [
		"settings.default-site.404",
		"settings.default-site.html.description",
		"settings.monitoring.show-ips.confirm",
		"backup.error.too-large",
	]);
});

it("counts the keys a template literal can build, before or after its substitutions", () => {
	assert.deepEqual(
		unusedKeys(KEYS, [
			code("const a = `settings.default-site.#{value}`;"),
			code("const b = `#{key}.confirm`;"),
			code("const c = `backup.error.#{code}`;"),
		]),
		["settings.nginx", "logs.live", "offline"],
	);
	// one substitution stands for any text, dots included
	assert.deepEqual(
		unusedKeys(["settings.default-site.html.description"], [code("`settings.default-site.#{v}`")]),
		[],
	);
});

it("keeps only templates whose fixed text could belong to a key: a .tmp suffix may, a size or a path not", () => {
	const { strings, patterns } = keyUsesOf(
		code("a = `#{file}.tmp`; b = `#{width}px`; c = `#{a}.#{b}`; d = `/settings/#{id}`; e = `#{x}-#{y}`;"),
	);
	assert.deepEqual(strings, []);
	assert.deepEqual(
		patterns.map((pattern) => pattern.source),
		[String.raw`^.+\.tmp$`],
	);
	assert.deepEqual(unusedKeys(["offline"], [code("`#{a}.#{b}`"), code("`#{w}px`")]), ["offline"]);
});

it("does not count a key that only appears inside a longer string", () => {
	assert.deepEqual(unusedKeys(["offline"], ['"offline hosts"', "// offline"]), ["offline"]);
});
