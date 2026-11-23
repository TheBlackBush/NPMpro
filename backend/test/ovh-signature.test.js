import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { after, it } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";

process.env.NPMPRO_TEST_ROOT = "/nonexistent-ovh-signature-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");
const { DdnsProviderError } = await import("../lib/ddns/errors.js");
const { ovhEndpoint, ovhRequest, ovhSignature } = await import("../lib/ddns/providers/ovh.js");
const { providerById, listsDomains } = await import("../lib/ddns/providers/index.js");
const { secretValuesOf } = await import("../lib/dns-credential-values.js");

const realLookup = dns.lookup;
dns.lookup = (_hostname, options, callback) => {
	const done = typeof options === "function" ? options : callback;
	const all = [{ address: "93.184.216.34", family: 4 }];
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

const ZONE_RIGHT = /GET \/domain\/zone/u;
const json = { headers: { "content-type": "application/json" } };
const SECRET = "app-secret-1234";
const CONSUMER = "consumer-key-5678";
const fields = {
	dns_ovh_endpoint: "ovh-eu",
	dns_ovh_application_key: "app-key",
	dns_ovh_application_secret: SECRET,
	dns_ovh_consumer_key: CONSUMER,
};
const secrets = [SECRET, CONSUMER];
const fetch = (url, options) => providerFetch(url, { ...options, secrets });
const host = mock.get("https://eu.api.ovh.com");

it("the signature is $1$ + sha1 of the documented join", () => {
	const input = {
		secret: "S",
		consumer: "C",
		method: "GET",
		url: "https://eu.api.ovh.com/1.0/domain/zone",
		body: "",
		timestamp: 1700000000,
	};
	// sha1sum of the documented join, computed with the shell
	const joined = "S+C+GET+https://eu.api.ovh.com/1.0/domain/zone++1700000000";
	assert.equal(ovhSignature(input), `$1$${createHash("sha1").update(joined).digest("hex")}`);
	assert.equal(ovhSignature(input), ["$1$", "80ee543c", "1dcf62d7", "24d86c3c", "6a717229", "3a92fd11"].join(""));
});

it("the seven endpoints map and anything else is null", () => {
	assert.equal(ovhEndpoint("ovh-eu"), "https://eu.api.ovh.com/1.0");
	assert.equal(ovhEndpoint("ovh-ca"), "https://ca.api.ovh.com/1.0");
	assert.equal(ovhEndpoint("ovh-us"), "https://api.us.ovhcloud.com/1.0");
	assert.equal(ovhEndpoint("kimsufi-eu"), "https://eu.api.kimsufi.com/1.0");
	assert.equal(ovhEndpoint("kimsufi-ca"), "https://ca.api.kimsufi.com/1.0");
	assert.equal(ovhEndpoint("soyoustart-eu"), "https://eu.api.soyoustart.com/1.0");
	assert.equal(ovhEndpoint("soyoustart-ca"), "https://ca.api.soyoustart.com/1.0");
	assert.equal(ovhEndpoint("nope"), null);
	assert.equal(ovhEndpoint("constructor"), null);
	assert.equal(ovhEndpoint(undefined), null);
});

it("the request signs with the server time and carries the four headers", async () => {
	host.intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "1700000123", json);
	const expected = ovhSignature({
		secret: SECRET,
		consumer: CONSUMER,
		method: "GET",
		url: "https://eu.api.ovh.com/1.0/domain/zone",
		body: "",
		timestamp: 1700000123,
	});
	host.intercept({
		path: "/1.0/domain/zone",
		method: "GET",
		headers: {
			"x-ovh-application": "app-key",
			"x-ovh-consumer": CONSUMER,
			"x-ovh-timestamp": "1700000123",
			"x-ovh-signature": expected,
			"content-type": "application/json",
		},
	}).reply(200, ["b.example.org", "a.example.org"], json);
	assert.deepEqual(await providerById("ovh").listZones({ fields, fetch }), ["a.example.org", "b.example.org"]);
	mock.assertNoPendingInterceptors();
});

it("a body is part of the signature", async () => {
	host.intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "42", json);
	const body = { a: 1 };
	const sig = ovhSignature({
		secret: SECRET,
		consumer: CONSUMER,
		method: "POST",
		url: "https://eu.api.ovh.com/1.0/x",
		body: JSON.stringify(body),
		timestamp: 42,
	});
	host.intercept({ path: "/1.0/x", method: "POST", headers: { "x-ovh-signature": sig } }).reply(200, {}, json);
	const res = await ovhRequest({ fields, fetch, method: "POST", path: "/x", body });
	assert.equal(res.status, 200);
});

it("/auth/time is asked once per call", async () => {
	host.intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "7", json);
	host.intercept({ path: "/1.0/domain/zone", method: "GET" }).reply(200, [], json);
	assert.deepEqual(await providerById("ovh").listZones({ fields, fetch }), []);
	mock.assertNoPendingInterceptors();
});

it("a 403 is forbidden with a hint and no secret in the message", async () => {
	host.intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "7", json);
	host.intercept({ path: "/1.0/domain/zone", method: "GET" }).reply(
		403,
		{ message: `denied ${SECRET} ${CONSUMER}` },
		json,
	);
	await assert.rejects(providerById("ovh").listZones({ fields, fetch }), (err) => {
		assert.ok(err instanceof DdnsProviderError);
		assert.equal(err.code, "forbidden");
		assert.match(err.hint, ZONE_RIGHT);
		assert.ok(!err.message.includes(SECRET) && !err.message.includes(CONSUMER));
		assert.ok(err.message.includes("***"));
		return true;
	});
});

it("a failing /auth/time is failed", async () => {
	host.intercept({ path: "/1.0/auth/time", method: "GET" }).reply(500, "oops");
	await assert.rejects(providerById("ovh").listZones({ fields, fetch }), (err) => err.code === "failed");
});

it("a 500 and a body of the wrong shape are failed", async () => {
	host.intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "7", json);
	host.intercept({ path: "/1.0/domain/zone", method: "GET" }).reply(500, "boom");
	await assert.rejects(providerById("ovh").listZones({ fields, fetch }), (err) => err.code === "failed");
	host.intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "7", json);
	host.intercept({ path: "/1.0/domain/zone", method: "GET" }).reply(200, { nope: 1 }, json);
	await assert.rejects(providerById("ovh").listZones({ fields, fetch }), (err) => err.code === "failed");
});

it("an unknown endpoint fails without a request", async () => {
	await assert.rejects(
		providerById("ovh").listZones({ fields: { ...fields, dns_ovh_endpoint: "mars" }, fetch }),
		(err) => err.code === "failed" && err.message === "Unknown OVH endpoint",
	);
});

it("OVH is registered and its secrets are marked", () => {
	assert.equal(listsDomains("ovh"), true);
	assert.deepEqual(new Set(secretValuesOf("ovh", fields)), new Set([CONSUMER, SECRET]));
});
