import assert from "node:assert/strict";
import { after, afterEach, before, it } from "node:test";
import { startApi } from "./support/api.js";

// The bounds of the host check: the confirmed public address and its shared detection, the request deadline, the
// try timer of a lookup, the cap of names per request and the generation taken before the rows are read.

const PUBLIC_IP = "81.2.69.160";
const OTHER_IP = "81.2.69.100";
const NEW_IP = "81.2.69.120";
const CHECK = "/nginx/dns-check/hosts";
const CF = "https://api.cloudflare.com";
const CF_API = /^\/client\/v4\//u;
const json = { headers: { "content-type": "application/json" } };

let api;
let admin;
let timing;
let saved;
let hosts = 0;
// what each public IP service answers, and how often it was asked
const echo = { "ip1.test": PUBLIC_IP, "ip2.test": PUBLIC_IP };
const asked = { "ip1.test": 0, "ip2.test": 0 };

const dns = (name, values, type = "A") => api.outside.names.set(name, type, values);
const proxyHost = async (domainNames) => {
	hosts += 1;
	const done = await admin.post("/nginx/proxy-hosts", {
		domain_names: domainNames,
		forward_scheme: "http",
		forward_host: `10.0.8.${hosts}`,
		forward_port: 8080,
	});
	if (done.status !== 201) throw new Error(`host create answered ${done.status}: ${done.text}`);
	return done.body;
};
const check = (list) => admin.post(CHECK, { hosts: list });
const cached = async (id) => (await admin.get(CHECK)).body.some((entry) => entry.id === id);

before(async () => {
	api = await startApi({ env: { DDNS_IPV4_SERVICES: "https://ip1.test https://ip2.test" } });
	admin = await api.admin();
	for (const [index, name] of ["ip1.test", "ip2.test"].entries()) {
		api.outside.dns.set(name, `198.51.100.${60 + index}`);
		api.outside.http
			.get(`https://${name}`)
			.intercept({ path: "/", method: "GET" })
			.reply(() => {
				asked[name] += 1;
				return { statusCode: 200, data: `${echo[name]}\n` };
			})
			.persist();
	}
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	api.outside.http
		.get(CF)
		.intercept({ path: CF_API, method: "GET" })
		.reply(200, { success: true, result: [] }, json)
		.persist();
	timing = (await import("../lib/dns-check/timing.js")).checkTiming;
	saved = { ...timing };
});
afterEach(async () => {
	Object.assign(timing, saved);
	await api.outside.names.clear();
});
after(() => api?.stop());

it("uses only a confirmed public address, and parallel calls share one detection", async () => {
	const { publicAddressOf } = await import("../internal/ddns.js");
	// the two services disagree: no address
	echo["ip2.test"] = OTHER_IP;
	const answers = await Promise.all([publicAddressOf(4), publicAddressOf(4), publicAddressOf(4)]);
	assert.deepEqual(answers, [null, null, null]);
	assert.equal(asked["ip1.test"] + asked["ip2.test"], 2, "one detection asks two services");
	const host = await proxyHost(["app.confirm.example"]);
	await dns("app.confirm.example", [PUBLIC_IP]);
	const res = await check([{ type: "proxy", id: host.id }]);
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body[0].names[0].state, "unknown");
	assert.equal(res.body[0].names[0].reason, "public-address-unknown");

	echo["ip2.test"] = PUBLIC_IP;
	assert.equal(await publicAddressOf(4), PUBLIC_IP);

	// a detection of the updater that doubts the known address: the address stays in its state with the error
	const credential = await admin.post("/nginx/dns-credentials", {
		name: "Confirm credential",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "cf-token-confirm-1234567890" }],
	});
	assert.equal(credential.status, 201, credential.text);
	const domain = await admin.post("/nginx/dns-domains", {
		dns_credential_id: credential.body.id,
		names: ["confirm.example"],
	});
	assert.equal(domain.status, 201, domain.text);
	const record = await admin.post("/nginx/ddns-records", {
		name: "home.confirm.example",
		dns_credential_id: credential.body.id,
	});
	assert.equal(record.status, 201, record.text);
	echo["ip1.test"] = NEW_IP;
	echo["ip2.test"] = OTHER_IP;
	const status = await admin.post("/nginx/ddns/check");
	assert.equal(status.status, 200, status.text);
	assert.equal(status.body.ipv4.address, PUBLIC_IP);
	assert.equal(status.body.ipv4.error_i18n, "error.ddns-ip-disagree");
	assert.equal(await publicAddressOf(4), null);

	echo["ip1.test"] = PUBLIC_IP;
	echo["ip2.test"] = PUBLIC_IP;
	assert.equal(await publicAddressOf(4), PUBLIC_IP);
	const removed = await admin.delete(`/nginx/ddns-records/${record.body.id}`);
	assert.equal(removed.status, 200, removed.text);
});

it("answers within the request deadline: an unfinished name is unknown (timeout) and its host is not cached", async () => {
	Object.assign(timing, { requestMs: 300, tryMs: 5000 });
	const slow = await proxyHost(["fast.deadline.example", "slow.deadline.example"]);
	const quick = await proxyHost(["other.deadline.example"]);
	await dns("fast.deadline.example", [PUBLIC_IP]);
	await dns("slow.deadline.example", { delay: 3000, answer: [PUBLIC_IP] });
	await dns("other.deadline.example", [PUBLIC_IP]);
	const started = Date.now();
	const res = await check([
		{ type: "proxy", id: slow.id },
		{ type: "proxy", id: quick.id },
	]);
	const took = Date.now() - started;
	assert.equal(res.status, 200, res.text);
	assert.ok(took < 2000, `the check took ${took} ms`);
	const [fast, late] = res.body[0].names;
	assert.equal(fast.state, "here");
	assert.equal(late.state, "unknown");
	assert.equal(late.reason, "timeout");
	assert.equal(res.body[1].names[0].state, "here");
	assert.equal(await cached(slow.id), false);
	assert.equal(await cached(quick.id), true);
});

it("ends a lookup that does not answer after two tries of its timer", async () => {
	Object.assign(timing, { tryMs: 100 });
	const host = await proxyHost(["hang.try.example"]);
	await dns("hang.try.example", { delay: 3000, answer: [PUBLIC_IP] });
	const started = Date.now();
	const res = await check([{ type: "proxy", id: host.id }]);
	const took = Date.now() - started;
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body[0].names[0].reason, "lookup-timeout");
	assert.ok(took < 1500, `the check took ${took} ms`);
});

it("refuses more than 200 names across the hosts of one request", async () => {
	const many = (prefix) => Array.from({ length: 100 }, (_, index) => `n${index}.${prefix}.cap.example`);
	const first = await proxyHost(many("a"));
	const second = await proxyHost(many("b"));
	const third = await proxyHost(["one.cap.example"]);
	const refused = await check([
		{ type: "proxy", id: first.id },
		{ type: "proxy", id: second.id },
		{ type: "proxy", id: third.id },
	]);
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.dns-check-too-many-names");
	const done = await check([
		{ type: "proxy", id: first.id },
		{ type: "proxy", id: second.id },
	]);
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body[0].names.length + done.body[1].names.length, 200);
});

it("takes the cache generation before it reads the hosts: a change during the row query keeps it uncached", async () => {
	const host = await proxyHost(["gen.rows.example"]);
	await dns("gen.rows.example", [PUBLIC_IP]);
	const { default: proxyHostModel } = await import("../models/proxy_host.js");
	const { hostCheckCache } = await import("../lib/dns-check/host-cache.js");
	const query = proxyHostModel.query;
	proxyHostModel.query = function changedDuringRead(...args) {
		// the host is saved while its row is read
		hostCheckCache.clearHost("proxy", host.id);
		return query.apply(this, args);
	};
	try {
		const res = await check([{ type: "proxy", id: host.id }]);
		assert.equal(res.status, 200, res.text);
	} finally {
		proxyHostModel.query = query;
	}
	assert.equal(await cached(host.id), false);
	const again = await check([{ type: "proxy", id: host.id }]);
	assert.equal(again.status, 200, again.text);
	assert.equal(await cached(host.id), true);
});
