import assert from "node:assert/strict";
import { it } from "node:test";
import {
	buildCurl,
	buildNode,
	buildPython,
	buildTryRequest,
	fillPath,
	formatAnswer,
	highlightJson,
	highlightShell,
	TOKEN_VAR,
} from "./ApiRequest.js";

const RE_MISSING = /missing-path:hostID/u;
const RE_MULTIPART = /-F "file=@file" \\\n {2}-F "note=x"$/u;
const RE_INVALID = /invalid-json/u;
const RE_BINARY = /-H "Content-Type: application\/octet-stream" \\\n {2}--data-binary @file$/u;
const NODE_TOKEN = ["Bearer $", "{process.env.NPMPRO_TOKEN}"].join("");
const ORIGIN = "https://npm.example.com:81";
const op = (extra) => ({ method: "GET", path: "/nginx/proxy-hosts", auth: "token", params: [], body: null, ...extra });
const HOST_ID = { name: "hostID", in: "path", required: true, example: 12 };

it("fillPath encodes the values and refuses a missing one", () => {
	assert.equal(fillPath("/nginx/proxy-hosts/{hostID}", { hostID: "1/2" }), "/nginx/proxy-hosts/1%2F2");
	assert.throws(() => fillPath("/nginx/proxy-hosts/{hostID}", { hostID: "" }), RE_MISSING);
	assert.throws(() => fillPath("/nginx/proxy-hosts/{hostID}", {}), RE_MISSING);
});

it("buildCurl writes a GET with the token variable", () => {
	assert.equal(
		buildCurl({ origin: ORIGIN, operation: op() }),
		`curl ${ORIGIN}/api/nginx/proxy-hosts \\\n  -H "Authorization: Bearer ${TOKEN_VAR}"`,
	);
});

it("buildCurl writes a POST with its JSON example, escaping single quotes", () => {
	const operation = op({
		method: "POST",
		body: { mediaType: "application/json", example: { name: "Jane's host" } },
	});
	assert.equal(
		buildCurl({ origin: ORIGIN, operation }),
		[
			`curl -X POST ${ORIGIN}/api/nginx/proxy-hosts \\`,
			`  -H "Authorization: Bearer ${TOKEN_VAR}" \\`,
			'  -H "Content-Type: application/json" \\',
			`  -d '{"name":"Jane'\\''s host"}'`,
		].join("\n"),
	);
});

it("buildCurl fills path examples, quotes a URL with a required query and marks session-only routes", () => {
	const operation = op({
		path: "/nginx/proxy-hosts/{hostID}/{other}",
		auth: "session",
		params: [
			HOST_ID,
			{ name: "other", in: "path", required: true },
			{ name: "limit", in: "query", required: true, example: 20 },
			{ name: "expand", in: "query", required: false, example: "owner" },
		],
	});
	assert.equal(
		buildCurl({ origin: ORIGIN, operation }),
		`# Needs a signed-in session: API tokens are refused\ncurl "${ORIGIN}/api/nginx/proxy-hosts/12/{other}?limit=20"`,
	);
});

it("buildCurl writes public routes without a header, and file uploads", () => {
	assert.equal(buildCurl({ origin: ORIGIN, operation: op({ path: "/", auth: "public" }) }), `curl ${ORIGIN}/api/`);
	const multipart = op({
		method: "POST",
		path: "/settings/oidc/icon",
		body: {
			mediaType: "multipart/form-data",
			schema: {
				properties: { file: { type: "string", format: "binary" }, note: { type: "string", example: "x" } },
			},
		},
	});
	assert.match(buildCurl({ origin: ORIGIN, operation: multipart }), RE_MULTIPART);
	const binary = op({ method: "POST", path: "/backups/upload", body: { mediaType: "application/octet-stream" } });
	assert.match(buildCurl({ origin: ORIGIN, operation: binary }), RE_BINARY);
});

it("buildTryRequest runs as the session or as the token, never both", () => {
	const operation = op({ method: "POST", path: "/nginx/proxy-hosts/{hostID}/enable", params: [HOST_ID] });
	const session = buildTryRequest({ operation, values: { hostID: "12" }, query: {}, bodyText: "" });
	assert.equal(session.url, "/api/nginx/proxy-hosts/12/enable");
	assert.equal(session.init.method, "POST");
	assert.equal(session.init.credentials, "same-origin");
	assert.equal(session.init.headers.Authorization, undefined);
	assert.equal(session.init.body, undefined);
	assert.equal(session.init.redirect, "manual");
	assert.equal(session.init.cache, "no-store");
	const token = buildTryRequest({ operation, values: { hostID: "12" }, query: {}, bodyText: "", token: "npmpro_ab" });
	assert.equal(token.init.credentials, "omit");
	assert.equal(token.init.headers.Authorization, "Bearer npmpro_ab");
});

it("buildTryRequest sends query and JSON body, and refuses bad JSON", () => {
	const done = buildTryRequest({
		operation: op({ method: "PUT" }),
		values: {},
		query: { expand: "owner", search: "", limit: "5" },
		bodyText: '{ "a": 1 }',
	});
	assert.equal(done.url, "/api/nginx/proxy-hosts?expand=owner&limit=5");
	assert.equal(done.init.body, '{"a":1}');
	assert.equal(done.init.headers["Content-Type"], "application/json");
	assert.throws(() => buildTryRequest({ operation: op(), values: {}, query: {}, bodyText: "{" }), RE_INVALID);
});

it("highlightJson marks keys, strings, numbers and literals and keeps the text", () => {
	const text = '{\n  "id": 12,\n  "name": "a: b",\n  "on": true,\n  "x": null\n}';
	const tokens = highlightJson(text);
	assert.equal(tokens.map((t) => t.text).join(""), text);
	const kinds = (kind) => tokens.filter((t) => t.kind === kind).map((t) => t.text);
	assert.deepEqual(kinds("key"), ['"id"', '"name"', '"on"', '"x"']);
	assert.deepEqual(kinds("string"), ['"a: b"']);
	assert.deepEqual(kinds("number"), ["12"]);
	assert.deepEqual(kinds("literal"), ["true", "null"]);
});

it("highlightShell marks comments and quoted strings and keeps the text", () => {
	const text = `# note\ncurl -H "A: b" -d '{"x":1}'`;
	const tokens = highlightShell(text);
	assert.equal(tokens.map((t) => t.text).join(""), text);
	assert.deepEqual(
		tokens.filter((t) => t.kind !== "plain").map((t) => [t.kind, t.text]),
		[
			["comment", "# note"],
			["string", '"A: b"'],
			["string", `'{"x":1}'`],
		],
	);
});

it("formatAnswer pretty-prints JSON, cuts long text and summarizes binary answers", () => {
	assert.deepEqual(formatAnswer({ contentType: "application/json; charset=utf-8", text: '{"a":1}' }), {
		kind: "json",
		text: '{\n  "a": 1\n}',
	});
	assert.equal(formatAnswer({ contentType: "application/problem+json", text: "[]" }).kind, "json");
	assert.deepEqual(formatAnswer({ contentType: "application/json", text: "{" }), { kind: "text", text: "{" });
	const long = formatAnswer({ contentType: "text/html", text: "x".repeat(20_001) });
	assert.equal(long.text.length, 20_004);
	assert.ok(long.text.endsWith("\n..."));
	assert.deepEqual(formatAnswer({ contentType: "application/zip", size: 2048 }), {
		kind: "binary",
		text: "application/zip, 2048 bytes",
	});
});

const POST = op({
	method: "POST",
	body: {
		mediaType: "application/json",
		example: { domain_names: ["app.example.com"], ssl_forced: true, access_list_id: null },
	},
});

it("buildNode writes a GET with the token from the environment", () => {
	assert.equal(
		buildNode({ origin: ORIGIN, operation: op() }),
		[
			`const response = await fetch("${ORIGIN}/api/nginx/proxy-hosts", {`,
			`  headers: { Authorization: \`${NODE_TOKEN}\` },`,
			"});",
			"console.log(response.status, await response.text());",
		].join("\n"),
	);
});

it("buildNode writes a POST with its JSON body pretty-printed", () => {
	assert.equal(
		buildNode({ origin: ORIGIN, operation: POST }),
		[
			`const response = await fetch("${ORIGIN}/api/nginx/proxy-hosts", {`,
			'  method: "POST",',
			"  headers: {",
			`    Authorization: \`${NODE_TOKEN}\`,`,
			'    "Content-Type": "application/json",',
			"  },",
			"  body: JSON.stringify({",
			'    "domain_names": [',
			'      "app.example.com"',
			"    ],",
			'    "ssl_forced": true,',
			'    "access_list_id": null',
			"  }),",
			"});",
			"console.log(response.status, await response.text());",
		].join("\n"),
	);
});

it("buildPython writes a GET with the token from the environment", () => {
	assert.equal(
		buildPython({ origin: ORIGIN, operation: op() }),
		[
			"import os",
			"import requests",
			"",
			"response = requests.get(",
			`    "${ORIGIN}/api/nginx/proxy-hosts",`,
			`    headers={"Authorization": f"Bearer {os.environ['NPMPRO_TOKEN']}"},`,
			")",
			"print(response.status_code, response.text)",
		].join("\n"),
	);
});

it("buildPython writes a POST with its body as Python literals", () => {
	assert.equal(
		buildPython({ origin: ORIGIN, operation: POST }),
		[
			"import os",
			"import requests",
			"",
			"response = requests.post(",
			`    "${ORIGIN}/api/nginx/proxy-hosts",`,
			`    headers={"Authorization": f"Bearer {os.environ['NPMPRO_TOKEN']}"},`,
			"    json={",
			'        "domain_names": [',
			'            "app.example.com"',
			"        ],",
			'        "ssl_forced": True,',
			'        "access_list_id": None',
			"    },",
			")",
			"print(response.status_code, response.text)",
		].join("\n"),
	);
});

it("both mark session-only and public routes and send file uploads to curl", () => {
	const session = op({ auth: "session" });
	assert.ok(
		buildNode({ origin: ORIGIN, operation: session }).startsWith(
			"// Needs a signed-in session: API tokens are refused\n",
		),
	);
	assert.ok(!buildNode({ origin: ORIGIN, operation: session }).includes("Authorization"));
	assert.ok(
		buildPython({ origin: ORIGIN, operation: session }).startsWith(
			"# Needs a signed-in session: API tokens are refused\nimport requests\n",
		),
	);
	assert.ok(!buildPython({ origin: ORIGIN, operation: op({ auth: "public" }) }).includes("import os"));
	const upload = op({ method: "POST", body: { mediaType: "application/octet-stream" } });
	assert.equal(
		buildNode({ origin: ORIGIN, operation: upload }),
		"// File uploads: use the curl command for this route",
	);
	assert.equal(
		buildPython({ origin: ORIGIN, operation: upload }),
		"# File uploads: use the curl command for this route",
	);
});
