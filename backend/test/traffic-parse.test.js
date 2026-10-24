import assert from "node:assert/strict";
import { it } from "node:test";
import { isOwnRequest, parseAlogLine, statusClass } from "../lib/traffic/parse.js";

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

it("recognises NPMpro's own requests in lines without the server port", () => {
	const health = line("127.0.0.1:81", "127.0.0.1", 200, 512, "GET /api HTTP/2.0", "NPMpro/healthcheck");
	assert.equal(isOwnRequest(health, "81"), true);
	assert.equal(isOwnRequest(health, "443"), true);
	assert.equal(isOwnRequest(line("npm.lan:81", "192.168.1.10"), "81"), true);
	assert.equal(isOwnRequest(line("[fd00::1]:81", "fd00::2"), "81"), true);
	assert.equal(isOwnRequest(line("npm.lan:8181", "192.168.1.10"), "81"), false);
	assert.equal(isOwnRequest(line("example.com", "203.0.113.7"), "81"), false);
	assert.equal(isOwnRequest(line("example.com:443", "203.0.113.7"), "443"), false);
	assert.equal(isOwnRequest(line("example.com", "203.0.113.7", 200, 1, "GET /:81 HTTP/1.1"), "81"), false);
	assert.equal(
		isOwnRequest(line("example.com", "203.0.113.7", 200, 1, "GET / HTTP/1.1", "NPMpro/healthcheck2"), "81"),
		false,
	);
	assert.equal(isOwnRequest("garbage", "81"), false);
});

// Lines written since the alog format ends with $server_port: the port nginx received the request on
const withPort = (serverPort, ...args) => `${line(...args)} ${serverPort}`;

it("parses lines that end with the server port", () => {
	assert.deepEqual(parseAlogLine(withPort(443, "example.com", "203.0.113.7", 404, 1200)), {
		time: Date.UTC(2026, 9, 24, 8, 15, 30),
		host: "example.com",
		ip: "203.0.113.7",
		status: 404,
		bytes: 1200,
	});
});

it("uses the server port, not the Host header, for NPMpro's own requests", () => {
	// admin UI behind a remapped Docker port: the browser sends 8181, nginx received it on 81
	assert.equal(isOwnRequest(withPort(81, "npm.lan:8181", "172.17.0.1"), "81"), true);
	// a visitor cannot hide from the stats with a chosen Host port or the health check user agent
	assert.equal(isOwnRequest(withPort(443, "example.com:81", "203.0.113.7"), "81"), false);
	assert.equal(
		isOwnRequest(withPort(443, "example.com", "203.0.113.7", 200, 1, "GET / HTTP/2.0", "NPMpro/healthcheck"), "81"),
		false,
	);
	// the health check calls the admin port
	assert.equal(
		isOwnRequest(
			withPort(81, "127.0.0.1:81", "127.0.0.1", 200, 512, "GET /api HTTP/2.0", "NPMpro/healthcheck"),
			"81",
		),
		true,
	);
	// real traffic on 80/443 is never dropped
	assert.equal(isOwnRequest(withPort(80, "example.com", "203.0.113.7"), "81"), false);
});

it("skips only a local health check when the admin port is 80 or 443", () => {
	const health = (ip) => withPort(443, "127.0.0.1", ip, 200, 512, "GET /api HTTP/2.0", "NPMpro/healthcheck");
	assert.equal(isOwnRequest(health("127.0.0.1"), "443"), true);
	assert.equal(isOwnRequest(health("::1"), "443"), true);
	assert.equal(isOwnRequest(health("203.0.113.7"), "443"), false);
	assert.equal(isOwnRequest(withPort(443, "example.com", "203.0.113.7"), "443"), false);
});
