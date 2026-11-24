import assert from "node:assert/strict";
import { after, afterEach, before, it } from "node:test";
import { startApi } from "./support/api.js";

const CF = "https://api.cloudflare.com";
const TOKEN = "cf-token-host-check-SECRET-1234567890";
const PUBLIC_IP = "81.2.69.160";
const OTHER_IP = "81.2.69.100";
const CHECK = "/nginx/dns-check/hosts";
const ZONE_LOOKUP = /^\/client\/v4\/zones\?name=/u;
// a name starting with slow- gets its own, delayed interceptor in the test that needs it
const RECORD_LOOKUP = /^\/client\/v4\/zones\/zone1\/dns_records\?(?!.*name\.exact=slow-)/u;
const SLOW_LOOKUP = /^\/client\/v4\/zones\/zone1\/dns_records\?.*name\.exact=slow-/u;
const json = { headers: { "content-type": "application/json" } };
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];

let api;
let admin;
let hosts = 0;
let credentials = 0;
// what the fake Cloudflare answers: record name -> { content, proxied }; failWith makes every record read a 403
const cloudflare = { records: {}, reads: [], failWith: null };

const dns = (name, values, type = "A") => api.outside.names.set(name, type, values);
const check = (session, list) => session.post(CHECK, { hosts: list });
const checkOne = async (session, type, id) => {
	const res = await check(session, [{ type, id }]);
	if (res.status !== 200) throw new Error(`check answered ${res.status}: ${res.text}`);
	return res.body[0];
};
const proxyHost = async (domainNames, session = admin) => {
	hosts += 1;
	const done = await session.post("/nginx/proxy-hosts", {
		domain_names: domainNames,
		forward_scheme: "http",
		forward_host: `10.0.7.${hosts}`,
		forward_port: 8080,
	});
	if (done.status !== 201) throw new Error(`host create answered ${done.status}: ${done.text}`);
	return done.body;
};
const withCredential = async (domain, session = admin) => {
	credentials += 1;
	const made = await session.post("/nginx/dns-credentials", {
		name: `Check credential ${credentials}`,
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
	});
	if (made.status !== 201) throw new Error(`credential create answered ${made.status}: ${made.text}`);
	const added = await session.post("/nginx/dns-domains", { dns_credential_id: made.body.id, names: [domain] });
	if (added.status !== 201) throw new Error(`domain create answered ${added.status}: ${added.text}`);
	return made.body;
};
const mockCloudflare = () => {
	const pool = api.outside.http.get(CF);
	pool.intercept({ path: ZONE_LOOKUP, method: "GET" })
		.reply(200, { success: true, result: [{ id: "zone1" }] }, json)
		.persist();
	pool.intercept({ path: RECORD_LOOKUP, method: "GET" })
		.reply((options) => {
			const query = new URL(options.path, CF).searchParams;
			const name = decodeURIComponent(query.get("name.exact"));
			const type = query.get("type");
			if (type === "A") cloudflare.reads.push(name);
			if (cloudflare.failWith) {
				return { statusCode: 403, data: cloudflare.failWith, responseOptions: json };
			}
			const found = cloudflare.records[name];
			const record = found && (found.type ?? "A") === type ? found : null;
			const result = record
				? [{ id: `rec-${name}`, content: record.content, ttl: 1, proxied: record.proxied }]
				: [];
			return { statusCode: 200, data: { success: true, result }, responseOptions: json };
		})
		.persist();
};

before(async () => {
	api = await startApi({ env: { DDNS_IPV4_SERVICES: "https://ip1.test https://ip2.test" } });
	admin = await api.admin();
	for (const [index, name] of ["ip1.test", "ip2.test"].entries()) {
		api.outside.dns.set(name, `198.51.100.${50 + index}`);
		api.outside.http
			.get(`https://${name}`)
			.intercept({ path: "/", method: "GET" })
			.reply(200, `${PUBLIC_IP}\n`)
			.persist();
	}
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	mockCloudflare();
});
afterEach(async () => {
	cloudflare.records = {};
	cloudflare.reads.length = 0;
	cloudflare.failWith = null;
	await api.outside.names.clear();
	await api.db("npmpro_dns_domain").del();
	await api.db("npmpro_dns_credential").del();
});
after(() => api?.stop());

it("answers here by DNS, caches it for 30 s and lists it", async () => {
	const host = await proxyHost(["app.cache.example"]);
	await dns("app.cache.example", [PUBLIC_IP]);
	const first = await checkOne(admin, "proxy", host.id);
	assert.equal(first.type, "proxy");
	assert.equal(first.names[0].state, "here");
	assert.equal(first.names[0].via, "dns");
	assert.equal(first.names[0].ipv4.public, PUBLIC_IP);
	// the DNS changed, the answer within 30 s is the cached one
	await dns("app.cache.example", [OTHER_IP]);
	const second = await checkOne(admin, "proxy", host.id);
	assert.equal(second.checked_on, first.checked_on);
	assert.equal(second.names[0].state, "here");
	const listed = await admin.get(CHECK);
	assert.equal(listed.status, 200, listed.text);
	assert.deepEqual(
		listed.body.find((entry) => entry.id === host.id),
		first,
	);
});

it("clears a host's cache when the host changes, is disabled, enabled or deleted", async () => {
	const host = await proxyHost(["app.clear.example"]);
	await dns("app.clear.example", [PUBLIC_IP]);
	assert.equal((await checkOne(admin, "proxy", host.id)).names[0].state, "here");
	await dns("app.clear.example", [OTHER_IP]);
	const changed = await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 8081 });
	assert.equal(changed.status, 200, changed.text);
	assert.equal((await checkOne(admin, "proxy", host.id)).names[0].state, "elsewhere");
	await dns("app.clear.example", [PUBLIC_IP]);
	assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/disable`)).status, 200);
	assert.equal((await checkOne(admin, "proxy", host.id)).names[0].state, "here");
	await dns("app.clear.example", [OTHER_IP]);
	assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/enable`)).status, 200);
	assert.equal((await checkOne(admin, "proxy", host.id)).names[0].state, "elsewhere");
	assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
	const listed = await admin.get(CHECK);
	assert.ok(!listed.body.some((entry) => entry.id === host.id));
});

it("reads the provider's record for a manager: a proxied Cloudflare record is here, proxied", async () => {
	await withCredential("prov.example");
	const host = await proxyHost(["app.prov.example"]);
	await dns("app.prov.example", ["104.16.0.1"]);
	cloudflare.records["app.prov.example"] = { content: PUBLIC_IP, proxied: true };
	const entry = (await checkOne(admin, "proxy", host.id)).names[0];
	assert.equal(entry.state, "here");
	assert.equal(entry.via, "record");
	assert.equal(entry.proxied, true);
	assert.deepEqual(entry.ipv4.found, ["104.16.0.1"]);
	assert.deepEqual(cloudflare.reads, ["app.prov.example"]);
});

it("reads a Cloudflare record always, and the wildcard of the direct parent when there is no record", async () => {
	await withCredential("wild.example");
	const host = await proxyHost(["app.wild.example", "deep.app.wild.example"]);
	await dns("app.wild.example", [PUBLIC_IP]);
	await dns("deep.app.wild.example", [PUBLIC_IP]);
	cloudflare.records["*.wild.example"] = { content: PUBLIC_IP, proxied: false };
	const names = (await checkOne(admin, "proxy", host.id)).names;
	assert.equal(names[0].via, "wildcard");
	// the wildcard of the direct parent (*.app.wild.example) is not there: the DNS answer stands
	assert.equal(names[1].via, "dns");
	assert.deepEqual(
		cloudflare.reads.sort((a, b) => a.localeCompare(b)),
		["*.app.wild.example", "*.wild.example", "app.wild.example", "deep.app.wild.example"],
	);
});

it("gives a view-only user the DNS-only state and no provider read, and 404 for a host type without view", async () => {
	await withCredential("view.example");
	const host = await proxyHost(["app.view.example"]);
	const redirect = await admin.post("/nginx/redirection-hosts", {
		domain_names: ["go.view.example"],
		forward_scheme: "http",
		forward_domain_name: "t.example.org",
		forward_http_code: 301,
	});
	assert.equal(redirect.status, 201, redirect.text);
	await dns("app.view.example", ["104.16.0.1"]);
	cloudflare.records["app.view.example"] = { content: PUBLIC_IP, proxied: true };
	const manager = await checkOne(admin, "proxy", host.id);
	assert.equal(manager.names[0].via, "record");
	cloudflare.reads.length = 0;

	const viewer = await api.limited({
		visibility: "all",
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	const seen = await checkOne(viewer, "proxy", host.id);
	assert.equal(seen.names[0].state, "elsewhere");
	assert.equal(seen.names[0].via, null);
	assert.deepEqual(cloudflare.reads, []);
	assert.ok(!JSON.stringify(seen).includes("Check credential"));
	// the manager's cached result is not the viewer's
	const listed = await viewer.get(CHECK);
	assert.deepEqual(
		listed.body.map((entry) => entry.names[0].state),
		["elsewhere"],
	);

	const denied = await check(viewer, [{ type: "redirection", id: redirect.body.id }]);
	assert.equal(denied.status, 404, denied.text);
	const mixed = await check(viewer, [
		{ type: "proxy", id: host.id },
		{ type: "redirection", id: redirect.body.id },
	]);
	assert.equal(mixed.status, 404, mixed.text);
});

it("never uses another owner's credential for a user who sees only their own", async () => {
	await withCredential("own.example");
	const user = await api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "manage",
	});
	const host = await proxyHost(["app.own.example"], user);
	await dns("app.own.example", ["104.16.0.1"]);
	cloudflare.records["app.own.example"] = { content: PUBLIC_IP, proxied: true };
	const entry = (await checkOne(user, "proxy", host.id)).names[0];
	assert.equal(entry.state, "elsewhere");
	assert.deepEqual(cloudflare.reads, []);
	// a user who sees only their own hosts gets 404 for another user's host
	const adminHost = await proxyHost(["other.own.example"]);
	assert.equal((await check(user, [{ type: "proxy", id: adminHost.id }])).status, 404);
	const mine = await user.get(CHECK);
	assert.deepEqual(
		mine.body.map((item) => item.id),
		[host.id],
	);
});

it("scrubs a provider message in the answer and in the cache", async () => {
	await withCredential("scrub.example");
	const host = await proxyHost(["app.scrub.example"]);
	await dns("app.scrub.example", ["104.16.0.1"]);
	cloudflare.failWith = { success: false, errors: [{ code: 9109, message: `Invalid token ${TOKEN}` }] };
	const res = await check(admin, [{ type: "proxy", id: host.id }]);
	assert.equal(res.status, 200, res.text);
	const entry = res.body[0].names[0];
	assert.equal(entry.state, "unknown");
	assert.equal(entry.reason, "provider-read-failed");
	assert.ok(entry.message.includes("***"));
	assert.ok(!res.text.includes(TOKEN), "the answer holds the token");
	const cached = await admin.get(CHECK);
	assert.ok(!cached.text.includes(TOKEN), "the cache holds the token");
});

it("skips wildcard names, and reports a failed lookup as unknown", async () => {
	const host = await proxyHost(["*.skip.example", "slow.skip.example"]);
	await dns("slow.skip.example", { code: "timeout" });
	const names = (await checkOne(admin, "proxy", host.id)).names;
	assert.equal(names[0].state, "skipped");
	assert.equal(names[1].state, "unknown");
	assert.equal(names[1].reason, "lookup-timeout");
});

it("refuses no hosts, more than 50, a bad body and a missing host", async () => {
	assert.equal((await check(admin, [])).status, 400);
	const many = Array.from({ length: 51 }, (_, index) => ({ type: "proxy", id: index + 1 }));
	assert.equal((await check(admin, many)).status, 400);
	assert.equal((await check(admin, [{ type: "stream", id: 1 }])).status, 400);
	assert.equal((await admin.post(CHECK, {})).status, 400);
	assert.equal((await check(admin, [{ type: "proxy", id: 999999 }])).status, 404);
});

it("answers a user with no host permission 404 and an empty list", async () => {
	const none = await api.limited(Object.fromEntries(SECTIONS.map((section) => [section, "hidden"])));
	const host = await proxyHost(["app.none.example"]);
	assert.equal((await check(none, [{ type: "proxy", id: host.id }])).status, 404);
	const listed = await none.get(CHECK);
	assert.equal(listed.status, 200, listed.text);
	assert.deepEqual(listed.body, []);
});

it("is here by a proxied Cloudflare CNAME whose target is here, and elsewhere when it is not", async () => {
	await withCredential("alias.example");
	const host = await proxyHost(["app.alias.example", "off.alias.example"]);
	await dns("app.alias.example", ["104.16.0.1"]);
	await dns("off.alias.example", ["104.16.0.1"]);
	cloudflare.records["app.alias.example"] = { type: "CNAME", content: "home.alias.example", proxied: true };
	cloudflare.records["home.alias.example"] = { content: PUBLIC_IP, proxied: false };
	cloudflare.records["off.alias.example"] = { type: "CNAME", content: "away.example.net", proxied: true };
	await dns("away.example.net", [OTHER_IP]);
	const [here, away] = (await checkOne(admin, "proxy", host.id)).names;
	assert.equal(here.state, "here");
	assert.equal(here.via, "alias");
	assert.equal(here.proxied, true);
	assert.equal(away.state, "elsewhere");
});

it("is here by an alias in DNS: the resolver ends at this instance's address", async () => {
	const host = await proxyHost(["cname.dnsalias.example"]);
	await dns("cname.dnsalias.example", { cname: "home.dnsalias.example" });
	await dns("home.dnsalias.example", [PUBLIC_IP]);
	const entry = (await checkOne(admin, "proxy", host.id)).names[0];
	assert.equal(entry.state, "here");
	assert.equal(entry.via, "dns");
});

it("clears the cache after a restore and after a merge, and keeps a check that began before one out of it", async () => {
	const host = await proxyHost(["app.restore.example"]);
	await dns("app.restore.example", [PUBLIC_IP]);
	const kept = await admin.post("/backups", { types: ["proxy_hosts"], secrets: false, keep: true });
	if (kept.status !== 200) throw new Error(`backup answered ${kept.status}: ${kept.text}`);
	const opened = async () => {
		const done = await admin.post(`/backups/${kept.body.entry.name}/inspect`, {});
		if (done.status !== 200) throw new Error(`inspect answered ${done.status}: ${done.text}`);
		return done.body.token;
	};

	await checkOne(admin, "proxy", host.id);
	assert.ok((await admin.get(CHECK)).body.length > 0);
	const restored = await admin.post(`/backups/restore/${await opened()}`, { types: ["proxy_hosts"], confirm: true });
	assert.equal(restored.status, 200, restored.text);
	assert.deepEqual((await admin.get(CHECK)).body, []);

	await checkOne(admin, "proxy", host.id);
	const token = await opened();
	const plan = await admin.post(`/backups/restore/${token}/plan`, { mode: "merge", types: ["proxy_hosts"] });
	assert.equal(plan.status, 200, plan.text);
	const merged = await admin.post(`/backups/restore/${token}`, {
		mode: "merge",
		types: ["proxy_hosts"],
		plan_hash: plan.body.hash,
	});
	assert.equal(merged.status, 200, merged.text);
	assert.deepEqual((await admin.get(CHECK)).body, []);
});

it("does not cache a result of a check that began before the host changed", async () => {
	await withCredential("gen.example");
	const host = await proxyHost(["slow-app.gen.example"]);
	await dns("slow-app.gen.example", ["104.16.0.1"]);
	cloudflare.records["slow-app.gen.example"] = { content: PUBLIC_IP, proxied: true };
	api.outside.http
		.get(CF)
		.intercept({ path: SLOW_LOOKUP, method: "GET" })
		.reply(200, { success: true, result: [] }, json)
		.delay(400)
		.persist();
	const running = check(admin, [{ type: "proxy", id: host.id }]);
	await new Promise((resolve) => setTimeout(resolve, 150));
	const changed = await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 8082 });
	assert.equal(changed.status, 200, changed.text);
	const done = await running;
	assert.equal(done.status, 200, done.text);
	assert.ok(!(await admin.get(CHECK)).body.some((entry) => entry.id === host.id));
});
