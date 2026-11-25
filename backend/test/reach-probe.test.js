import assert from "node:assert/strict";
import { createServer } from "node:http";
import { it } from "node:test";
import { defaultRequest, isPublicAddress, probeReach } from "../lib/dns-check/reach-probe.js";

const HEX_TOKEN = /^[0-9a-f]{32}$/u;
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
	probeReach({ name: "app.example.test", address: PUBLIC, family: 4, request, ...store, ...extra });

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

it("the default request sends the name as Host, does not follow a redirect and reads a bounded body", async () => {
	const seen = [];
	const server = createServer((req, res) => {
		seen.push({ host: req.headers.host, url: req.url });
		if (req.url.endsWith("/redirect")) {
			res.writeHead(301, { location: "http://127.0.0.1:1/never" });
			res.end();
			return;
		}
		res.end("x".repeat(10_000));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		const base = { scheme: "http", address: "127.0.0.1", family: 4, port, name: "app.example.test" };
		const redirect = await defaultRequest({ ...base, path: "/redirect" });
		assert.equal(redirect.statusCode, 301);
		assert.equal(redirect.headers.location, "http://127.0.0.1:1/never");
		const big = await defaultRequest({ ...base, path: "/big" });
		assert.equal(big.body.length, 4096);
		assert.deepEqual(
			seen.map((entry) => entry.host),
			["app.example.test", "app.example.test"],
		);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

it("the default request fails when nothing listens", async () => {
	const server = createServer();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	await new Promise((resolve) => server.close(resolve));
	await assert.rejects(
		defaultRequest({ scheme: "http", address: "127.0.0.1", family: 4, port, name: "a.example.test", path: "/" }),
	);
});
