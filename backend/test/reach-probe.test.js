import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { request as undiciRequest } from "undici";
import { createRequest, isPublicAddress, probeReach } from "../lib/dns-check/reach-probe.js";
import { createGuardedAgent } from "../lib/outbound-guard.js";

const HEX_TOKEN = /^[0-9a-f]{32}$/u;
const NOT_PUBLIC = /not a public/u;
const DISK_FULL = /disk full/u;
const PUBLIC = "203.0.113.7";

const tokenStore = () => {
	const written = [];
	const removed = [];
	return {
		written,
		removed,
		writeToken: (token) => {
			written.push(token);
			return Promise.resolve();
		},
		removeToken: (token) => {
			removed.push(token);
			return Promise.resolve();
		},
	};
};

// answers by scheme: a function (call) => answer | null | throws, token read from the requested path
const fakeRequest = (handlers) => {
	const calls = [];
	const request = async (call) => {
		calls.push(call);
		const handler = handlers[call.scheme];
		if (!handler) throw new Error("no answer");
		const answer = await handler(call, call.path.split("/").pop());
		if (answer === null) throw new Error("no answer");
		return { headers: {}, ...answer };
	};
	return { request, calls };
};

const run = (store, request, extra = {}) =>
	probeReach({ name: "app.example.test", address: PUBLIC, request, ...store, ...extra });

const cleaned = (store) =>
	store.written.length === 1 && HEX_TOKEN.test(store.written[0]) && store.removed.join() === store.written.join();

it("is reachable on port 80 when the token comes back, and removes the token", async () => {
	const store = tokenStore();
	const { request, calls } = fakeRequest({ http: (_call, token) => ({ statusCode: 200, body: `${token}\n` }) });
	const out = await run(store, request);
	assert.equal(out.result, "reachable");
	assert.equal(out.port, 80);
	assert.equal(calls.length, 1);
	assert.deepEqual(
		{ scheme: calls[0].scheme, address: calls[0].address, port: calls[0].port, name: calls[0].name },
		{ scheme: "http", address: PUBLIC, port: 80, name: "app.example.test" },
	);
	assert.equal(calls[0].path, `/.well-known/acme-challenge/${store.written[0]}`);
	assert.equal(cleaned(store), true);
});

it("tries https after a redirect to https and is reachable on 443", async () => {
	const store = tokenStore();
	const { request, calls } = fakeRequest({
		http: () => ({ statusCode: 301, headers: { location: "https://app.example.test/x" }, body: "" }),
		https: (_call, token) => ({ statusCode: 200, body: token }),
	});
	const out = await run(store, request);
	assert.equal(out.result, "reachable");
	assert.equal(out.port, 443);
	assert.deepEqual(
		calls.map((call) => call.port),
		[80, 443],
	);
	assert.equal(cleaned(store), true);
});

it("tries https when port 80 gives no answer", async () => {
	const store = tokenStore();
	const { request } = fakeRequest({ https: (_call, token) => ({ statusCode: 200, body: token }) });
	assert.equal((await run(store, request)).port, 443);
	assert.equal(cleaned(store), true);
});

it("says router-answered for another body, also from a redirect elsewhere", async () => {
	for (const answer of [
		{ statusCode: 200, headers: { server: "lighttpd" }, body: "<html>router login</html>" },
		{ statusCode: 302, headers: { location: "http://192.168.1.1/login" }, body: "" },
		{ statusCode: 404, headers: { server: "nginx" }, body: "not found" },
	]) {
		const store = tokenStore();
		const out = await run(store, fakeRequest({ http: () => answer }).request);
		assert.equal(out.result, "router-answered");
		assert.equal(out.port, 80);
		assert.equal(cleaned(store), true);
	}
});

it("says router-answered when https answers with another body", async () => {
	const store = tokenStore();
	const { request } = fakeRequest({ https: () => ({ statusCode: 200, body: "router" }) });
	const out = await run(store, request);
	assert.deepEqual([out.result, out.port], ["router-answered", 443]);
	assert.equal(cleaned(store), true);
});

it("could not confirm when nothing answers (a timeout is an error of the request)", async () => {
	const store = tokenStore();
	const request = () => Promise.reject(Object.assign(new Error("timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" }));
	const out = await run(store, request);
	assert.equal(out.result, "could-not-confirm");
	assert.equal(out.port, null);
	assert.equal(cleaned(store), true);
});

it("makes no request without a public address", async () => {
	for (const address of [
		null,
		"",
		"10.0.0.5",
		"192.168.1.9",
		"100.64.1.1",
		"127.0.0.1",
		"169.254.1.1",
		"fd00::1",
		"::1",
		"name.example",
	]) {
		const store = tokenStore();
		const { request, calls } = fakeRequest({ http: () => ({ statusCode: 200, body: "" }) });
		const out = await run(store, request, { address });
		assert.equal(out.result, "no-public-address", String(address));
		assert.equal(calls.length, 0);
		assert.equal(store.written.length, 0);
	}
	assert.equal(isPublicAddress(PUBLIC), true);
	assert.equal(isPublicAddress("2001:db8::1"), true);
});

it("makes no request when the host overrides the challenge path", async () => {
	const store = tokenStore();
	const { request, calls } = fakeRequest({});
	const out = await run(store, request, { overridesChallenge: true });
	assert.equal(out.result, "overridden");
	assert.equal(calls.length, 0);
	assert.equal(store.written.length, 0);
});

it("removes the token when the write throws, and ignores a failing removal", async () => {
	const store = tokenStore();
	const noRequest = () => Promise.reject(new Error("x"));
	await assert.rejects(
		run(store, noRequest, { writeToken: () => Promise.reject(new Error("disk full")) }),
		DISK_FULL,
	);
	assert.equal(store.removed.length, 1);
	const again = tokenStore();
	const out = await run(again, () => Promise.resolve({ statusCode: 200, headers: {}, body: "x" }), {
		removeToken: () => Promise.reject(new Error("gone")),
	});
	assert.equal(out.result, "router-answered");
});

const local = () => createRequest({ isAllowed: () => true, timeoutMs: 300 });
const listen = (server) =>
	new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server.address().port));
	});
const close = (server) =>
	new Promise((resolve) => {
		server.closeAllConnections?.();
		server.close(resolve);
	});

it("the request sends the name as Host, does not follow a redirect and reads a bounded body", async () => {
	const seen = [];
	const server = createServer((req, res) => {
		seen.push(req.headers.host);
		if (req.url.endsWith("/redirect")) {
			res.writeHead(301, { location: "http://127.0.0.1:1/never" });
			res.end();
			return;
		}
		res.end("x".repeat(10_000));
	});
	const port = await listen(server);
	try {
		const base = { scheme: "http", address: "127.0.0.1", family: 4, port, name: "app.example.test" };
		const redirect = await local()({ ...base, path: "/redirect" });
		assert.equal(redirect.statusCode, 301);
		assert.equal(redirect.headers.location, "http://127.0.0.1:1/never");
		const big = await local()({ ...base, path: "/big" });
		assert.equal(big.body.length, 4096);
		assert.deepEqual(seen, ["app.example.test", "app.example.test"]);
	} finally {
		await close(server);
	}
});

it("stops reading and destroys the stream at the size limit (a body that never ends)", async () => {
	let closedEarly = false;
	const server = createServer((req, res) => {
		const timer = setInterval(() => res.write("y".repeat(65_536)), 1);
		req.socket.on("close", () => {
			closedEarly = true;
			clearInterval(timer);
		});
	});
	const port = await listen(server);
	try {
		const answer = await createRequest({ isAllowed: () => true, timeoutMs: 5000 })({
			scheme: "http",
			address: "127.0.0.1",
			family: 4,
			port,
			name: "a.example.test",
			path: "/",
		});
		assert.equal(answer.body.length, 4096);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(closedEarly, true);
	} finally {
		await close(server);
	}
});

it("fails on a real timeout when the server never answers", async () => {
	const server = createServer(() => undefined);
	const port = await listen(server);
	try {
		const started = Date.now();
		await assert.rejects(
			local()({ scheme: "http", address: "127.0.0.1", family: 4, port, name: "a.example.test", path: "/" }),
		);
		assert.ok(Date.now() - started < 3000);
	} finally {
		await close(server);
	}
});

it("the request fails when nothing listens", async () => {
	const server = createServer();
	const port = await listen(server);
	await close(server);
	await assert.rejects(
		local()({ scheme: "http", address: "127.0.0.1", family: 4, port, name: "a.example.test", path: "/" }),
	);
});

it("the default request refuses a loopback address before connecting", async () => {
	const server = createServer((_req, res) => res.end("hit"));
	const port = await listen(server);
	try {
		await assert.rejects(
			createRequest()({
				scheme: "http",
				address: "127.0.0.1",
				family: 4,
				port,
				name: "a.example.test",
				path: "/",
			}),
			NOT_PUBLIC,
		);
	} finally {
		await close(server);
	}
});

it("the guarded agent sends its servername as SNI to an IP address", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "reach-tls-"));
	let seenName = "unset";
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
				"k.pem",
				"-out",
				"c.pem",
				"-days",
				"1",
				"-subj",
				"/CN=x",
			],
			{ cwd: dir, stdio: "ignore" },
		);
		const server = createTlsServer(
			{ key: readFileSync(`${dir}/k.pem`), cert: readFileSync(`${dir}/c.pem`) },
			(_req, res) => res.end("ok"),
		);
		server.on("tlsClientError", () => undefined);
		server.prependListener("secureConnection", (socket) => {
			seenName = socket.servername;
		});
		const port = await listen(server);
		const agent = createGuardedAgent({ rejectUnauthorized: false, servername: "app.example.test" });
		try {
			const response = await undiciRequest(`https://127.0.0.1:${port}/`, { dispatcher: agent });
			await response.body.text();
			assert.equal(seenName, "app.example.test");
		} finally {
			await agent.close();
			await close(server);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("refuses a name that is not a plain host name before any write or request", async () => {
	for (const name of [
		"*.example.test",
		"app.example.test:8080",
		"a.test\r\nX: y",
		"",
		" a.test",
		"a_b.test",
		"-a.test",
		`${"a".repeat(64)}.test`,
		null,
	]) {
		const store = tokenStore();
		const { request, calls } = fakeRequest({ http: () => ({ statusCode: 200, body: "" }) });
		await assert.rejects(run(store, request, { name }), TypeError);
		assert.equal(calls.length, 0);
		assert.equal(store.written.length, 0);
	}
});

it("takes the family from the address", async () => {
	for (const [address, family] of [
		[PUBLIC, 4],
		["2001:db8::1", 6],
	]) {
		const store = tokenStore();
		const { request, calls } = fakeRequest({ http: (_call, token) => ({ statusCode: 200, body: token }) });
		await run(store, request, { address, family: 99 });
		assert.equal(calls[0].family, family);
	}
});

it("follows a 302, 307 or 301 to https on the host's name, but no other redirect", async () => {
	for (const statusCode of [301, 302, 307, 308]) {
		const store = tokenStore();
		const { request, calls } = fakeRequest({
			http: () => ({ statusCode, headers: { location: "https://APP.example.test/x" }, body: "" }),
			https: (_call, token) => ({ statusCode: 200, body: token }),
		});
		assert.equal((await run(store, request)).port, 443, String(statusCode));
		assert.equal(calls.length, 2);
	}
	for (const location of ["https://other.example.test/x", "http://app.example.test/x", "/relative", ""]) {
		const store = tokenStore();
		const { request, calls } = fakeRequest({
			http: () => ({ statusCode: 302, headers: { location }, body: "" }),
			https: (_call, token) => ({ statusCode: 200, body: token }),
		});
		assert.equal((await run(store, request)).result, "router-answered", location);
		assert.equal(calls.length, 1);
	}
});

it("does not take the newly listed ranges as public", () => {
	for (const address of [
		"64:ff9b::808:808",
		"2002:c000:204::1",
		"fec0::1",
		"192.0.0.8",
		"198.18.0.1",
		"198.19.255.1",
	]) {
		assert.equal(isPublicAddress(address), false, address);
	}
	assert.equal(isPublicAddress("198.20.0.1"), true);
	assert.equal(isPublicAddress("192.0.1.1"), true);
});
