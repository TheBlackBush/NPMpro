import assert from "node:assert/strict";
import { it } from "node:test";
import { ACCESS_FIELDS, tokenizeClassic } from "../lib/log-format.js";
import { createTrafficReader } from "../lib/traffic/reader.js";

const classic = (host, ip, ua = "curl/8", port = "443") =>
	`[24/Oct/2026:10:15:30 +0200] ${host} ${ip} 0.012 "GET /a?b=1 HTTP/2.0" 200 512 "-" "${ua}" "-" "text/html" - - - - ${port} "${host}" proxy-1 0123456789abcdef0123456789abcdef 7 "200" "0.001"`;
const json = (text) => {
	const fields = tokenizeClassic(text, ACCESS_FIELDS);
	return JSON.stringify(
		Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === "-" ? "" : value])),
	);
};

const setup = (lines) => {
	const added = [];
	const recent = [];
	const reader = createTrafficReader({
		createReader: () => ({ read: () => Promise.resolve({ lines, state: { offset: 1 } }) }),
		counter: { add: (entry) => added.push(entry) },
		recent: { add: (entry) => recent.push(entry) },
		geo: { available: () => ({ country: false, asn: false }), lookup: () => null },
		hostList: { map: (host) => host, loadedSince: () => Promise.resolve() },
		settings: { enabled: true, showIps: false },
		position: { lastState: null },
		adminPort: "81",
		bindAddresses: [],
		now: () => 1000,
		logOnce: () => {},
	});
	return { reader, added, recent };
};

it("counts a mixed sequence of classic and JSON lines once each and skips the admin UI and broken lines", async () => {
	const lines = [
		classic("a.example.com", "203.0.113.7"),
		json(classic("b.example.com", "203.0.113.8")),
		classic("npm.lan:8181", "172.17.0.1", "curl/8", "81"),
		json(classic("npm.lan:8181", "172.17.0.1", "curl/8", "81")),
		json(classic("127.0.0.1:81", "127.0.0.1", "NPMpro/healthcheck", "81")),
		'{"broken":',
		"garbage",
		"",
		classic("c.example.com", "203.0.113.9"),
		json(classic("d.example.com", "203.0.113.10")).replace('"curl/8"', String.raw`"a \"quoted\" agent"`),
	];
	const { reader, added, recent } = setup(lines);
	await reader.read();
	assert.deepEqual(
		added.map((entry) => entry.host),
		["a.example.com", "b.example.com", "c.example.com", "d.example.com"],
	);
	assert.deepEqual(
		recent.map((entry) => [entry.method, entry.path, entry.status, entry.bytes]),
		Array.from({ length: 4 }, () => ["GET", "/a", 200, 512]),
	);
	assert.equal(reader.status().skipped, 2);
});
