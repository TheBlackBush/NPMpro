import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const CF = "https://api.cloudflare.com";
const PUBLIC_IP = "81.2.69.160";
const ZONE_LOOKUP = /^\/client\/v4\/zones\?name=/u;
const RECORD_LOOKUP = /^\/client\/v4\/zones\/zone1\/dns_records\?/u;
const json = { headers: { "content-type": "application/json" } };
// every echo answer takes this long, so a cycle is running for a while
const SLOW_MS = 300;

let api;
let admin;
let pauseDdns;
let resumeDdns;

const settle = (promise) =>
	promise.then(
		() => "done",
		() => "failed",
	);
const until = async (check) => {
	for (let i = 0; i < 100; i += 1) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("the condition never came true");
};

before(async () => {
	api = await startApi({ env: { DDNS_IPV4_SERVICES: "https://ip1.test" } });
	({ pauseDdns, resumeDdns } = await import("../internal/ddns.js"));
	admin = await api.admin();
	api.outside.dns.set("ip1.test", "198.51.100.50");
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	api.outside.http
		.get("https://ip1.test")
		.intercept({ path: "/", method: "GET" })
		.reply(() => ({ statusCode: 200, data: `${PUBLIC_IP}\n` }))
		.delay(SLOW_MS)
		.persist();
	const pool = api.outside.http.get(CF);
	pool.intercept({ path: ZONE_LOOKUP, method: "GET" })
		.reply(() => ({ statusCode: 200, data: { success: true, result: [{ id: "zone1" }] }, responseOptions: json }))
		.persist();
	pool.intercept({ path: RECORD_LOOKUP, method: "GET" })
		.reply(() => ({
			statusCode: 200,
			data: { success: true, result: [{ id: "rec1", content: PUBLIC_IP, ttl: 1, proxied: false }] },
			responseOptions: json,
		}))
		.persist();
	const made = await admin.post("/nginx/dns-credentials", {
		name: "Pause credential",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "cf-token-pause-1234567890" }],
	});
	await admin.post("/nginx/dns-domains", { dns_credential_id: made.body.id, names: ["example.com"] });
	const record = await admin.post("/nginx/ddns-records", {
		name: "home.example.com",
		dns_credential_id: made.body.id,
	});
	if (record.status !== 201) throw new Error(`record create answered ${record.status}: ${record.text}`);
});
after(() => api?.stop());

it("a pause waits for the running cycle, then Check now and Update now answer 409 until the resume", async () => {
	const check = settle(admin.post("/nginx/ddns/check"));
	await until(async () => (await admin.get("/nginx/ddns/status")).body.running);
	let checkEnded = false;
	void check.then(() => {
		checkEnded = true;
	});
	await pauseDdns({ timeoutMs: 5000 });
	assert.equal(checkEnded, true);
	const status = await admin.get("/nginx/ddns/status");
	assert.equal(status.body.paused, true);
	const blocked = await admin.post("/nginx/ddns/check");
	assert.equal(blocked.status, 409);
	assert.equal(blocked.body.error.message_i18n, "error.ddns-paused");
	const id = (await admin.get("/nginx/ddns-records")).body[0].id;
	const refused = await admin.post(`/nginx/ddns-records/${id}/update`);
	assert.equal(refused.status, 409);
	assert.equal(refused.body.error.message_i18n, "error.ddns-paused");
	resumeDdns();
	assert.equal((await admin.get("/nginx/ddns/status")).body.paused, false);
	assert.equal((await admin.post("/nginx/ddns/check")).status, 200);
});

it("a pause with a time limit fails with writer-running when the cycle takes longer, and is not left paused", async () => {
	const check = settle(admin.post("/nginx/ddns/check"));
	await until(async () => (await admin.get("/nginx/ddns/status")).body.running);
	await assert.rejects(pauseDdns({ timeoutMs: 50 }), (error) => error.code === "writer-running");
	assert.equal((await admin.get("/nginx/ddns/status")).body.paused, false);
	await check;
	assert.equal((await admin.post("/nginx/ddns/check")).status, 200);
});
