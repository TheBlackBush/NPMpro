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
const reply = (names, status, body) =>
	api.outside.http
		.get(HOST)
		.intercept({ path: ZONES, method: "GET" })
		.reply(
			status ?? 200,
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
	const ini = await credential(admin, [], {
		provider: "acmedns",
		ini: "dns_acmedns_api_url = https://auth.acme-dns.io\n",
	});
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
	for (const id of [
		"cloudflare",
		"digitalocean",
		"hetzner-cloud",
		"gandi",
		"ovh",
		"powerdns",
		"linode",
		"vultr",
		"desec",
		"bunny",
		"porkbun",
		"ionos",
		"godaddy",
	]) {
		assert.equal(flag(id), true, id);
	}
	assert.equal(flag("acmedns"), false);
});

it("computes the states against the credential's owner when an administrator fetches it", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	await credential(admin, ["owners.example", "adminonly.example"]);
	const first = await credential(own, ["owners.example"]);
	const second = await credential(own, ["second.example"]);
	reply(["owners.example", "second.example", "adminonly.example"]);
	const res = await admin.get(url(first.id));
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.zones, [
		{ name: "adminonly.example", state: "new" },
		{ name: "owners.example", state: "here" },
		{ name: "second.example", state: "other", credential_name: second.name },
	]);
});

it("carries the needed permission of a refused credential and no secret in it", async () => {
	const mine = await credential(admin);
	reply([], 403, { success: false, errors: [{ code: 9109, message: "Invalid token" }] });
	const res = await admin.get(url(mine.id));
	assert.equal(res.status, 400);
	assert.equal(typeof res.body.error.message_values.needs, "string");
	assert.ok(res.body.error.message_values.needs.length > 0);
	assert.ok(!res.body.error.message_values.needs.includes(TOKEN));
	assert.ok(!res.text.includes(TOKEN));
});

it("marks a list of more than 1000 zones as truncated", async () => {
	const mine = await credential(admin);
	const pages = 21;
	for (let page = 1; page <= pages; page++) {
		const names = Array.from({ length: 50 }, (_, n) => `zone-${page}-${n}.example`);
		api.outside.http
			.get(HOST)
			.intercept({ path: `/client/v4/zones?page=${page}&per_page=50`, method: "GET" })
			.reply(
				200,
				{
					success: true,
					result: names.map((name) => ({ name })),
					result_info: { page, total_pages: pages },
				},
				json,
			);
	}
	const res = await admin.get(url(mine.id));
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.truncated, true);
	assert.equal(res.body.zones.length, 1000);
});

it("answers the decrypt error for a credential that cannot be decrypted, without any request", async () => {
	const mine = await credential(admin);
	await api.db("npmpro_dns_credential").where({ id: mine.id }).update({ values: "v1:bad:bad:bad" });
	reply(["x.example"]);
	const res = await admin.get(url(mine.id));
	assert.equal(res.status, 400, res.text);
	assert.ok(res.body.error.message.includes("cannot be decrypted"));
	assert.ok(await untouched(), "no request was made");
});

it("matches a stored name in another case and a zone with a trailing dot as here", async () => {
	const mine = await credential(admin);
	await api.db("npmpro_dns_domain").insert({
		dns_credential_id: mine.id,
		name: "Example.COM",
		source: "typed",
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
	});
	reply(["example.com."]);
	const res = await admin.get(url(mine.id));
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.zones, [{ name: "example.com", state: "here" }]);
});

it("answers 500 without the message for an error that is not a provider error", async () => {
	const { providerForCredential } = await import("../lib/ddns/providers/index.js");
	const provider = providerForCredential("cloudflare");
	const original = provider.listZones;
	provider.listZones = () => {
		throw new Error(`broken inside with ${TOKEN}`);
	};
	try {
		const mine = await credential(admin);
		const res = await admin.get(url(mine.id));
		assert.equal(res.status, 500);
		assert.ok(!res.text.includes("broken inside"));
		assert.ok(!res.text.includes(TOKEN));
	} finally {
		provider.listZones = original;
	}
});

it("answers 400 error.dns-zones-not-https for a PowerDNS http endpoint that is not on the LAN", async () => {
	api.outside.dns.set("pdns.example.org", "198.51.100.30");
	const mine = await credential(admin, [], {
		provider: "powerdns",
		fields: [
			{ key: "dns_pdns_endpoint", value: "http://pdns.example.org:8081" },
			{ key: "dns_pdns_api_key", value: "PDNS-KEY-123" },
		],
	});
	const res = await admin.get(url(mine.id));
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.dns-zones-not-https");
	assert.ok(!res.text.includes("PDNS-KEY-123"));
});

it("never answers with the provider's own status", async () => {
	const { DdnsProviderError } = await import("../lib/ddns/errors.js");
	const { providerForCredential } = await import("../lib/ddns/providers/index.js");
	const { default: internalDnsProviderDomains } = await import("../internal/dns-provider-domains.js");
	const refusal = () =>
		new DdnsProviderError({ providerStatus: 401, code: "failed", message: "Unexpected answer (401): no" });
	const provider = providerForCredential("cloudflare");
	const original = { listZones: provider.listZones, get: internalDnsProviderDomains.get };
	const mine = await credential(admin);
	try {
		// through the route's mapping: its 400
		provider.listZones = () => Promise.reject(refusal());
		const mapped = await admin.get(url(mine.id));
		assert.equal(mapped.status, 400, mapped.text);
		assert.equal(mapped.body.error.code, 400);
		// one that escapes a route: a 500, not the provider's 401 (which the UI would read as signed out)
		internalDnsProviderDomains.get = () => Promise.reject(refusal());
		const escaped = await admin.get(url(mine.id));
		assert.equal(escaped.status, 500, escaped.text);
		assert.equal(escaped.body.error.code, 500);
	} finally {
		provider.listZones = original.listZones;
		internalDnsProviderDomains.get = original.get;
	}
});
