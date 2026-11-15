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
const HEX_ESCAPE = /\\x(?<hex>[0-9A-Fa-f]{2})/gu;
const PASSWORD_MISMATCH = /password mismatch/u;
const NOT_FOUND = /was not found/u;
const LIMIT_REQ = /limiting requests, excess/u;
// classic writes a quote as \x22, JSON as \"
const unescapeClassic = (text) =>
	text.replace(HEX_ESCAPE, (...match) => String.fromCharCode(Number.parseInt(match.at(-1).hex, 16)));
const upTo = (name) => ACCESS_FIELDS.slice(0, ACCESS_FIELDS.findIndex((item) => item.name === name) + 1);

// classic writes an empty value as "-", JSON as "" (a field that is "-" in both, like the host id, stays "-")
const sameValue = (classic, json) =>
	classic === json || (classic === "-" && json === "") || unescapeClassic(classic) === json;

// what is wrong with a JSON line: other names or order than the field list, or a value that is no string
const jsonProblems = (line, fields) => {
	const parsed = JSON.parse(line);
	const problems = [];
	if (Object.keys(parsed).join() !== NAMES(fields).join()) problems.push(`names of ${line}`);
	for (const [name, value] of Object.entries(parsed)) {
		if (typeof value !== "string") problems.push(`${name} is no string in ${line}`);
	}
	return { parsed, problems };
};

// what differs between the classic lines and their JSON twins (line N is the same request in both files)
const pairProblems = (classicLines, jsonLines, fields) => {
	if (jsonLines.length !== classicLines.length) return [`${jsonLines.length} JSON lines for ${classicLines.length}`];
	const problems = [];
	for (const [index, classicLine] of classicLines.entries()) {
		const classic = tokenizeClassic(classicLine, fields);
		if (classic === null) {
			problems.push(`no fields in ${classicLine}`);
			continue;
		}
		const { parsed: json, problems: jsonOnes } = jsonProblems(jsonLines[index], fields);
		problems.push(...jsonOnes);
		for (const { name } of fields) {
			if (!sameValue(classic[name], json[name])) problems.push(`${name}: ${classic[name]} against ${json[name]}`);
		}
	}
	return problems;
};

it("every classic access line has the full field list, the JSON twin the same names and values", () => {
	const classic = linesOf("access-classic.log");
	assert.equal(classic.length, 11);
	assert.deepEqual(pairProblems(classic, linesOf("access-json.log"), ACCESS_FIELDS), []);
});

it("every classic stream line has the full field list, the JSON twin the same names and values", () => {
	const classic = linesOf("stream-classic.log");
	assert.equal(classic.length, 3);
	assert.deepEqual(pairProblems(classic, linesOf("stream-json.log"), STREAM_FIELDS), []);
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
	// a request without a Host and one over the unix socket (no client address) are no visitor traffic: no record in
	// either format
	const isVisitor = (line) => {
		const { host, remote_addr: ip } = tokenizeClassic(line, ACCESS_FIELDS);
		return host !== "" && ip !== "unix:";
	};
	const visitors = classic.flatMap((line, index) => (isVisitor(line) ? [[line, json[index]]] : []));
	const others = classic.flatMap((line, index) => (isVisitor(line) ? [] : [[line, json[index]]]));
	assert.equal(others.length, 2);
	assert.deepEqual(
		others.map(([line, twin]) => [parseLogLine(line), parseLogLine(twin)]),
		others.map(() => [null, null]),
	);
	for (const [line, twinLine] of visitors) {
		const record = parseLogLine(line);
		const twin = parseLogLine(twinLine);
		assert.notEqual(record, null, line);
		// classic keeps the escape of a user agent as written, JSON the decoded text
		assert.deepEqual(twin, { ...record, userAgent: unescapeClassic(record.userAgent) }, line);
	}
});

it("the error log fixture holds the lines the hub parser tests", () => {
	const lines = linesOf("error.log");
	assert.equal(lines.length, 3);
	assert.match(lines[0], PASSWORD_MISMATCH);
	assert.match(lines[1], NOT_FOUND);
	assert.match(lines[2], LIMIT_REQ);
});
