import assert from "node:assert/strict";
import { it } from "node:test";
import { parseAlogLine, statusClass } from "../lib/traffic/parse.js";

const line = (host, ip, status = 200, bytes = 512, request = "GET /a?b=1 HTTP/2.0", ua = "curl/8") =>
	`[24/Oct/2026:10:15:30 +0200] ${host} ${ip} 0.012 "${request}" ${status} ${bytes} "-" "${ua}" "-" "text/html" TLSv1.3 TLS_AES_128_GCM_SHA256 X25519 -`;

it("parses a normal line", () => {
	assert.deepEqual(parseAlogLine(line("Example.com", "203.0.113.7")), {
		time: Date.UTC(2026, 9, 24, 8, 15, 30),
		host: "example.com",
		ip: "203.0.113.7",
		status: 200,
		bytes: 512,
	});
});

it("strips a port from the host and accepts IPv6", () => {
	const r = parseAlogLine(line("example.com:8443", "2001:db8::1", 404, 0));
	assert.equal(r.host, "example.com");
	assert.equal(r.ip, "2001:db8::1");
	assert.equal(r.status, 404);
});

it("keeps a bracketed IPv6 literal host lower-cased and strips its port", () => {
	assert.equal(parseAlogLine(line("[2001:DB8::1]:8443", "203.0.113.7")).host, "[2001:db8::1]");
	assert.equal(parseAlogLine(line("[2001:db8::1]", "203.0.113.7")).host, "[2001:db8::1]");
});

it("ignores quoted fields with spaces and escaped quotes after the byte count", () => {
	const ua = String.raw`Mozilla/5.0 (X11; Linux) say \"hi\" 200 99`;
	const r = parseAlogLine(line("example.com", "203.0.113.7", 200, 512, "GET /a HTTP/1.1", ua));
	assert.equal(r.status, 200);
	assert.equal(r.bytes, 512);
});

it("handles an escaped quote inside the request", () => {
	const r = parseAlogLine(line("example.com", "203.0.113.7", 301, 7, String.raw`GET /a\"b 200 5 HTTP/1.1`));
	assert.equal(r.status, 301);
	assert.equal(r.bytes, 7);
});

it("returns null for non-IP client addresses such as unix sockets", () => {
	assert.equal(parseAlogLine(line("example.com", "unix:")), null);
	assert.equal(parseAlogLine(line("example.com", "not-an-ip")), null);
});

it("returns null for malformed lines", () => {
	assert.equal(parseAlogLine(""), null);
	assert.equal(parseAlogLine("garbage"), null);
	assert.equal(parseAlogLine('[bad date] h 1.2.3.4 0.1 "GET / HTTP/1.1" 200 1'), null);
});

it("maps status classes", () => {
	assert.equal(statusClass(204), "2xx");
	assert.equal(statusClass(301), "3xx");
	assert.equal(statusClass(499), "4xx");
	assert.equal(statusClass(503), "5xx");
	assert.equal(statusClass(101), "other");
});
