import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { countRows } from "./support/hosts.js";

const TOKEN = "cf-token-credential-test-1234567890";
const HOST = "https://api.cloudflare.com";
const ZONES = "/client/v4/zones?page=1&per_page=50";
const json = { headers: { "content-type": "application/json" } };
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];

let api;
let admin;
let credentials = 0;

const credential = async (session, domains = [], { provider = "cloudflare", ...body } = {}) => {
	credentials += 1;
	const fields = provider === "cloudflare" ? [{ key: "dns_cloudflare_api_token", value: TOKEN }] : undefined;
	const done = await session.post("/nginx/dns-credentials", {
		name: `Credential ${credentials}`,
		provider,
		...(fields ? { fields } : {}),
		...body,
	});
	if (done.status !== 201) throw new Error(`credential create answered ${done.status}: ${done.text}`);
	if (domains.length > 0) {
		const added = await session.post("/nginx/dns-domains", { dns_credential_id: done.body.id, names: domains });
		if (added.status !== 201) throw new Error(`domains create answered ${added.status}: ${added.text}`);
	}
	return done.body;
};
const intercept = (path, status, body) =>
	api.outside.http.get(HOST).intercept({ path, method: "GET" }).reply(status, body, json);
const zones = (names) =>
	intercept(ZONES, 200, {
		success: true,
		result: names.map((name) => ({ name })),
		result_info: { page: 1, total_pages: 1 },
	});
const url = (id) => `/nginx/dns-credentials/${id}/test`;
const untouched = async () => {
	const pending = api.outside.http.pendingInterceptors().some((interceptor) => interceptor.path === ZONES);
	await fetch(`${HOST}${ZONES}`);
	return pending;
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
});
after(() => api?.stop());

it("answers works for a zone page, without a record read when there is no domain", async () => {
	const mine = await credential(admin);
	zones(["a.example", "b.example"]);
	const res = await admin.post(url(mine.id));
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(
		{ ...res.body, checked_on: undefined },
		{
			supported: true,
			state: "works",
			zones_seen: 2,
			needs: null,
			message: null,
			checked_on: undefined,
		},
	);
	assert.ok(!Number.isNaN(Date.parse(res.body.checked_on)));
});

it("reads the first domain's apex record after the zone page", async () => {
	const mine = await credential(admin, ["read.example"]);
	zones(["read.example"]);
	intercept("/client/v4/zones?name=read.example", 200, {
		success: true,
		result: [{ id: "z1", name: "read.example" }],
	});
	intercept(["/client/v4/zones/z1/dns_records", "?type=A&name.exact=read.example"].join(""), 200, {
		success: true,
		result: [],
	});
	const res = await admin.post(url(mine.id));
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.state, "works");
});

it("separates a wrong token from a missing right with the verify call, without the token", async () => {
	const mine = await credential(admin);
	intercept(ZONES, 403, { success: false, errors: [{ code: 9109, message: `Invalid token ${TOKEN}` }] });
	intercept("/client/v4/user/tokens/verify", 401, {
		success: false,
		errors: [{ code: 1000, message: "Invalid API Token" }],
	});
	const res = await admin.post(url(mine.id));
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.state, "wrong-key");
	assert.ok(res.body.message.includes("***"));
	assert.ok(!res.text.includes(TOKEN), "the answer holds the token");
	assert.equal(typeof res.body.needs, "string");
});

it("answers failed for a server error and blocked for a local address", async () => {
	const mine = await credential(admin);
	intercept(ZONES, 500, { errors: [{ message: "boom" }] });
	const failed = await admin.post(url(mine.id));
	assert.equal(failed.body.state, "failed");
	assert.ok(failed.body.message.includes("boom"));
	api.outside.dns.set("api.cloudflare.com", "127.0.0.1");
	try {
		zones(["x.example"]);
		const blocked = await admin.post(url(mine.id));
		assert.equal(blocked.status, 200, blocked.text);
		assert.equal(blocked.body.state, "blocked");
	} finally {
		api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	}
	assert.ok(await untouched(), "the provider was asked");
});

it("answers supported false for an INI credential without any outside request", async () => {
	const ini = await credential(admin, [], {
		provider: "acmedns",
		ini: "dns_acmedns_api_url = https://auth.acme-dns.io\n",
	});
	zones([]);
	const res = await admin.post(url(ini.id));
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.supported, false);
	assert.equal(res.body.state, null);
	assert.ok(await untouched(), "the provider was asked");
});

it("writes no audit row and stores nothing", async () => {
	const mine = await credential(admin);
	const audits = await countRows(api, "audit_log");
	const stored = await api.db("npmpro_dns_credential").where({ id: mine.id }).first();
	zones(["a.example"]);
	assert.equal((await admin.post(url(mine.id))).status, 200);
	assert.equal(await countRows(api, "audit_log"), audits);
	assert.deepEqual(await api.db("npmpro_dns_credential").where({ id: mine.id }).first(), stored);
});

it("needs manage: a view user and a view token get 403", async () => {
	const mine = await credential(admin);
	const viewer = await api.limited({ visibility: "user", certificates: "view" });
	assert.equal((await viewer.post(url(mine.id))).status, 403);
	const made = await admin.post("/users/me/api-tokens", {
		name: "test-view",
		permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === "certificates" ? "view" : "hidden"])),
	});
	assert.equal(made.status, 201, made.text);
	const headers = { authorization: `Bearer ${made.body.token}` };
	assert.equal((await api.client().post(url(mine.id), undefined, { headers })).status, 403);
	assert.equal((await api.client().post(url(mine.id))).status, 401);
});

it("hides another owner's credential with 404 and an unknown id", async () => {
	const mine = await credential(admin);
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	assert.equal((await own.post(url(mine.id))).status, 404);
	assert.equal((await admin.post(url(999999))).status, 404);
});

it("answers the decrypt error for a credential that cannot be decrypted, without any request", async () => {
	const mine = await credential(admin);
	await api.db("npmpro_dns_credential").where({ id: mine.id }).update({ values: "v1:bad:bad:bad" });
	zones(["x.example"]);
	const res = await admin.post(url(mine.id));
	assert.equal(res.status, 400, res.text);
	assert.ok(res.body.error.message.includes("cannot be decrypted"));
	assert.ok(await untouched(), "no request was made");
});
