import assert from "node:assert/strict";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { after, it } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";

process.env.NPMPRO_TEST_ROOT = "/nonexistent-provider-fetch-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");
const { DdnsProviderError, scrubSecrets } = await import("../lib/ddns/errors.js");
const { isPrivateLanAddress } = await import("../lib/blocked-address.js");

const names = new Map([
	["api.test", ["93.184.216.34"]],
	["loop.test", ["127.0.0.1"]],
	["meta.test", ["169.254.169.254"]],
	["lan.test", ["192.168.1.10"]],
	["mixed.test", ["192.168.1.10", "93.184.216.34"]],
]);
const realLookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
	const done = typeof options === "function" ? options : callback;
	const list = names.get(hostname);
	if (!list) return done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
	const all = list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
	return options?.all ? done(null, all) : done(null, all[0].address, all[0].family);
};
syncBuiltinESMExports();
const mock = new MockAgent();
mock.disableNetConnect();
setGlobalDispatcher(mock);
after(() => {
	dns.lookup = realLookup;
	syncBuiltinESMExports();
});

const json = { headers: { "content-type": "application/json" } };
const withCode = (code) => (err) => err instanceof DdnsProviderError && err.code === code;

it("refuses http, also with a blocked or public host", async () => {
	await assert.rejects(providerFetch("http://api.test/x"), withCode("not-https"));
	await assert.rejects(providerFetch("http://192.168.1.10/x"), withCode("not-https"));
	await assert.rejects(providerFetch("not a url"), withCode("not-https"));
});

it("refuses blocked hosts before any request is made", async () => {
	for (const url of [
		"https://127.0.0.1/x",
		"https://169.254.169.254/x",
		"https://loop.test/x",
		"https://meta.test/x",
	]) {
		await assert.rejects(providerFetch(url), (err) => err.code === "blocked" && err.retry === false);
	}
	mock.assertNoPendingInterceptors();
});

it("a 3xx answer is code redirect and is not followed", async () => {
	mock.get("https://api.test")
		.intercept({ path: "/r", method: "GET" })
		.reply(302, "", { headers: { location: "https://api.test/other" } });
	await assert.rejects(providerFetch("https://api.test/r"), withCode("redirect"));
});

it("a slow answer is code timeout", async () => {
	mock.get("https://api.test").intercept({ path: "/slow", method: "GET" }).reply(200, "{}").delay(500);
	await assert.rejects(providerFetch("https://api.test/slow", { timeoutMs: 50 }), withCode("timeout"));
});

it("a deadline that has fired ends the call in flight and every later one with code timeout", async () => {
	mock.get("https://api.test").intercept({ path: "/late", method: "GET" }).reply(200, "{}").delay(500);
	const deadline = AbortSignal.timeout(50);
	await assert.rejects(providerFetch("https://api.test/late", { deadline }), withCode("timeout"));
	// no request is made once it has fired
	await assert.rejects(providerFetch("https://api.test/never", { deadline }), withCode("timeout"));
});

it("a network error is code network", async () => {
	mock.get("https://api.test").intercept({ path: "/err", method: "GET" }).replyWithError(new Error("boom"));
	await assert.rejects(providerFetch("https://api.test/err"), withCode("network"));
});

it("a 403 with JSON is returned, not thrown; a non-JSON body has json null", async () => {
	mock.get("https://api.test").intercept({ path: "/forbidden", method: "GET" }).reply(403, { error: "no" }, json);
	const res = await providerFetch("https://api.test/forbidden");
	assert.equal(res.status, 403);
	assert.deepEqual(res.json, { error: "no" });
	mock.get("https://api.test").intercept({ path: "/html", method: "POST" }).reply(500, "<html>");
	const bad = await providerFetch("https://api.test/html", { method: "POST", body: "x", headers: { a: "b" } });
	assert.equal(bad.status, 500);
	assert.equal(bad.json, null);
	assert.equal(bad.text, "<html>");
});

it("allowPrivateHttp lets http reach a private LAN address and nothing else", async () => {
	mock.get("http://192.168.1.10").intercept({ path: "/x", method: "GET" }).reply(200, { ok: true }, json);
	assert.deepEqual((await providerFetch("http://192.168.1.10/x", { allowPrivateHttp: true })).json, { ok: true });
	await assert.rejects(providerFetch("http://192.168.1.10/x"), withCode("not-https"));

	mock.get("http://lan.test").intercept({ path: "/x", method: "GET" }).reply(200, { ok: 1 }, json);
	assert.deepEqual((await providerFetch("http://lan.test/x", { allowPrivateHttp: true })).json, { ok: 1 });

	await assert.rejects(providerFetch("http://api.test/x", { allowPrivateHttp: true }), withCode("not-https"));
	await assert.rejects(providerFetch("http://mixed.test/x", { allowPrivateHttp: true }), withCode("not-https"));
	await assert.rejects(providerFetch("http://8.8.8.8/x", { allowPrivateHttp: true }), withCode("not-https"));
	await assert.rejects(providerFetch("http://gone.test/x", { allowPrivateHttp: true }), withCode("network"));
	await assert.rejects(providerFetch("http://127.0.0.1/x", { allowPrivateHttp: true }), withCode("blocked"));
	await assert.rejects(providerFetch("http://meta.test/x", { allowPrivateHttp: true }), withCode("blocked"));
});

it("scrubSecrets replaces secrets and their URL form, drops line breaks and cuts to 300", () => {
	assert.equal(scrubSecrets("token my-secret in my-secret%20", ["my-secret"]), "token *** in ***%20");
	assert.equal(scrubSecrets("a b/c", ["a b/c"]), "***");
	assert.equal(scrubSecrets("x ab%20cd y", ["ab cd"]), "x *** y");
	assert.equal(scrubSecrets("abc xyz", ["abc"]), "abc xyz");
	assert.equal(scrubSecrets("l1\r\nl2\nl3"), "l1 l2 l3");
	assert.equal(scrubSecrets("x".repeat(400)).length, 300);
	assert.equal(scrubSecrets(undefined), "");
});

it("scrubSecrets also replaces the JSON-escaped and plus-for-space forms", () => {
	assert.equal(scrubSecrets('{"e":"a\\"b\\\\c"}', ['a"b\\c']), '{"e":"***"}');
	assert.equal(scrubSecrets("q=ab+cd&x", ["ab cd"]), "q=***&x");
	assert.equal(scrubSecrets("ab%20cd ab+cd ab cd", ["ab cd"]), "*** *** ***");
});

it("DdnsProviderError scrubs its own message", () => {
	const err = new DdnsProviderError({
		providerStatus: 401,
		code: "auth",
		message: "bad token TOPSECRET",
		secrets: ["TOPSECRET"],
	});
	assert.equal(err.message, "bad token ***");
	assert.equal(err.providerStatus, 401);
	// the API error handler answers with err.status: a provider's status must never become it
	assert.equal(err.status, undefined);
	assert.equal(err.retry, true);
	assert.equal(err.public, true);
});

it("isPrivateLanAddress covers the LAN ranges and the mapped forms, never blocked ranges", () => {
	for (const ip of [
		"10.1.2.3",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.10",
		"fc00::1",
		"fd12::1",
		"::ffff:192.168.1.10",
	]) {
		assert.equal(isPrivateLanAddress(ip), true, ip);
	}
	for (const ip of [
		"172.32.0.1",
		"8.8.8.8",
		"127.0.0.1",
		"169.254.1.1",
		"::1",
		"fe80::1",
		"::ffff:127.0.0.1",
		"::ffff:8.8.8.8",
		"nope",
		"100.64.1.1",
	]) {
		assert.equal(isPrivateLanAddress(ip), false, ip);
	}
});
