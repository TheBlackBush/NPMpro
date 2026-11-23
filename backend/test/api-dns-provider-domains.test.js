import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const TOKEN = "cf-token-provider-domains-1234567890";
const HOST = "https://api.cloudflare.com";
const ZONES = "/client/v4/zones?page=1&per_page=50";
const json = { headers: { "content-type": "application/json" } };

let api;
let admin;
let credentials = 0;

const credential = async (session, domains = [], provider = "cloudflare", body = {}) => {
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
const reply = (names, status = 200, body) =>
	api.outside.http
		.get(HOST)
		.intercept({ path: ZONES, method: "GET" })
		.reply(
			status,
			body ?? {
				success: true,
				result: names.map((name) => ({ name })),
				result_info: { page: 1, total_pages: 1 },
			},
			json,
		);
// true when the zones interceptor was not used by the request under test; it is used up here
const untouched = async () => {
	const pending = api.outside.http.pendingInterceptors().some((interceptor) => interceptor.path === ZONES);
	await fetch(`${HOST}${ZONES}`);
	return pending;
};
const url = (id) => `/nginx/dns-credentials/${id}/provider-domains`;

before(async () => {
	api = await startApi();
	admin = await api.admin();
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
});
after(() => api?.stop());

it("marks each zone as here, other or new", async () => {
	const mine = await credential(admin, ["here.example"]);
	const second = await credential(admin, ["other.example"]);
	reply(["here.example", "other.example", "new.example"]);
	const res = await admin.get(url(mine.id));
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body, {
		supported: true,
		truncated: false,
		zones: [
			{ name: "here.example", state: "here" },
			{ name: "new.example", state: "new" },
			{ name: "other.example", state: "other", credential_name: second.name },
		],
	});
});

it("does not count the domains of another owner", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	await credential(admin, ["admins.example"]);
	const mine = await credential(own);
	reply(["admins.example"]);
	const res = await own.get(url(mine.id));
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.zones, [{ name: "admins.example", state: "new" }]);
});

it("answers supported false for an INI credential without any outside request", async () => {
	const ini = await credential(admin, [], "acmedns", { ini: "dns_acmedns_api_url = https://auth.acme-dns.io\n" });
	reply([]);
	const res = await admin.get(url(ini.id));
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body, { supported: false, truncated: false, zones: [] });
	assert.ok(await untouched(), "the provider was asked");
});

it("answers 400 error.dns-zones-forbidden for a refused token, without the token", async () => {
	const mine = await credential(admin);
	reply([], 403, { success: false, errors: [{ code: 9109, message: `Invalid token ${TOKEN}` }] });
	const res = await admin.get(url(mine.id));
	assert.equal(res.status, 400);
	assert.equal(res.body.error.message_i18n, "error.dns-zones-forbidden");
	assert.equal(res.body.error.message_values.provider, "Cloudflare");
	assert.ok(res.body.error.message_values.message.includes("***"));
	assert.ok(!res.text.includes(TOKEN), "the answer holds the token");
});

it("answers 400 error.dns-zones-failed for a server error", async () => {
	const mine = await credential(admin);
	reply([], 500, { errors: [{ message: "boom" }] });
	const res = await admin.get(url(mine.id));
	assert.equal(res.status, 400);
	assert.equal(res.body.error.message_i18n, "error.dns-zones-failed");
	assert.ok(res.body.error.message_values.message.includes("boom"));
});

it("answers 400 error.dns-zones-blocked for a provider that resolves to a local address", async () => {
	const mine = await credential(admin);
	api.outside.dns.set("api.cloudflare.com", "127.0.0.1");
	try {
		reply(["x.example"]);
		const res = await admin.get(url(mine.id));
		assert.equal(res.status, 400, res.text);
		assert.equal(res.body.error.message_i18n, "error.dns-zones-blocked");
	} finally {
		api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	}
	assert.ok(await untouched(), "the provider was asked");
});

it("refuses a view-only user and hides another owner's credential", async () => {
	const viewer = await api.limited({ visibility: "user", certificates: "view" });
	const mine = await credential(admin);
	const forbidden = await viewer.get(url(mine.id));
	assert.equal(forbidden.status, 403);
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const hidden = await own.get(url(mine.id));
	assert.equal(hidden.status, 404);
});

it("shows lists_domains in the providers list", async () => {
	const res = await admin.get("/nginx/certificates/dns-providers");
	assert.equal(res.status, 200, res.text);
	const flag = (id) => res.body.find((provider) => provider.id === id)?.lists_domains;
	for (const id of ["cloudflare", "digitalocean", "hetzner-cloud", "gandi", "ovh", "powerdns"]) {
		assert.equal(flag(id), true, id);
	}
	assert.equal(flag("acmedns"), false);
});
