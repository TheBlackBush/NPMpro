import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { ACCESS_FIELDS, STREAM_FIELDS, tokenizeClassic } from "../lib/log-format.js";
import { parseLogLine } from "../lib/traffic/parse.js";

// Real lines written by nginx (a throwaway container logging every request in both formats at once, so line N of a
// classic file and line N of its JSON twin are the same request). The same files are the tests of the hub parser.
const linesOf = (name) =>
	readFileSync(new URL(`./fixtures/log-lines/${name}`, import.meta.url), "utf8")
		.split("\n")
		.filter((entry) => entry !== "");

const NAMES = (fields) => fields.map((item) => item.name);
const HEX_ESCAPE = /\\x([0-9A-Fa-f]{2})/gu;
// classic writes a quote as \x22, JSON as \"
const unescapeClassic = (text) =>
	text.replace(HEX_ESCAPE, (_all, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
const upTo = (name) => ACCESS_FIELDS.slice(0, ACCESS_FIELDS.findIndex((item) => item.name === name) + 1);

const jsonFields = (line, fields) => {
	const parsed = JSON.parse(line);
	assert.deepEqual(Object.keys(parsed), NAMES(fields), line);
	for (const value of Object.values(parsed)) {
		assert.equal(typeof value, "string", line);
	}
	return parsed;
};

// classic writes an empty value as "-", JSON as "" (a field that is "-" in both, like the host id, stays "-")
const sameValue = (classic, json) =>
	classic === json || (classic === "-" && json === "") || unescapeClassic(classic) === json;

const assertSameFields = (classicLines, jsonLines, fields) => {
	assert.equal(jsonLines.length, classicLines.length);
	for (const [index, classicLine] of classicLines.entries()) {
		const classic = tokenizeClassic(classicLine, fields);
		assert.notEqual(classic, null, classicLine);
		const json = jsonFields(jsonLines[index], fields);
		for (const { name } of fields) {
			assert.ok(sameValue(classic[name], json[name]), `${name}: ${classic[name]} against ${json[name]}`);
		}
	}
};

it("every classic access line has the full field list, the JSON twin the same names and values", () => {
	const classic = linesOf("access-classic.log");
	assert.equal(classic.length, 11);
	assertSameFields(classic, linesOf("access-json.log"), ACCESS_FIELDS);
});

it("every classic stream line has the full field list, the JSON twin the same names and values", () => {
	const classic = linesOf("stream-classic.log");
	assert.equal(classic.length, 3);
	assertSameFields(classic, linesOf("stream-json.log"), STREAM_FIELDS);
});

it("the lines written before the last fields were added end at $server_port or at $upstream_cache_status", () => {
	const old = linesOf("access-classic-old.log");
	assert.ok(old.length > 0);
	const short = upTo("upstream_cache_status");
	const withPort = upTo("server_port");
	for (const line of old) {
		const fields = tokenizeClassic(line, withPort) ?? tokenizeClassic(line, short);
		assert.notEqual(fields, null, line);
		assert.equal(tokenizeClassic(line, ACCESS_FIELDS), null, line);
	}
});

it("every access line of either format gives a record, the same one for the same request", () => {
	const classic = linesOf("access-classic.log");
	const json = linesOf("access-json.log");
	let withoutRecord = 0;
	for (const [index, line] of classic.entries()) {
		const record = parseLogLine(line);
		const twin = parseLogLine(json[index]);
		const { host, remote_addr: ip } = tokenizeClassic(line, ACCESS_FIELDS);
		if (host === "" || ip === "unix:") {
			// a request without a Host and one over the unix socket (no client address) are no visitor traffic: no
			// record in either format
			assert.equal(record, null, line);
			assert.equal(twin, null, json[index]);
			withoutRecord += 1;
			continue;
		}
		assert.notEqual(record, null, line);
		assert.notEqual(twin, null, json[index]);
		// classic keeps the escape of a user agent as written, JSON the decoded text
		assert.deepEqual({ ...twin, userAgent: "" }, { ...record, userAgent: "" }, line);
		assert.equal(twin.userAgent, unescapeClassic(record.userAgent), line);
	}
	assert.equal(withoutRecord, 2);
});

it("the error log fixture holds the lines the hub parser tests", () => {
	const lines = linesOf("error.log");
	assert.equal(lines.length, 3);
	assert.match(lines[0], /password mismatch/u);
	assert.match(lines[1], /was not found/u);
	assert.match(lines[2], /limiting requests, excess/u);
});
