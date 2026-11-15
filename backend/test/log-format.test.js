import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import {
	ACCESS_FIELDS,
	LOG_FORMATS,
	renderClassic,
	renderJson,
	STREAM_FIELDS,
	tokenizeClassic,
} from "../lib/log-format.js";

const NGINX_CONF = readFileSync(path.join(import.meta.dirname, "../../rootfs/usr/local/nginx/conf/nginx.conf"), "utf8");
const HOST_ID_MAP = /map \$host \$npmpro_host_id \{\s*default "-";\s*\}/u;
const STREAM_ID_MAP = /map \$server_port \$npmpro_stream_id \{\s*default "-";\s*\}/u;
const formatOf = (name) => new RegExp(`log_format ${name} '([^']*)';`, "u").exec(NGINX_CONF)?.[1];

it("nginx.conf writes alog and slog from the field lists", () => {
	assert.equal(formatOf("alog"), renderClassic(ACCESS_FIELDS));
	assert.equal(formatOf("slog"), renderClassic(STREAM_FIELDS));
});

it("only appends to the classic access format: the fields up to $server_port stay as they were", () => {
	const old =
		'[$time_local] $host$is_request_port$request_port $remote_addr $request_time "$request" $status $bytes_sent "$http_referer" "$http_user_agent" "$remote_user" "$sent_http_content_type" $ssl_protocol $ssl_cipher $ssl_curve $upstream_cache_status $server_port';
	assert.ok(formatOf("alog").startsWith(`${old} `));
	assert.ok(
		formatOf("slog").startsWith(
			"[$time_local] $server_port $remote_addr $protocol $ssl_preread_protocol $status $bytes_sent $bytes_received $session_time ",
		),
	);
});

it("declares the host and stream ids with a default, so a server without set logs - and no warning", () => {
	assert.match(NGINX_CONF, HOST_ID_MAP);
	assert.match(NGINX_CONF, STREAM_ID_MAP);
});

it("tokenizes lines with an empty host, server name and port and several upstream values", () => {
	const line =
		'[14/Nov/2026:21:29:00 +0000]  203.0.113.9 0.000 "GET / HTTP/1.0" 444 0 "-" "curl/8" "-" "-" - - - -  "" default 0123456789abcdef0123456789abcdef 7 "502, 200" "0.001, 0.004 : 0.002"';
	const fields = tokenizeClassic(line, ACCESS_FIELDS);
	assert.equal(fields.host, "");
	assert.equal(fields.server_port, "");
	assert.equal(fields.server_name, "");
	assert.equal(fields.host_id, "default");
	assert.equal(fields.upstream_status, "502, 200");
	assert.equal(fields.upstream_response_time, "0.001, 0.004 : 0.002");
	assert.equal(tokenizeClassic("not a log line", ACCESS_FIELDS), null);
});

it("keeps an escaped quote inside its field and refuses a line written before the new fields", () => {
	const head =
		'[14/Nov/2026:21:29:00 +0000] a.example.com 203.0.113.9 0.002 "GET /\\x22x HTTP/1.1" 200 12 "-" "say \\x22hi\\x22" "-" "text/html" TLSv1.3 TLS_AES_128_GCM_SHA256 X25519 - 443';
	const fields = tokenizeClassic(
		`${head} "a.example.com" proxy-3 0123456789abcdef0123456789abcdef 9 "200" "0.002"`,
		ACCESS_FIELDS,
	);
	assert.equal(fields.request, "GET /\\x22x HTTP/1.1");
	assert.equal(fields.http_user_agent, "say \\x22hi\\x22");
	assert.equal(fields.host_id, "proxy-3");
	assert.equal(tokenizeClassic(head, ACCESS_FIELDS), null);
});

it("nginx.conf writes ajson and sjson from the same field lists as alog and slog", () => {
	// The braces are separate quoted strings (nginx joins them) because nginxbeautifier splits a line at every brace.
	const json = (name) => {
		const body = new RegExp(`log_format ${name} escape=json '\\{' '([^']*)' '\\}';`, "u").exec(NGINX_CONF)?.[1];
		return body === undefined ? undefined : `{${body}}`;
	};
	assert.deepEqual(LOG_FORMATS, ["classic", "json"]);
	assert.equal(json("ajson"), renderJson(ACCESS_FIELDS));
	assert.equal(json("sjson"), renderJson(STREAM_FIELDS));
	assert.deepEqual(
		Object.keys(JSON.parse(renderJson(ACCESS_FIELDS))),
		ACCESS_FIELDS.map((field) => field.name),
	);
	assert.deepEqual(
		Object.keys(JSON.parse(renderJson(STREAM_FIELDS))),
		STREAM_FIELDS.map((field) => field.name),
	);
});
