import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// /settings/runtime/ddns: the Dynamic DNS settings, saved without files or a reload

const BASE = "/settings/runtime/ddns";
const DEFAULT_SERVICES = ["https://api.ipify.org", "https://ipv4.icanhazip.com", "https://v4.ident.me"];
const BLOCKED_LITERAL = /ipv4_services: 127\.0\.0\.1 is an address the server may not call/u;
const BLOCKED_NAME = /ipv4_services: lan\.test resolves to an address/u;
const NOT_HTTPS = /ipv4_services\/0 must match pattern/u;
const TIME_RANGE = /period: must be a time from 1m to 24h/u;
const IP_TEST_BLOCKED = /ip\.test resolves to an address/u;
const BLOCKED_NAME6 = /ipv6_services: lan6\.test resolves to an address/u;
const KEYS = ["period", "cooldown", "ipv4_services", "ipv6_services", "resolver"];

let api;
let admin;

// the helpers throw instead of asserting, so the tests hold every assertion
const get = async () => {
	const done = await admin.get(BASE);
	if (done.status !== 200) throw new Error(`GET answered ${done.status}: ${done.text}`);
	return done.body;
};
const saved = async (body) => {
	const done = await admin.put(BASE, body);
	if (done.status !== 200) throw new Error(`PUT ${JSON.stringify(body)} answered ${done.status}: ${done.text}`);
	return done.body;
};
// the error of a save the server answers with 400
const refused = async (body) => {
	const done = await admin.put(BASE, body);
	if (done.status !== 400) throw new Error(`PUT ${JSON.stringify(body)} answered ${done.status}: ${done.text}`);
	return done.body.error;
};
const storedMeta = async () => {
	const row = await api.db("setting").where({ id: "ddns" }).first();
	if (!row) return null;
	return typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
};

before(async () => {
	// DDNS_RESOLVER is the user's: that key is locked
	api = await startApi({
		env: {
			NPMPRO_USER_ENV: "DDNS_RESOLVER",
			DDNS_RESOLVER: "9.9.9.9",
		},
	});
	admin = await api.admin();
	api.outside.dns.set("lan.test", "127.0.0.1");
	api.outside.dns.set("ip.test", "198.51.100.50");
});
after(() => api?.stop());

it("shows the defaults, what applies when and the lock of an env value", async () => {
	const view = await get();
	assert.equal(view.period, "5m");
	assert.equal(view.cooldown, "5m");
	assert.deepEqual(view.ipv4_services, DEFAULT_SERVICES);
	assert.equal(view.ipv6_services.length, 3);
	assert.deepEqual(view.resolver, ["9.9.9.9"]);
	assert.deepEqual(view.locked, ["resolver"]);
	assert.deepEqual(view.locked_by, { resolver: "DDNS_RESOLVER" });
	assert.deepEqual(view.restart_pending, []);
	for (const key of KEYS) assert.equal(view.applies[key], "immediately", key);
});

it("saves the values, audits the save and stores only the changed keys", async () => {
	const view = await saved({ period: "10m", cooldown: "1h", ipv4_services: ["https://one.example/ip"] });
	assert.equal(view.period, "10m");
	assert.equal(view.cooldown, "1h");
	assert.deepEqual(view.ipv4_services, ["https://one.example/ip"]);
	assert.deepEqual(await storedMeta(), { period: "10m", cooldown: "1h", ipv4_services: ["https://one.example/ip"] });
	assert.equal((await get()).period, "10m");
	const audit = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "desc").first();
	assert.equal(audit.action, "updated");
});

it("ignores the key an env var sets", async () => {
	const view = await saved({ resolver: ["1.1.1.1"], cooldown: "30m" });
	assert.deepEqual(view.resolver, ["9.9.9.9"]);
	assert.equal(view.cooldown, "30m");
	assert.equal("resolver" in (await storedMeta()), false);
});

it("refuses a time outside 1m to 24h, a non-https URL and a bad resolver with 400", async () => {
	assert.match((await refused({ period: "30s" })).message, TIME_RANGE);
	assert.match((await refused({ period: "25h" })).message, TIME_RANGE);
	await refused({ period: "5 m" });
	assert.match((await refused({ ipv4_services: ["http://a.example"] })).message, NOT_HTTPS);
	await refused({ ipv4_services: [] });
	await refused({ ipv4_services: Array.from({ length: 11 }, (_, index) => `https://h${index}.example`) });
	await refused({ ipv6_services: ["nope"] });
	await refused({ unknown: true });
	await refused({});
	assert.equal((await get()).period, "10m");
});

it("refuses a service URL with a blocked address, and a name that resolves to one", async () => {
	assert.match((await refused({ ipv4_services: ["https://127.0.0.1/"] })).message, BLOCKED_LITERAL);
	const error = await refused({ ipv4_services: ["https://ip.test/", "https://lan.test/"] });
	assert.match(error.message, BLOCKED_NAME);
	assert.equal(error.message_i18n, "error.ddns-service-blocked");
	assert.deepEqual(error.message_values, { key: "ipv4_services", url: "https://lan.test/" });
	assert.deepEqual((await get()).ipv4_services, ["https://one.example/ip"]);
	assert.deepEqual((await storedMeta()).ipv4_services, ["https://one.example/ip"]);
	const view = await saved({ ipv4_services: ["https://ip.test/", "https://203.0.113.9/ip"] });
	assert.deepEqual(view.ipv4_services, ["https://ip.test/", "https://203.0.113.9/ip"]);
});

it("keeps a stored list when a save keeps it, even when its name now resolves to a blocked address", async () => {
	api.outside.dns.set("ip.test", "127.0.0.1");
	const view = await saved({ ipv4_services: ["https://ip.test/", "https://203.0.113.9/ip"], cooldown: "20m" });
	assert.equal(view.cooldown, "20m");
	assert.deepEqual(view.ipv4_services, ["https://ip.test/", "https://203.0.113.9/ip"]);
	assert.match((await refused({ ipv4_services: ["https://ip.test/"] })).message, IP_TEST_BLOCKED);
	api.outside.dns.set("ip.test", "198.51.100.50");
});

it("needs an administrator", async () => {
	const user = await api.limited({ visibility: "all" });
	assert.equal((await user.get(BASE)).status, 403);
	assert.equal((await user.put(BASE, { period: "7m" })).status, 403);
	assert.equal((await get()).period, "10m");
});

it("refuses a name that resolves to a blocked address on ipv6_services too", async () => {
	api.outside.dns.set("lan6.test", "127.0.0.1");
	const error = await refused({ ipv6_services: ["https://lan6.test/"] });
	assert.match(error.message, BLOCKED_NAME6);
	assert.equal(error.message_i18n, "error.ddns-service-blocked");
	assert.deepEqual(error.message_values, { key: "ipv6_services", url: "https://lan6.test/" });
	assert.equal((await get()).ipv6_services.length, 3);
});
