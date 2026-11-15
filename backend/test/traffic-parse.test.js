import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { ACCESS_FIELDS, tokenizeClassic } from "../lib/log-format.js";
import { isOwnRecord, isOwnRequest, parseAlogLine, parseLogLine, statusClass } from "../lib/traffic/parse.js";

const line = (host, ip, status = 200, bytes = 512, request = "GET /a?b=1 HTTP/2.0", ua = "curl/8") =>
	`[24/Oct/2026:10:15:30 +0200] ${host} ${ip} 0.012 "${request}" ${status} ${bytes} "-" "${ua}" "-" "text/html" TLSv1.3 TLS_AES_128_GCM_SHA256 X25519 -`;

it("parses a normal line", () => {
	assert.deepEqual(parseAlogLine(line("Example.com", "203.0.113.7")), {
		time: Date.UTC(2026, 9, 24, 8, 15, 30),
		host: "example.com",
		ip: "203.0.113.7",
		status: 200,
		bytes: 512,
		method: "GET",
		path: "/a",
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

it("ignores quoted fields with spaces and handles escaped quotes in the user agent and in the request", () => {
	{
		const ua = String.raw`Mozilla/5.0 (X11; Linux) say \"hi\" 200 99`;
		const r = parseAlogLine(line("example.com", "203.0.113.7", 200, 512, "GET /a HTTP/1.1", ua));
		assert.equal(r.status, 200);
		assert.equal(r.bytes, 512);
	}
	{
		const r = parseAlogLine(line("example.com", "203.0.113.7", 301, 7, String.raw`GET /a\"b 200 5 HTTP/1.1`));
		assert.equal(r.status, 301);
		assert.equal(r.bytes, 7);
	}
});

it("returns method and path with the query string and fragment cut off", () => {
	const parse = (request) => {
		const { method, path } = parseAlogLine(line("example.com", "203.0.113.7", 200, 1, request));
		return { method, path };
	};
	assert.deepEqual(parse("POST /login?token=secret HTTP/1.1"), { method: "POST", path: "/login" });
	assert.deepEqual(parse("GET /page#top HTTP/2.0"), { method: "GET", path: "/page" });
	assert.deepEqual(parse("GET /p#frag?x=1 HTTP/2.0"), { method: "GET", path: "/p" });
	assert.deepEqual(parse("get /lower HTTP/1.1"), { method: "get", path: "/lower" });
	assert.deepEqual(parse("GET /old"), { method: "GET", path: "/old" });
	assert.deepEqual(parse(String.raw`GET /a\"b HTTP/1.1`), { method: "GET", path: String.raw`/a\"b` });
});

it("cuts path parameters and removes userinfo from absolute-form targets", () => {
	const path = (request) => parseAlogLine(line("example.com", "203.0.113.7", 200, 1, request)).path;
	assert.equal(path("GET /app;jsessionid=abc?x=1 HTTP/1.1"), "/app");
	assert.equal(path("GET /a;b HTTP/1.1"), "/a");
	assert.equal(path("GET http://user:pass@example.com/x?y=1 HTTP/1.1"), "http://example.com/x");
	assert.equal(path("GET https://a:b@c@example.com:8443/p;s=1 HTTP/1.1"), "https://example.com:8443/p");
	assert.equal(path("GET http://u;x:secret@example.com/ HTTP/1.1"), "http://example.com/");
	assert.equal(path("GET http://example.com/a@b HTTP/1.1"), "http://example.com/a@b", "an @ in the path stays");
	assert.equal(path("GET /a@b HTTP/1.1"), "/a@b");
	assert.equal(path("CONNECT example.com:443 HTTP/1.1"), "example.com:443");
});

it("cuts a long path at 200 characters", () => {
	const { path } = parseAlogLine(line("example.com", "203.0.113.7", 200, 1, `GET /${"a".repeat(300)}?q=1 HTTP/1.1`));
	assert.equal(path, `/${"a".repeat(199)}`);
});

it("returns method - and an empty path for a malformed request field", () => {
	for (const request of [
		"-",
		"",
		String.raw`\x16\x03\x01\x02\x00\x01`,
		"GET",
		"GET  HTTP/1.1",
		"G3T / HTTP/1.1",
		"GET / HTTP/1.1 extra",
	]) {
		const r = parseAlogLine(line("example.com", "203.0.113.7", 400, 0, request));
		assert.equal(r.status, 400, request);
		assert.deepEqual({ method: r.method, path: r.path }, { method: "-", path: "" }, request);
	}
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
		method: "GET",
		path: "/a",
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

it("treats an empty server port (unix socket listener) as the new format with no admin port", () => {
	// $server_port is empty for requests over /run/nginx.sock, so the line ends with a space
	assert.equal(isOwnRequest(`${line("example.com:81", "203.0.113.7")} `, "81"), false);
	assert.equal(
		isOwnRequest(`${line("example.com", "203.0.113.7", 200, 1, "GET / HTTP/2.0", "NPMpro/healthcheck")} `, "81"),
		false,
	);
	assert.equal(
		isOwnRequest(`${line("127.0.0.1", "127.0.0.1", 200, 1, "GET /api HTTP/2.0", "NPMpro/healthcheck")} `, "81"),
		true,
	);
});

it("skips the health check from the configured IPv4 binding when the admin port is 80 or 443", () => {
	const health = withPort(443, "10.0.0.5", "10.0.0.5", 200, 512, "GET /api HTTP/2.0", "NPMpro/healthcheck");
	assert.equal(isOwnRequest(health, "443", ["10.0.0.5"]), true);
	assert.equal(isOwnRequest(health, "443"), false);
	assert.equal(isOwnRequest(health, "443", ["0.0.0.0"]), false);
});

const BASE =
	'[14/Nov/2026:10:00:00 +0000] npmpro.example.com:19381 192.168.1.10 0.004 "GET /api HTTP/2.0" 200 1530 "-" "Mozilla" "-" "application/json" TLSv1.3 TLS_AES_256_GCM_SHA384 X25519 -';
const TAIL = ' "npmpro.example.com" npmpro 0123456789abcdef0123456789abcdef 12 "-" "-"';
const ENDS_WITH_PORT = / \d{1,5}$/u;
const SPACELESS =
	'[14/Nov/2026:10:00:00 +0000] npmpro.example.com:19381 192.168.1.10 0.004 "GET /api HTTP/2.0" 200 1530 "-" "curl/8" "-" "-" TLSv1.3 TLS_AES_256_GCM_SHA384 X25519 -';

it("reads the server port before the fields added after it", () => {
	assert.equal(isOwnRequest(`${BASE} 81${TAIL}`, 81), true);
	assert.equal(isOwnRequest(`${BASE} 443${TAIL}`, 81), false);
	assert.equal(isOwnRequest(`${BASE} ${TAIL}`, 81), false); // unix socket listener, not a health check
	assert.equal(
		isOwnRequest(`${BASE} 443 "" default 0123456789abcdef0123456789abcdef 3 "502, 200" "0.001 : 0.002"`, 81),
		false,
	);
	assert.deepEqual(parseAlogLine(`${BASE} 81${TAIL}`), parseAlogLine(`${BASE} 81`));
});

it("reads the port when no quoted field before the tail holds a space", () => {
	const tail = ' "" default 0123456789abcdef0123456789abcdef 3 "502, 200" "0.001 : 0.002"';
	assert.equal(isOwnRequest(`${SPACELESS} 81${tail}`, 81), true);
	assert.equal(isOwnRequest(`${SPACELESS} 443${tail}`, 81), false);
});

it("reads the server port when a TLS or cache field is empty", () => {
	// nginx writes a found but empty value as nothing: $ssl_curve over TLS when no group was negotiated
	const noCurve = BASE.replace(" X25519 -", "  -");
	assert.equal(isOwnRequest(`${noCurve} 81${TAIL}`, 81), true); // admin UI through the remapped port 19381
	assert.equal(isOwnRequest(`${noCurve} 443${TAIL}`, 81), false);
	assert.equal(isOwnRequest(`${noCurve} 81`, 81), true);
	assert.equal(
		isOwnRequest(`${BASE.replace(" TLSv1.3 TLS_AES_256_GCM_SHA384 X25519 -", "    ")} 81${TAIL}`, 81),
		true,
	);
	assert.deepEqual(parseAlogLine(`${noCurve} 81${TAIL}`), parseAlogLine(`${BASE} 81`));
});

it("gives the same answers for every fixture line with and without the new fields", () => {
	const old = readFileSync(new URL("./fixtures/log-lines/access-classic-old.log", import.meta.url), "utf8")
		.split("\n")
		.filter((entry) => entry !== "");
	assert.ok(old.length > 0);
	for (const entry of old) {
		if (!ENDS_WITH_PORT.test(entry)) {
			continue;
		}
		const extended = `${entry}${TAIL}`;
		assert.equal(isOwnRequest(extended, 81), isOwnRequest(entry, 81), entry);
		assert.equal(isOwnRequest(extended, 443), isOwnRequest(entry, 443), entry);
		assert.deepEqual(parseAlogLine(extended), parseAlogLine(entry), entry);
	}
});

it("reads the real nginx lines of the access log fixture", () => {
	const lines = readFileSync(new URL("./fixtures/log-lines/access-classic.log", import.meta.url), "utf8")
		.split("\n")
		.filter((entry) => entry !== "");
	assert.equal(lines.length, 6);
	const fields = lines.map((entry) => tokenizeClassic(entry, ACCESS_FIELDS));
	for (const [index, entry] of fields.entries()) {
		assert.notEqual(entry, null, lines[index]);
	}
	assert.deepEqual(
		fields.map((entry) => [entry.server_port, entry.host_id]),
		[
			["81", "npmpro"],
			["81", "npmpro"],
			["80", "proxy-2"],
			["80", "-"],
			["80", "default"],
			["", "default"],
		],
	);
	// the health check and the admin UI request on port 81 are NPMpro's own, the others are visitor traffic
	assert.deepEqual(
		lines.map((entry) => isOwnRequest(entry, 81)),
		[true, true, false, false, false, false],
	);
	assert.deepEqual(parseAlogLine(lines[2]), {
		time: Date.UTC(2026, 10, 15, 7, 36, 56),
		host: "lb.t40.example",
		ip: "127.0.0.1",
		status: 200,
		bytes: 559,
		method: "GET",
		path: "/api/items",
	});
	assert.equal(fields[2].upstream_status, "502, 200");
});

// The JSON twin of a classic line: the ACCESS_FIELDS names in order, every value a string, "" for an empty one
const NO_VALUE = new Set(["-"]);
const jsonOf = (classic, overrides = {}) => {
	const fields = tokenizeClassic(classic, ACCESS_FIELDS);
	const values = Object.fromEntries(
		ACCESS_FIELDS.map((item) => [
			item.name,
			NO_VALUE.has(fields?.[item.name] ?? "") ? "" : (fields?.[item.name] ?? ""),
		]),
	);
	return JSON.stringify({ ...values, ...overrides });
};
const FULL = (host, ip, { ua = "curl/8", request = "GET /a?b=1 HTTP/2.0", port = "443" } = {}) =>
	`[24/Oct/2026:10:15:30 +0200] ${host} ${ip} 0.012 "${request}" 200 512 "-" "${ua}" "-" "text/html" TLSv1.3 TLS_AES_128_GCM_SHA256 X25519 - ${port} "${host}" proxy-1 0123456789abcdef0123456789abcdef 7 "200" "0.001"`;

it("reads a JSON line like its classic line", () => {
	for (const classic of [
		FULL("Example.com", "203.0.113.7"),
		FULL("example.com:8443", "2001:db8::1"),
		FULL("[2001:DB8::1]:8443", "203.0.113.7"),
		FULL("example.com", "203.0.113.7", { request: "POST /login?token=secret HTTP/1.1", port: "" }),
		FULL("example.com", "203.0.113.7", { request: "GET /old", port: "80" }),
	]) {
		assert.deepEqual(parseLogLine(jsonOf(classic)), parseLogLine(classic), classic);
		assert.deepEqual(parseAlogLine(jsonOf(classic)), parseAlogLine(classic), classic);
	}
	assert.deepEqual(parseAlogLine(jsonOf(FULL("Example.com", "203.0.113.7"))), {
		time: Date.UTC(2026, 9, 24, 8, 15, 30),
		host: "example.com",
		ip: "203.0.113.7",
		status: 200,
		bytes: 512,
		method: "GET",
		path: "/a",
	});
});

it("returns the raw host, server port and user agent of both formats", () => {
	const classic = parseLogLine(FULL("Example.com:8443", "203.0.113.7", { port: "81" }));
	assert.equal(classic.rawHost, "Example.com:8443");
	assert.equal(classic.serverPort, "81");
	assert.equal(classic.userAgent, "curl/8");
	assert.equal(parseLogLine(FULL("a.com", "203.0.113.7", { port: "" })).serverPort, "");
	assert.equal(parseLogLine(line("a.com", "203.0.113.7")).serverPort, undefined);
	assert.equal(parseLogLine(jsonOf(FULL("a.com", "203.0.113.7", { port: "" })))?.serverPort, "");
	assert.equal(parseLogLine(jsonOf(FULL("a.com", "203.0.113.7", { port: "81" })))?.serverPort, "81");
});

it("reads escaped quotes, backslashes and control bytes in a JSON user agent and request", () => {
	const ua = 'say "hi" \\ \u0000 end';
	const request = 'GET /a"b HTTP/1.1';
	const text = jsonOf(FULL("a.com", "203.0.113.7"), { http_user_agent: ua, request });
	assert.ok(text.includes(String.raw`\"hi\"`));
	assert.ok(text.includes(String.raw`\u0000`));
	const record = parseLogLine(text);
	assert.equal(record.userAgent, ua);
	assert.equal(record.path, '/a"b');
	assert.equal(record.status, 200);
});

it("reads empty JSON values", () => {
	const text = jsonOf(FULL("a.com", "203.0.113.7"), {
		http_referer: "",
		http_user_agent: "",
		ssl_protocol: "",
		ssl_curve: "",
		upstream_status: "",
	});
	assert.equal(parseLogLine(text).userAgent, "");
	assert.equal(parseLogLine(jsonOf(FULL("a.com", "203.0.113.7"), { request: "" })).method, "-");
	assert.equal(parseLogLine(jsonOf(FULL("a.com", "203.0.113.7"), { host: "" })), null);
});

it("keeps a JSON line with several upstream values", () => {
	const record = parseLogLine(jsonOf(FULL("a.com", "203.0.113.7"), { upstream_status: "502, 200" }));
	assert.equal(record.status, 200);
});

it("returns null for broken or foreign JSON lines", () => {
	const good = jsonOf(FULL("a.com", "203.0.113.7"));
	assert.equal(parseLogLine(good.slice(0, -5)), null);
	assert.equal(parseLogLine("{"), null);
	assert.equal(parseLogLine('{"a":1}'), null);
	assert.equal(parseAlogLine('{"a":1}'), null);
	assert.equal(parseLogLine("{}"), null);
	assert.equal(parseLogLine("{}garbage"), null);
	assert.equal(parseLogLine(jsonOf(FULL("a.com", "unix:"))), null);
	assert.equal(parseLogLine(jsonOf(FULL("a.com", "203.0.113.7"), { status: "20" })), null);
	assert.equal(parseLogLine(jsonOf(FULL("a.com", "203.0.113.7"), { bytes_sent: "-" })), null);
	assert.equal(parseLogLine(jsonOf(FULL("a.com", "203.0.113.7"), { time_local: "bad" })), null);
	assert.equal(
		parseLogLine(jsonOf(FULL("a.com", "203.0.113.7"), { time_local: "24/Xxx/2026:10:15:30 +0200" })),
		null,
	);
	assert.equal(parseLogLine(JSON.stringify({ ...JSON.parse(good), status: 200 })), null);
	assert.equal(parseLogLine("[1,2]"), null);
	assert.equal(isOwnRequest("{broken", "81"), false);
});

it("recognises NPMpro's own requests in JSON lines like in classic lines", () => {
	const cases = [
		[FULL("127.0.0.1:81", "127.0.0.1", { ua: "NPMpro/healthcheck", port: "81" }), "81"],
		[FULL("npm.lan:8181", "172.17.0.1", { port: "81" }), "81"],
		[FULL("example.com:81", "203.0.113.7"), "81"],
		[FULL("example.com", "203.0.113.7", { ua: "NPMpro/healthcheck" }), "81"],
		[FULL("127.0.0.1", "127.0.0.1", { ua: "NPMpro/healthcheck", port: "" }), "81"],
		[FULL("127.0.0.1", "::1", { ua: "NPMpro/healthcheck" }), "443"],
		[FULL("example.com", "203.0.113.7", { port: "80" }), "81"],
	];
	for (const [classic, port] of cases) {
		assert.equal(isOwnRequest(jsonOf(classic), port), isOwnRequest(classic, port), classic);
		assert.equal(isOwnRecord(parseLogLine(jsonOf(classic)), port), isOwnRequest(classic, port), classic);
	}
	assert.deepEqual(
		cases.map(([classic, port]) => isOwnRequest(classic, port)),
		[true, true, false, false, true, true, false],
	);
	const health = jsonOf(FULL("10.0.0.5", "10.0.0.5", { ua: "NPMpro/healthcheck" }));
	assert.equal(isOwnRequest(health, "443", ["10.0.0.5"]), true);
	assert.equal(isOwnRequest(health, "443"), false);
});

it("gives the same record for the classic and the JSON line of the same request", () => {
	const classic = readFileSync(new URL("./fixtures/log-lines/access-classic.log", import.meta.url), "utf8")
		.split("\n")
		.filter((entry) => entry !== "");
	assert.equal(classic.length, 6);
	for (const entry of classic) {
		assert.deepEqual(parseLogLine(jsonOf(entry)), parseLogLine(entry), entry);
		assert.equal(isOwnRequest(jsonOf(entry), 81), isOwnRequest(entry, 81), entry);
	}
});
