import assert from "node:assert/strict";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { after, beforeEach, it } from "node:test";
import { Agent, MockAgent, setGlobalDispatcher } from "undici";

// the reads go through the global dispatcher only in the test root with NPMPRO_TEST_OUTBOUND=mock; the host check runs
process.env.NPMPRO_TEST_ROOT = "/nonexistent-acme-directory-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { assertAllowedHost, cacheSize, clearAcmeDirectoryCache, dispatcherFor, readAcmeDirectory, unreachableReason } =
	await import("../lib/acme-directory.js");

const names = new Map([
	["ca.lan", "192.168.1.10"],
	["loop.test", "127.0.0.1"],
	["meta.test", "169.254.169.254"],
	["six.test", "::1"],
]);
const realLookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
	const done = typeof options === "function" ? options : callback;
	const address = names.get(hostname);
	if (!address) return done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
	const family = address.includes(":") ? 6 : 4;
	return options?.all ? done(null, [{ address, family }]) : done(null, address, family);
};
syncBuiltinESMExports();
const mock = new MockAgent();
mock.disableNetConnect();
setGlobalDispatcher(mock);
beforeEach(() => clearAcmeDirectoryCache());
after(() => {
	dns.lookup = realLookup;
	syncBuiltinESMExports();
});

const DIRECTORY = {
	newNonce: "https://ca.lan/nonce",
	meta: {
		externalAccountRequired: true,
		profiles: { classic: "The classic profile", tlsserver: 7, "bad name": "x" },
	},
};
const reply = (origin, path, status, body) =>
	mock
		.get(origin)
		.intercept({ path, method: "GET" })
		.reply(status, body, { headers: { "content-type": "application/json" } });

it("refuses blocked hosts before any request: IP literals and names that resolve to one", async () => {
	for (const url of [
		"https://127.0.0.1/dir",
		"https://169.254.169.254/directory",
		"https://[::1]/dir",
		"https://loop.test/dir",
		"https://meta.test/dir",
		"https://six.test/dir",
	]) {
		await assert.rejects(
			readAcmeDirectory(url),
			(err) => err.name === "ValidationError" && err.message_i18n === "error.acme-blocked",
			url,
		);
	}
	await assert.doesNotReject(assertAllowedHost("https://ca.lan/dir"));
});

it("reads a LAN CA: profiles with their descriptions, the EAB requirement, an ACME directory", async () => {
	reply("https://ca.lan", "/dir", 200, DIRECTORY);
	assert.deepEqual(await readAcmeDirectory("https://ca.lan/dir"), {
		reachable: true,
		directory: true,
		external_account_required: true,
		caa_identities: [],
		profiles: { classic: "The classic profile", tlsserver: "" },
	});
});

it("reads meta.caaIdentities: lower case, no duplicate, no blank or non-string entry, at most 10", async () => {
	const many = Array.from({ length: 12 }, (_, i) => `ca${i}.example`);
	reply("https://ca.lan", "/caa", 200, {
		newNonce: "n",
		meta: { caaIdentities: ["Sectigo.COM", "sectigo.com", " ", 7, ...many] },
	});
	const { caa_identities } = await readAcmeDirectory("https://ca.lan/caa");
	assert.equal(caa_identities.length, 10);
	assert.deepEqual(caa_identities.slice(0, 2), ["sectigo.com", "ca0.example"]);
	reply("https://ca.lan", "/caa-bad", 200, { newNonce: "n", meta: { caaIdentities: "letsencrypt.org" } });
	assert.deepEqual((await readAcmeDirectory("https://ca.lan/caa-bad")).caa_identities, []);
});

it("reads a trusted (env) URL on this host without the guard", async () => {
	reply("https://127.0.0.1:14000", "/dir", 200, { newNonce: "x" });
	const result = await readAcmeDirectory("https://127.0.0.1:14000/dir", { guarded: false });
	assert.equal(result.directory, true);
	assert.equal(result.external_account_required, false);
});

it("tells an unreachable CA (network error, timeout, 5xx) from one that is no ACME directory (4xx, no newNonce)", async () => {
	reply("https://ca.lan", "/down", 503, "down");
	assert.equal((await readAcmeDirectory("https://ca.lan/down")).reachable, false);
	assert.equal((await readAcmeDirectory("https://ca.lan/nothing-intercepted")).reachable, false);
	reply("https://ca.lan", "/404", 404, "no");
	assert.deepEqual(await readAcmeDirectory("https://ca.lan/404"), {
		reachable: true,
		directory: false,
		external_account_required: false,
		caa_identities: [],
		profiles: {},
	});
	reply("https://ca.lan", "/html", 200, "<html>");
	assert.equal((await readAcmeDirectory("https://ca.lan/html")).directory, false);
});

it("caches a reachable answer for 5 minutes unless fresh is asked", async () => {
	reply("https://ca.lan", "/cached", 200, DIRECTORY);
	await readAcmeDirectory("https://ca.lan/cached");
	assert.equal((await readAcmeDirectory("https://ca.lan/cached")).directory, true);
	assert.equal((await readAcmeDirectory("https://ca.lan/cached", { fresh: true })).reachable, false);
});

it("uses a guarded agent per TLS choice outside the test root, and the default dispatcher for a verified trusted read", () => {
	process.env.NPMPRO_TEST_OUTBOUND = "";
	try {
		const verified = dispatcherFor({ guarded: true, verify: true });
		const insecure = dispatcherFor({ guarded: true, verify: false });
		assert.ok(verified instanceof Agent);
		assert.ok(insecure instanceof Agent);
		assert.notEqual(verified, insecure);
		assert.equal(dispatcherFor({ guarded: true, verify: true }), verified);
		assert.equal(dispatcherFor({ guarded: false, verify: true }), undefined);
		assert.ok(dispatcherFor({ guarded: false, verify: false }) instanceof Agent);
	} finally {
		process.env.NPMPRO_TEST_OUTBOUND = "mock";
	}
});

it("refuses a body over 1 MiB as not reachable", async () => {
	reply("https://ca.lan", "/big", 200, `{"newNonce":"${"x".repeat(1024 * 1024)}"}`);
	const result = await readAcmeDirectory("https://ca.lan/big");
	assert.equal(result.reachable, false);
	assert.equal(result.error, "TOO_LARGE");
});

it("keeps at most 32 cached answers", async () => {
	for (let i = 0; i < 40; i += 1) {
		reply("https://ca.lan", `/n${i}`, 200, DIRECTORY);
		await readAcmeDirectory(`https://ca.lan/n${i}`);
	}
	assert.equal(cacheSize(), 32);
	reply("https://ca.lan", "/n0", 200, DIRECTORY);
	assert.equal((await readAcmeDirectory("https://ca.lan/n0")).directory, true);
});

it("gives a plain reason for the codes of an unreachable read, never the raw code", () => {
	const cases = [
		["ENOTFOUND", "its name does not resolve"],
		["ECONNREFUSED", "the connection was refused"],
		["ETIMEDOUT", "it did not answer in time"],
		["TimeoutError", "it did not answer in time"],
		["DEPTH_ZERO_SELF_SIGNED_CERT", "its TLS certificate is not trusted"],
		["TOO_LARGE", "its answer is too large"],
		["HTTP 503", "it answered with HTTP 503"],
		["UND_ERR_INVALID_ARG", "the connection failed"],
	];
	for (const [code, reason] of cases) assert.equal(unreachableReason(code), reason);
});
