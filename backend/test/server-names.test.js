import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { serverNames } from "../lib/nginx-quote.js";
import utils from "../lib/utils.js";

const schema = JSON.parse(await readFile(path.join(import.meta.dirname, "../schema/common.json"), "utf8"));
const DOMAIN = new RegExp(schema.properties.domain_names.items.pattern, "u");

it("server names are quoted and keep their value", async () => {
	const template = await readFile(path.join(import.meta.dirname, "../templates/_common.conf"), "utf8");
	const out = await utils.getRenderEngine().parseAndRender(template, {
		server_names: serverNames(["example.com", "*.example.com", "bücher.example", "~^\\d{3}\\.x$"]),
	});
	assert.equal(
		out.split("\n")[0],
		'server_name "example.com" "*.example.com" "xn--bcher-kva.example" "~^\\\\d{3}\\\\.x$";',
	);
});

it("a name quoted by hand keeps its meaning", () => {
	assert.deepEqual(serverNames(['"~^\\d{3}\\.x$"', "'example.com'", '""']), [
		'"~^\\\\d{3}\\\\.x$"',
		'"example.com"',
		'""',
	]);
});

it("a regular expression name with nginx syntax characters stays one argument", () => {
	assert.deepEqual(serverNames(['~^a;}server{"b$']), ['"~^a;}server{\\"b$"']);
});

it("host names without nginx syntax characters pass, others are refused", () => {
	for (const name of [
		"example.com",
		"*.example.com",
		"_",
		"xn--bcher-kva.example",
		"~^www\\.(?<n>.+)$",
		"~^\\d{3}$",
	]) {
		assert.ok(DOMAIN.test(name), name);
	}
	for (const name of ["a;b", "a{b", "a}b", 'a"b', "a'b", "a\\b", "a#b", "a b", "a/b", "host:80"]) {
		assert.ok(!DOMAIN.test(name), name);
	}
});
