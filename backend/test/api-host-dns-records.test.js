import assert from "node:assert/strict";
import { after, afterEach, before, it } from "node:test";
import { startApi } from "./support/api.js";

// The host record option through the API: a host's ticked names get their record at the provider (Cloudflare through
// the MockAgent, a stateful fake with every call counted), the host always saves and answers at once, and a host
// without the option never reaches the provider.

const CF = "https://api.cloudflare.com";
const TOKEN = "cf-token-host-records-SECRET-1234567890";
const PUBLIC_IP = "81.2.69.160";
const ZONE_ID = "0000000000000000000000000000a1d1";
const ZONE_PATH = `/client/v4/zones/${ZONE_ID}/dns_records`;
const SKIP = "(?:slow|read500)-";
const READ = new RegExp(`^${ZONE_PATH}\\?(?!.*name\\.exact=${SKIP})`, "u");
const SLOW_READ = new RegExp(`^${ZONE_PATH}\\?.*name\\.exact=slow-`, "u");
const FAILING_READ = new RegExp(`^${ZONE_PATH}\\?.*name\\.exact=read500-`, "u");
const json = { headers: { "content-type": "application/json" } };

let api;
let admin;
let idle;
let hosts = 0;
let credentials = 0;
let nextId = 0;
let ipHits = 0;
// the fake Cloudflare: records by "name|type", and every call after the zone lookup
const cf = { records: new Map(), calls: [], zoneLookups: 0, failDeletes: true };

const callsOf = (method, name) =>
	cf.calls.filter((call) => call.method === method && (name === undefined || call.name === name));
const setRecord = (name, type, content) => {
	nextId += 1;
	const id = nextId.toString(16).padStart(32, "0");
	cf.records.set(`${name}|${type}`, { id, type, name, content, ttl: 120, proxied: false });
	return id;
};
const answer = (result) => ({ statusCode: 200, data: { success: true, result }, responseOptions: json });
const failure = (statusCode) => ({
	statusCode,
	data: { success: false, errors: [{ code: 7003, message: `HTTP ${statusCode} ${TOKEN}` }] },
	responseOptions: json,
});
const TIMEOUT_CREATE = /"name":"timeout-/u;
const ZONE_LOOKUP = /^\/client\/v4\/zones\?name=/u;
const recordOfId = (id) => [...cf.records.values()].find((found) => found.id === id);

const mockCloudflare = () => {
	const pool = api.outside.http.get(CF);
	pool.intercept({ path: ZONE_LOOKUP, method: "GET" })
		.reply(() => {
			cf.zoneLookups += 1;
			return answer([{ id: ZONE_ID }]);
		})
		.persist();
	const reader = () => (options) => {
		const query = new URL(options.path, CF).searchParams;
		const name = decodeURIComponent(query.get("name.exact"));
		const type = query.get("type");
		cf.calls.push({ method: "GET", name, type });
		const found = cf.records.get(`${name}|${type}`);
		return answer(found ? [found] : []);
	};
	pool.intercept({ path: FAILING_READ, method: "GET" })
		.reply((options) => {
			cf.calls.push({
				method: "GET",
				name: decodeURIComponent(new URL(options.path, CF).searchParams.get("name.exact")),
			});
			return failure(500);
		})
		.persist();
	pool.intercept({ path: SLOW_READ, method: "GET" }).reply(reader()).delay(500).persist();
	pool.intercept({ path: READ, method: "GET" }).reply(reader()).persist();
	// a create for a name starting timeout- never answers in time (the provider call's own error)
	pool.intercept({ path: ZONE_PATH, method: "POST", body: TIMEOUT_CREATE })
		.replyWithError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))
		.persist();
	pool.intercept({ path: ZONE_PATH, method: "POST" })
		.reply((options) => {
			const body = JSON.parse(options.body);
			cf.calls.push({ method: "POST", name: body.name, body });
			if (body.name.startsWith("post500-")) return failure(500);
			if (body.name.startsWith("post429-")) return failure(429);
			const id = setRecord(body.name, body.type, body.content);
			cf.records.get(`${body.name}|${body.type}`).ttl = body.ttl;
			return answer({ id });
		})
		.persist();
	pool.intercept({ path: new RegExp(`^${ZONE_PATH}/[0-9a-f]{32}$`, "u"), method: "PATCH" })
		.reply((options) => {
			const id = options.path.split("/").pop();
			const record = recordOfId(id);
			cf.calls.push({ method: "PATCH", name: record?.name, body: JSON.parse(options.body) });
			if (record) record.content = JSON.parse(options.body).content;
			return answer({ id });
		})
		.persist();
	pool.intercept({ path: new RegExp(`^${ZONE_PATH}/[0-9a-f]{32}$`, "u"), method: "DELETE" })
		.reply((options) => {
			const id = options.path.split("/").pop();
			const record = recordOfId(id);
			cf.calls.push({ method: "DELETE", name: record?.name, id });
			if (cf.failDeletes && record?.name.startsWith("del500-")) return failure(500);
			if (record) cf.records.delete(`${record.name}|${record.type}`);
			return answer({ id });
		})
		.persist();
};

const proxyHost = (names, { session = admin, records, extra = {} } = {}) => {
	hosts += 1;
	return session.post("/nginx/proxy-hosts", {
		domain_names: names,
		forward_scheme: "http",
		forward_host: `10.0.8.${hosts}`,
		forward_port: 8080,
		...(records === undefined ? {} : { npmpro_dns_records: records }),
		...extra,
	});
};
const created = async (names, options) => {
	const done = await proxyHost(names, options);
	if (done.status !== 201) throw new Error(`host create answered ${done.status}: ${done.text}`);
	return done.body;
};
const tick = (name, extra = {}) => ({ name, reach_confirmed: true, ...extra });
const settle = async (type, id) => {
	await idle(type, id);
};
const stateOf = (states, name) => states?.find((one) => one.name === name);
const withCredential = async (domain, session = admin) => {
	credentials += 1;
	const made = await session.post("/nginx/dns-credentials", {
		name: `Host record credential ${credentials}`,
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
	});
	if (made.status !== 201) throw new Error(`credential create answered ${made.status}: ${made.text}`);
	const added = await session.post("/nginx/dns-domains", { dns_credential_id: made.body.id, names: [domain] });
	if (added.status !== 201) throw new Error(`domain create answered ${added.status}: ${added.text}`);
	return made.body;
};
const manager = (overrides = {}) =>
	api.limited({
		visibility: "all",
		proxy_hosts: "manage",
		redirection_hosts: "manage",
		dead_hosts: "manage",
		access_lists: "view",
		certificates: "manage",
		...overrides,
	});
const rowOf = (name) => api.db("npmpro_ddns_record").where({ name }).first();
const auditRows = (action) => api.db("audit_log").where({ object_type: "ddns-record", action }).orderBy("id");
const meta = (row) => JSON.parse(row.meta);
const hostUrl = (id) => `/nginx/proxy-hosts/${id}`;
const everyAnswer = [];
const record = (res) => {
	everyAnswer.push(res.text);
	return res;
};

before(async () => {
	api = await startApi({ env: { DDNS_IPV4_SERVICES: "https://ip1.test https://ip2.test" } });
	admin = await api.admin();
	({
		default: { idle },
	} = await import("../internal/host-dns-record.js"));
	const countHit = () => {
		ipHits += 1;
		return { statusCode: 200, data: `${PUBLIC_IP}\n` };
	};
	for (const [index, name] of ["ip1.test", "ip2.test"].entries()) {
		api.outside.dns.set(name, `198.51.100.${50 + index}`);
		api.outside.http.get(`https://${name}`).intercept({ path: "/", method: "GET" }).reply(countHit).persist();
	}
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	mockCloudflare();
	await withCredential("host-dns.example");
});
afterEach(async () => {
	cf.records.clear();
	cf.calls.length = 0;
	cf.failDeletes = true;
	ipHits = 0;
	await api.db("npmpro_ddns_history").del();
	await api.db("npmpro_ddns_record").del();
});
after(() => api?.stop());

it("creates a ticked name's record after the save, answers at once and audits it", async () => {
	const name = "app.host-dns.example";
	const done = record(await proxyHost([name], { records: [tick(name)] }));
	assert.equal(done.status, 201, done.text);
	// the save did not wait for the provider: its state is pending and nothing was written yet
	assert.equal(stateOf(done.body.npmpro_dns_records, name).state, "pending");
	await settle("proxy_host", done.body.id);
	const posts = callsOf("POST", name);
	assert.equal(posts.length, 1);
	assert.equal(posts[0].body.type, "A");
	assert.equal(posts[0].body.content, PUBLIC_IP);
	assert.equal(posts[0].body.ttl, 300);
	assert.equal(posts[0].body.proxied, false);

	const read = record(await admin.get(hostUrl(done.body.id)));
	const state = stateOf(read.body.npmpro_dns_records, name);
	assert.equal(state.state, "ok");
	assert.equal(state.origin, "created");
	const listed = record(await admin.get("/nginx/proxy-hosts?expand=dns_records"));
	assert.equal(stateOf(listed.body.find((host) => host.id === done.body.id).npmpro_dns_records, name).state, "ok");

	const [firstAudit] = await auditRows("created");
	assert.deepEqual(
		{
			name: meta(firstAudit).name,
			type: meta(firstAudit).host_type,
			id: meta(firstAudit).host_id,
			origin: meta(firstAudit).origin,
		},
		{ name, type: "proxy_host", id: done.body.id, origin: "created" },
	);
});

it("a host with the option off never reaches the provider or the address services", async () => {
	const name = "off.host-dns.example";
	const done = await created([name]);
	assert.equal(done.npmpro_dns_records, undefined);
	const edit = await admin.put(hostUrl(done.id), { domain_names: [name, "off2.host-dns.example"] });
	assert.equal(edit.status, 200, edit.text);
	assert.equal(edit.body.npmpro_dns_records, undefined);
	assert.equal((await admin.post(`${hostUrl(done.id)}/disable`)).status, 200);
	assert.equal((await admin.post(`${hostUrl(done.id)}/enable`)).status, 200);
	assert.equal((await admin.get(hostUrl(done.id))).body.npmpro_dns_records, undefined);
	assert.equal((await admin.delete(hostUrl(done.id))).status, 200);
	for (const type of ["redirection", "dead"]) {
		const base = type === "dead" ? "/nginx/dead-hosts" : "/nginx/redirection-hosts";
		const body =
			type === "dead"
				? { domain_names: [`${type}.host-dns.example`] }
				: {
						domain_names: [`${type}.host-dns.example`],
						forward_scheme: "http",
						forward_domain_name: "x.example",
						forward_http_code: 301,
					};
		const made = await admin.post(base, body);
		assert.equal(made.status, 201, made.text);
		assert.equal((await admin.post(`${base}/${made.body.id}/disable`)).status, 200);
		assert.equal((await admin.post(`${base}/${made.body.id}/enable`)).status, 200);
		assert.equal((await admin.delete(`${base}/${made.body.id}`)).status, 200);
	}
	await idle("proxy_host", done.id);
	assert.deepEqual(cf.calls, []);
	assert.equal(ipHits, 0);
	assert.equal(await api.db("npmpro_ddns_record").whereNotNull("host_type").first(), undefined);
});

it("a name the user did not tick gets no read, write or row", async () => {
	const ticked = "ticked.host-dns.example";
	const left = "left.host-dns.example";
	const done = await created([ticked, left], { records: [tick(ticked)] });
	await settle("proxy_host", done.id);
	assert.equal(callsOf("POST").length, 1);
	assert.deepEqual(
		cf.calls.filter((call) => call.name === left),
		[],
	);
	assert.equal(await rowOf(left), undefined);
	assert.equal(stateOf(done.npmpro_dns_records, left)?.state ?? "off", "off");
	// a later save that leaves the field out changes nothing for the other name either
	const edit = await admin.put(hostUrl(done.id), { npmpro_description: "again" });
	assert.equal(edit.status, 200, edit.text);
	await settle("proxy_host", done.id);
	assert.equal(await rowOf(left), undefined);
	assert.equal(callsOf("POST").length, 1);
});

it("works for redirection and 404 hosts too", async () => {
	for (const [base, body] of [
		[
			"/nginx/redirection-hosts",
			{ forward_scheme: "http", forward_domain_name: "x.example", forward_http_code: 301 },
		],
		["/nginx/dead-hosts", {}],
	]) {
		const name = `${base.includes("dead") ? "dead" : "redir"}.host-dns.example`;
		const made = await admin.post(base, { domain_names: [name], ...body, npmpro_dns_records: [tick(name)] });
		assert.equal(made.status, 201, made.text);
		assert.equal(stateOf(made.body.npmpro_dns_records, name).state, "pending");
		await settle(base.includes("dead") ? "dead_host" : "redirection_host", made.body.id);
		assert.equal(callsOf("POST", name).length, 1);
		const row = await rowOf(name);
		assert.equal(row.host_type, base.includes("dead") ? "dead_host" : "redirection_host");
		const read = await admin.get(`${base}/${made.body.id}`);
		assert.equal(stateOf(read.body.npmpro_dns_records, name).state, "ok");
	}
});

it("a host manager without certificates:manage saves the host, the tick is unavailable and nothing is called", async () => {
	const name = "noright.host-dns.example";
	const user = await manager({ certificates: "view" });
	const done = record(await proxyHost([name], { session: user, records: [tick(name)] }));
	assert.equal(done.status, 201, done.text);
	const state = stateOf(done.body.npmpro_dns_records, name);
	assert.equal(state.state, "unavailable");
	assert.equal(state.reason, "error.host-dns-no-right");
	await settle("proxy_host", done.body.id);
	assert.deepEqual(cf.calls, []);
	assert.equal(await rowOf(name), undefined);
	// the same tick with no certificates section at all
	const hidden = await manager({ certificates: "view" });
	const second = await proxyHost(["noright2.host-dns.example"], {
		session: hidden,
		records: [tick("noright2.host-dns.example")],
	});
	assert.equal(second.status, 201, second.text);
	assert.equal(second.body.npmpro_dns_records[0].reason, "error.host-dns-no-right");
});

it("another owner's credential is never used for the tick, and the host still saves", async () => {
	const name = "other.host-dns.example";
	const user = await api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "manage",
	});
	const done = await proxyHost([name], { session: user, records: [tick(name)] });
	assert.equal(done.status, 201, done.text);
	// the provider side of the check runs in the host's job: the state is read after it
	await settle("proxy_host", done.body.id);
	const read = await user.get(hostUrl(done.body.id));
	assert.equal(stateOf(read.body.npmpro_dns_records, name).state, "unavailable");
	assert.equal(stateOf(read.body.npmpro_dns_records, name).reason, "error.host-dns-no-credential");
	assert.deepEqual(cf.calls, []);
	assert.equal(await rowOf(name), undefined);
	// the user cannot probe the reach of another user's host: 404
	const adminHost = await created(["adminhost.host-dns.example"]);
	const probe = await user.post("/nginx/dns-check/reach", {
		host_type: "proxy_host",
		host_id: adminHost.id,
		name: "adminhost.host-dns.example",
	});
	assert.equal(probe.status, 404, probe.text);
});

it("untick needs the host's manage right only and deletes one record at the provider", async () => {
	const name = "untick.host-dns.example";
	const done = await created([name], { records: [tick(name)] });
	await settle("proxy_host", done.id);
	assert.equal(callsOf("POST").length, 1);
	const hostOnly = await manager({ certificates: "view" });
	const edit = record(await hostOnly.put(hostUrl(done.id), { npmpro_dns_records: [] }));
	assert.equal(edit.status, 200, edit.text);
	await settle("proxy_host", done.id);
	assert.equal(callsOf("DELETE").length, 1);
	assert.equal(callsOf("DELETE")[0].name, name);
	assert.equal(await rowOf(name), undefined);
	const [removed] = await auditRows("removed");
	assert.equal(meta(removed).name, name);
	assert.equal(meta(removed).host_id, done.id);
});

it("disable pauses the row, enable resumes it, delete removes the created record; none of it fails the host", async () => {
	const name = "life.host-dns.example";
	const done = await created([name], { records: [tick(name)] });
	await settle("proxy_host", done.id);
	cf.calls.length = 0;

	const off = record(await admin.post(`${hostUrl(done.id)}/disable`));
	assert.equal(off.status, 200, off.text);
	assert.equal(stateOf(off.body.npmpro_dns_records, name).state, "paused");
	assert.deepEqual(cf.calls, []);
	const paused = await rowOf(name);
	assert.equal(Boolean(paused.enabled), false);
	assert.equal(meta(paused).paused_by_host, true);

	const on = record(await admin.post(`${hostUrl(done.id)}/enable`));
	assert.equal(on.status, 200, on.text);
	assert.equal(stateOf(on.body.npmpro_dns_records, name).state, "pending");
	assert.deepEqual(cf.calls, []);

	const gone = record(await admin.delete(hostUrl(done.id)));
	assert.equal(gone.status, 200, gone.text);
	await settle("proxy_host", done.id);
	assert.equal(callsOf("DELETE").length, 1);
	assert.equal(await rowOf(name), undefined);
});

it("deleting a host keeps an adopted record at the provider", async () => {
	const name = "adopted.host-dns.example";
	setRecord(name, "A", PUBLIC_IP);
	const done = await created([name], { records: [tick(name)] });
	await settle("proxy_host", done.id);
	assert.equal(callsOf("POST").length, 0);
	assert.equal((await rowOf(name)).origin, "adopted");
	assert.equal((await admin.delete(hostUrl(done.id))).status, 200);
	await settle("proxy_host", done.id);
	assert.equal(callsOf("DELETE").length, 0);
	assert.equal(await rowOf(name), undefined);
	assert.ok(cf.records.has(`${name}|A`));
});

it("adopt and leave: a name holding another address waits for the user's choice", async () => {
	const adoptName = "adopt.host-dns.example";
	const leaveName = "leave.host-dns.example";
	setRecord(adoptName, "A", "192.0.2.5");
	setRecord(leaveName, "A", "192.0.2.6");
	const done = await created([adoptName, leaveName], { records: [tick(adoptName), tick(leaveName)] });
	await settle("proxy_host", done.id);
	assert.equal(callsOf("POST").length + callsOf("PATCH").length, 0);
	const read = await admin.get(hostUrl(done.id));
	const exists = stateOf(read.body.npmpro_dns_records, adoptName);
	assert.equal(exists.state, "exists");
	assert.equal(exists.adopt_allowed, true);

	// adopting needs certificates:manage
	const noRight = await manager({ certificates: "view" });
	assert.equal((await noRight.post(`/nginx/ddns-records/${exists.record_id}/adopt`)).status, 403);
	const adopted = record(await admin.post(`/nginx/ddns-records/${exists.record_id}/adopt`));
	assert.equal(adopted.status, 200, adopted.text);
	assert.equal(adopted.body.state, "ok");
	assert.equal(adopted.body.origin, "adopted");
	assert.equal(callsOf("PATCH", adoptName).length, 1);
	assert.equal(cf.records.get(`${adoptName}|A`).content, PUBLIC_IP);

	// leaving needs only the host's manage right, and writes nothing
	const leaveRow = stateOf(read.body.npmpro_dns_records, leaveName);
	const hostOnly = await manager({ certificates: "view" });
	const left = record(await hostOnly.post(`/nginx/ddns-records/${leaveRow.record_id}/leave`));
	assert.equal(left.status, 200, left.text);
	assert.equal(left.body.state, "off");
	assert.equal(await rowOf(leaveName), undefined);
	assert.equal(callsOf("PATCH", leaveName).length, 0);
	assert.equal(cf.records.get(`${leaveName}|A`).content, "192.0.2.6");
	assert.equal((await auditRows("left")).length, 1);
	// a name that holds nothing else cannot be left alone
	const again = await admin.post(`/nginx/ddns-records/${exists.record_id}/leave`);
	assert.equal(again.status, 400, again.text);
});

it("adopt and leave need the host's section, and the row's host to be visible", async () => {
	const name = "section.host-dns.example";
	setRecord(name, "A", "192.0.2.7");
	const done = await created([name], { records: [tick(name)] });
	await settle("proxy_host", done.id);
	const row = await rowOf(name);
	const noHosts = await manager({ proxy_hosts: "view" });
	assert.equal((await noHosts.post(`/nginx/ddns-records/${row.id}/leave`)).status, 403);
	assert.equal((await noHosts.post(`/nginx/ddns-records/${row.id}/adopt`)).status, 403);
	assert.equal(callsOf("PATCH").length, 0);
});

it("an orphan: the delete at the provider fails, then the user deletes it again", async () => {
	const name = "del500-orphan.host-dns.example";
	const done = await created([name], { records: [tick(name)] });
	await settle("proxy_host", done.id);
	const edit = await admin.put(hostUrl(done.id), { npmpro_dns_records: [] });
	assert.equal(edit.status, 200, edit.text);
	await settle("proxy_host", done.id);
	assert.equal(callsOf("DELETE").length, 1);
	const read = await admin.get(hostUrl(done.id));
	const orphan = stateOf(read.body.npmpro_dns_records, name);
	assert.equal(orphan.state, "orphan");
	assert.ok(!JSON.stringify(read.body).includes(TOKEN));

	// not an orphan: refused; a user without certificates:manage: 403
	const noRight = await manager({ certificates: "view" });
	assert.equal((await noRight.post(`/nginx/ddns-records/${orphan.record_id}/remove-at-provider`)).status, 403);
	// the provider takes the delete now
	cf.failDeletes = false;
	const again = record(await admin.post(`/nginx/ddns-records/${orphan.record_id}/remove-at-provider`));
	assert.equal(again.status, 200, again.text);
	assert.equal(again.body.state, "off");
	assert.equal(await rowOf(name), undefined);
	assert.equal(callsOf("DELETE").length, 2);
});

it("remove-at-provider refuses a row that is not an orphan", async () => {
	const name = "plain.host-dns.example";
	const done = await created([name], { records: [tick(name)] });
	await settle("proxy_host", done.id);
	const row = await rowOf(name);
	const refused = await admin.post(`/nginx/ddns-records/${row.id}/remove-at-provider`);
	assert.equal(refused.status, 400, refused.text);
	assert.equal(callsOf("DELETE").length, 0);
});

it("a provider failure never fails the host: a create 500, a read 500, a timeout and a 429 are name states", async () => {
	const cases = [
		["post500-a.host-dns.example", "failed", true],
		["timeout-a.host-dns.example", "failed", true],
		["post429-a.host-dns.example", "failed", true],
		["read500-a.host-dns.example", "failed", false],
	];
	for (const [name, expected, hasRow] of cases) {
		const done = record(await proxyHost([name], { records: [tick(name)] }));
		assert.equal(done.status, 201, `${name}: ${done.text}`);
		await settle("proxy_host", done.body.id);
		const read = record(await admin.get(hostUrl(done.body.id)));
		assert.equal(read.status, 200);
		assert.equal(stateOf(read.body.npmpro_dns_records, name).state, expected, name);
		const row = await rowOf(name);
		assert.equal(row !== undefined, hasRow, name);
		// the engine retries it on its next cycle (a save is an update now: no failure is counted yet)
		assert.deepEqual(row ? [row.state, Boolean(row.error)] : null, hasRow ? ["failed", true] : null, name);
	}
});

it("a save answers before the provider is done", async () => {
	const name = "slow-a.host-dns.example";
	const started = Date.now();
	const done = record(await proxyHost([name], { records: [tick(name)] }));
	assert.equal(done.status, 201, done.text);
	assert.ok(Date.now() - started < 450, "the save did not wait for the 500 ms read");
	assert.equal(stateOf(done.body.npmpro_dns_records, name).state, "pending");
	assert.equal(callsOf("POST").length, 0);
	await settle("proxy_host", done.body.id);
	assert.equal(callsOf("POST", name).length, 1);
	assert.equal(stateOf((await admin.get(hostUrl(done.body.id))).body.npmpro_dns_records, name).state, "ok");
});

it("a managed row is read-only through the record routes", async () => {
	const name = "managed.host-dns.example";
	const done = await created([name], { records: [tick(name)] });
	await settle("proxy_host", done.id);
	const row = await rowOf(name);
	const put = await admin.put(`/nginx/ddns-records/${row.id}`, { enabled: false });
	assert.equal(put.status, 400, put.text);
	assert.equal(put.body.error.message_i18n, "error.ddns-managed-by-host");
	const del = await admin.delete(`/nginx/ddns-records/${row.id}`);
	assert.equal(del.status, 400, del.text);
	const shown = await admin.get(`/nginx/ddns-records/${row.id}`);
	assert.equal(shown.body.host_type, "proxy_host");
	assert.equal(shown.body.host_id, done.id);
	assert.equal(shown.body.origin, "created");
	assert.equal(shown.body.host_label, name);
	// a user who may not view proxy hosts sees the row without the host's name
	const noHosts = await manager({ proxy_hosts: "hidden" });
	const seen = await noHosts.get(`/nginx/ddns-records/${row.id}`);
	assert.equal(seen.status, 200, seen.text);
	assert.equal(seen.body.host_label, null);
});

it("the reach route needs the host type's manage right, a name of the host and a plain name", async () => {
	const name = "reach.host-dns.example";
	const done = await created([name], {
		extra: {
			locations: [
				{
					path: "/.well-known/acme-challenge/",
					forward_scheme: "http",
					forward_host: "10.9.9.9",
					forward_port: 80,
				},
			],
		},
	});
	const probe = (session, body) => session.post("/nginx/dns-check/reach", body);
	const viewer = await manager({ proxy_hosts: "view" });
	assert.equal((await probe(viewer, { host_type: "proxy_host", host_id: done.id, name })).status, 403);
	assert.equal((await probe(admin, { host_type: "proxy_host", host_id: 99_999, name })).status, 404);
	assert.equal(
		(await probe(admin, { host_type: "proxy_host", host_id: done.id, name: "other.host-dns.example" })).status,
		400,
	);
	assert.equal((await probe(admin, { host_type: "proxy_host", name: "*.host-dns.example" })).status, 400);
	assert.equal((await probe(admin, { host_type: "stream", name })).status, 400);
	// a host that overrides the challenge path is not probed
	const overridden = await probe(admin, { host_type: "proxy_host", host_id: done.id, name });
	assert.equal(overridden.status, 200, overridden.text);
	assert.equal(overridden.body.result, "overridden");
});

it("the plan route answers per name, for an unsaved host too, and never names another owner's credential", async () => {
	const plan = (session, body) => record(session.post("/nginx/dns-check/plan", body));
	const free = "free.host-dns.example";
	const taken = "exists.host-dns.example";
	setRecord(taken, "A", "192.0.2.5");
	const answered = await plan(admin, {
		host_type: "proxy_host",
		names: [free, "FREE.host-dns.example", taken, "*.host-dns.example", "nowhere.invalid-zone.test"],
	});
	assert.equal(answered.status, 200, answered.text);
	assert.equal(answered.body.address, PUBLIC_IP);
	assert.equal(answered.body.host_disabled, false);
	assert.deepEqual(
		answered.body.names.map((entry) => entry.name),
		[free, taken, "*.host-dns.example", "nowhere.invalid-zone.test"],
	);
	const [one, existing, wildcard, none] = answered.body.names;
	assert.equal(one.available, true);
	assert.equal(one.zone, "host-dns.example");
	assert.equal(one.ttl, 300);
	assert.equal(one.proxied_allowed, true);
	assert.equal(one.credential.name.startsWith("Host record credential"), true);
	assert.deepEqual(existing.existing, [{ type: "A", values: ["192.0.2.5"] }]);
	assert.equal(wildcard.reason, "error.host-dns-wildcard");
	assert.equal(none.reason, "error.host-dns-no-credential");
	assert.ok(!answered.text.includes(TOKEN));
	// a saved disabled host is reported, an unknown host is a 404
	const host = await created(["off.host-dns.example"]);
	assert.equal((await admin.post(`${hostUrl(host.id)}/disable`)).status, 200);
	const disabled = await plan(admin, { host_type: "proxy_host", host_id: host.id, names: ["off.host-dns.example"] });
	assert.equal(disabled.body.host_disabled, true);
	assert.equal((await plan(admin, { host_type: "proxy_host", host_id: 99_999, names: [free] })).status, 404);
	// the view right of the host type decides, Certificates manage decides the provider side
	const hidden = await manager({ proxy_hosts: "hidden" });
	assert.equal((await plan(hidden, { host_type: "proxy_host", names: [free] })).status, 403);
	const viewer = await manager({ certificates: "view" });
	const noRight = await plan(viewer, { host_type: "proxy_host", names: [free] });
	assert.equal(noRight.status, 200, noRight.text);
	assert.equal(noRight.body.names[0].reason, "error.host-dns-no-right");
	assert.equal(noRight.body.names[0].credential, null);
	// the server's public addresses only for a user who may manage certificates
	assert.equal(noRight.body.address, null);
	assert.equal(noRight.body.ipv6_address, null);
	// another owner's credential is not named to a user who cannot see it
	const user = await api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "manage",
	});
	const other = await plan(user, { host_type: "proxy_host", names: [free] });
	assert.equal(other.status, 200, other.text);
	assert.equal(other.body.names[0].credential, null);
	assert.equal(other.body.names[0].reason, "error.host-dns-no-credential");
	assert.ok(!other.text.includes("Host record credential"));
	// another user's host is a 404
	const adminHost = await created(["plan-adminhost.host-dns.example"]);
	assert.equal((await plan(user, { host_type: "proxy_host", host_id: adminHost.id, names: [free] })).status, 404);
	// nothing was written
	assert.deepEqual(callsOf("POST"), []);
	assert.deepEqual(callsOf("DELETE"), []);
});

it("no token in any answer, audit entry or history row", async () => {
	const joined = everyAnswer.join("\n");
	assert.ok(!joined.includes(TOKEN));
	const audits = await api.db("audit_log").select("meta");
	assert.ok(!audits.some((row) => String(row.meta).includes(TOKEN)));
	const history = await api.db("npmpro_ddns_history").select();
	assert.ok(!JSON.stringify(history).includes(TOKEN));
	const rows = await api.db("npmpro_ddns_record").select("error", "meta");
	assert.ok(!JSON.stringify(rows).includes(TOKEN));
});

it("a stream never reaches the host record service", async () => {
	const { default: service } = await import("../internal/host-dns-record.js");
	const methods = ["applyHost", "onDisable", "onEnable", "onDelete", "statesOf", "statesOfMany"];
	const originals = Object.fromEntries(methods.map((method) => [method, service[method]]));
	const seen = [];
	for (const method of methods) {
		service[method] = (...args) => {
			seen.push(method);
			return originals[method](...args);
		};
	}
	try {
		const made = await admin.post("/nginx/streams", {
			incoming_port: 9391,
			forwarding_host: "10.0.0.5",
			forwarding_port: 22,
			tcp_forwarding: true,
			udp_forwarding: false,
		});
		assert.equal(made.status, 201, made.text);
		const url = `/nginx/streams/${made.body.id}`;
		assert.equal((await admin.put(url, { forwarding_port: 23 })).status, 200);
		assert.equal((await admin.post(`${url}/disable`)).status, 200);
		assert.equal((await admin.post(`${url}/enable`)).status, 200);
		assert.equal((await admin.get(url)).status, 200);
		assert.equal((await admin.get("/nginx/streams")).status, 200);
		assert.equal((await admin.delete(url)).status, 200);
	} finally {
		Object.assign(service, originals);
	}
	assert.deepEqual(seen, []);
});

it("a tick for a name that is not the host's is a 400 and the host is not saved", async () => {
	const stranger = { name: "stranger.host-dns.example" };
	const made = await proxyHost(["real.host-dns.example"], { records: [tick(stranger.name)] });
	assert.equal(made.status, 400, made.text);
	assert.equal(made.body.error.message_i18n, "error.host-dns-name-not-host");
	assert.equal(made.body.error.message_values?.name ?? made.body.error.values?.name, stranger.name);
	const host = await created(["real2.host-dns.example"]);
	const edit = await admin.put(hostUrl(host.id), { npmpro_dns_records: [tick(stranger.name)] });
	assert.equal(edit.status, 400, edit.text);
	// a rename that drops the ticked name in the same request is refused too
	const ticked = await created(["keep.host-dns.example"], { records: [tick("keep.host-dns.example")] });
	await settle("proxy_host", ticked.id);
	const rename = await admin.put(hostUrl(ticked.id), {
		domain_names: ["renamed.host-dns.example"],
		npmpro_dns_records: [tick("keep.host-dns.example")],
	});
	assert.equal(rename.status, 400, rename.text);
	assert.equal((await admin.get(hostUrl(ticked.id))).body.domain_names[0], "keep.host-dns.example");
	assert.deepEqual(
		callsOf("POST").map((call) => call.name),
		["keep.host-dns.example"],
	);
});

it("the list's expand=dns_records reads the rows of all hosts in one query", async () => {
	const { managedRows } = await import("../internal/ddns-record.js");
	const names = ["list1", "list2", "list3"].map((label) => `${label}.host-dns.example`);
	const hostsMade = [];
	for (const name of names) hostsMade.push(await created([name], { records: [tick(name)] }));
	for (const host of hostsMade) await settle("proxy_host", host.id);
	const counts = { one: 0, many: 0 };
	const { ofHost, ofHosts } = managedRows;
	managedRows.ofHost = (...args) => {
		counts.one += 1;
		return ofHost(...args);
	};
	managedRows.ofHosts = (...args) => {
		counts.many += 1;
		return ofHosts(...args);
	};
	let listed;
	try {
		listed = await admin.get("/nginx/proxy-hosts?expand=dns_records");
	} finally {
		Object.assign(managedRows, { ofHost, ofHosts });
	}
	assert.equal(listed.status, 200, listed.text);
	assert.deepEqual(counts, { one: 0, many: 1 });
	for (const name of names) {
		const host = listed.body.find((entry) => entry.domain_names.includes(name));
		assert.equal(stateOf(host.npmpro_dns_records, name).state, "ok");
	}
});

it("101 names: the request field and the plan route both refuse them, and nothing is saved", async () => {
	const names = Array.from({ length: 101 }, (_, index) => `many${index}.host-dns.example`);
	const hostsBefore = await api.db("proxy_host").count({ count: "*" });
	const made = await proxyHost(names.slice(0, 1), { records: names.map((name) => tick(name)) });
	assert.equal(made.status, 400, made.text);
	assert.deepEqual(await api.db("proxy_host").count({ count: "*" }), hostsBefore);
	const plan = await admin.post("/nginx/dns-check/plan", { host_type: "proxy_host", names });
	assert.equal(plan.status, 400, plan.text);
	assert.deepEqual(cf.calls, []);
});

it("the plan route writes nothing: no row, no audit entry, no history and no provider write", async () => {
	const name = "plan-only.host-dns.example";
	const audits = async () => Number((await api.db("audit_log").count({ count: "*" }))[0].count);
	const auditsBefore = await audits();
	const answered = await admin.post("/nginx/dns-check/plan", { host_type: "proxy_host", names: [name] });
	assert.equal(answered.status, 200, answered.text);
	assert.equal(answered.body.names[0].available, true);
	assert.equal(await api.db("npmpro_ddns_record").first(), undefined);
	assert.equal(await api.db("npmpro_ddns_history").first(), undefined);
	assert.equal(await audits(), auditsBefore);
	assert.deepEqual(
		cf.calls.filter((call) => call.method !== "GET"),
		[],
	);
});

it("a host delete with a credential that cannot be opened leaves an orphan the user can forget", async () => {
	const name = "sealed.host-dns.example";
	const host = await created([name], { records: [tick(name)] });
	await settle("proxy_host", host.id);
	assert.equal((await rowOf(name)).state, "ok");
	const row = await rowOf(name);
	const credential = await api.db("npmpro_dns_credential").where({ id: row.dns_credential_id }).first();
	// the stored values are sealed under another key now: they cannot be opened
	await api.db("npmpro_dns_credential").where({ id: credential.id }).update({ values: "not-a-sealed-value" });
	try {
		assert.equal((await admin.delete(hostUrl(host.id))).status, 200);
		await settle("proxy_host", host.id);
		const left = await rowOf(name);
		assert.equal(meta(left).orphan, true);
		assert.equal(left.enabled, 0);
		assert.deepEqual(callsOf("DELETE", name), []);
		// Forget: the row goes, the provider is not called
		const forgot = await admin.delete(`/nginx/ddns-records/${left.id}`);
		assert.equal(forgot.status, 200, forgot.text);
		assert.equal(await rowOf(name), undefined);
	} finally {
		await api.db("npmpro_dns_credential").where({ id: credential.id }).update({ values: credential.values });
	}
});
