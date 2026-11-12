import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { testConnection } from "../lib/crowdsec/connection-test.js";
import { CROWDSEC_DEFAULTS } from "../lib/crowdsec/settings.js";

const KEY = "good-key-0123456789";
const CLIENT_CERT = /client certificate/u;

// a fake LAPI (decisions for 127.0.0.1 with the key) and AppSec (any other path, the bouncer's headers)
const handler = (req, res) => {
	if (req.url.startsWith("/v1/decisions")) {
		const ok = req.headers["x-api-key"] === KEY && req.url === "/v1/decisions?ip=127.0.0.1";
		res.writeHead(ok ? 200 : 403, { "content-type": "application/json" });
		res.end(ok ? "null" : '{"message":"access forbidden"}');
		return;
	}
	if (req.headers["x-crowdsec-appsec-api-key"] !== KEY) {
		res.writeHead(401);
		res.end();
		return;
	}
	const blocked = req.url === "/block";
	res.writeHead(blocked ? 403 : 200, { "content-type": "application/json" });
	res.end(blocked ? '{"action":"ban"}' : '{"action":"allow"}');
};

const listen = async (server) => {
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return server.address().port;
};
const close = (server) => new Promise((resolve) => server.close(resolve));

let plain;
let base;
before(async () => {
	plain = http.createServer(handler);
	base = `http://127.0.0.1:${await listen(plain)}`;
});
after(() => close(plain));

const valuesOf = (extra) => ({
	...CROWDSEC_DEFAULTS,
	enabled: true,
	api_url: base,
	api_key: KEY,
	appsec_url: `${base}/appsec`,
	...extra,
});

it("passes with a working LAPI and AppSec", async () => {
	assert.deepEqual(await testConnection(valuesOf()), {
		ok: true,
		checks: [
			{ name: "lapi", result: "ok", message: "" },
			{ name: "appsec", result: "ok", message: "" },
		],
	});
});

it("tells a refused key from an unreachable service, and never names the key", async () => {
	const wrong = await testConnection(valuesOf({ api_key: "wrong-key-secret" }));
	assert.equal(wrong.ok, false);
	assert.deepEqual(
		wrong.checks.map((check) => [check.name, check.result]),
		[
			["lapi", "key_refused"],
			["appsec", "refused"],
		],
	);
	const down = await testConnection(valuesOf({ api_url: "http://127.0.0.1:1", appsec_url: "http://127.0.0.1:1" }), {
		timeoutMs: 2000,
	});
	assert.deepEqual(
		down.checks.map((check) => check.result),
		["unreachable", "unreachable"],
	);
	assert.equal(JSON.stringify([wrong, down]).includes("wrong-key-secret"), false);
	assert.equal(JSON.stringify([wrong, down]).includes(KEY), false);
});

it("checks AppSec only with an AppSec URL, and needs an LAPI URL", async () => {
	assert.deepEqual(
		(await testConnection(valuesOf({ appsec_url: "" }))).checks.map((check) => check.name),
		["lapi"],
	);
	assert.deepEqual((await testConnection(valuesOf({ api_url: "", appsec_url: "" }))).checks, [
		{ name: "lapi", result: "unreachable", message: "No LAPI URL is set" },
	]);
});

it("counts a 403 of AppSec as an answer and reports other status codes", async () => {
	const blocked = await testConnection(valuesOf({ appsec_url: `${base}/block` }));
	assert.equal(blocked.ok, true);
	const odd = http.createServer((_, res) => {
		res.writeHead(500);
		res.end();
	});
	const url = `http://127.0.0.1:${await listen(odd)}`;
	try {
		const result = await testConnection(valuesOf({ api_url: url, appsec_url: url }));
		assert.deepEqual(
			result.checks.map((check) => [check.result, check.message]),
			[
				["status", "HTTP 500"],
				["status", "HTTP 500"],
			],
		);
	} finally {
		await close(odd);
	}
});

const selfSigned = () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "cs-tls-"));
	const crt = path.join(dir, "server.crt");
	const key = path.join(dir, "server.key");
	try {
		execFileSync(
			"openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				key,
				"-out",
				crt,
				"-days",
				"1",
				"-subj",
				"/CN=127.0.0.1",
			],
			{ stdio: "ignore" },
		);
	} catch {
		return null;
	}
	return { crt, key };
};

it("names a certificate the check does not trust a TLS error, and passes without verification", async (t) => {
	const files = selfSigned();
	if (!files) {
		t.skip("openssl not available");
		return;
	}
	const server = https.createServer({ cert: readFileSync(files.crt), key: readFileSync(files.key) }, handler);
	const url = `https://127.0.0.1:${await listen(server)}`;
	try {
		const verified = await testConnection(valuesOf({ api_url: url, appsec_url: `${url}/appsec` }));
		assert.deepEqual(
			verified.checks.map((check) => check.result),
			["tls_error", "tls_error"],
		);
		const unverified = await testConnection(
			valuesOf({ api_url: url, appsec_url: `${url}/appsec`, ssl_verify: false }),
		);
		assert.equal(unverified.ok, true);
	} finally {
		await close(server);
	}
});

it("names an unreadable TLS client file a TLS error", async () => {
	const result = await testConnection(
		valuesOf({
			api_url: "https://127.0.0.1:1",
			appsec_url: "",
			use_tls_auth: true,
			tls_client_cert: "/nonexistent/client.crt",
			tls_client_key: "/nonexistent/client.key",
		}),
	);
	assert.equal(result.checks[0].result, "tls_error");
	assert.match(result.checks[0].message, CLIENT_CERT);
});
