import assert from "node:assert/strict";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { after, it } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";

process.env.NPMPRO_TEST_ROOT = "/nonexistent-dns-zone-lists-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");
const { DdnsProviderError } = await import("../lib/ddns/errors.js");
const { PROVIDERS, providerById, providerForCredential, listsDomains } = await import("../lib/ddns/providers/index.js");

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

const json = { headers: { "content-type": "application/json" } };
const TOKEN = "tok-secret-1234";
const run = (id, fields, secrets = [TOKEN]) =>
	providerById(id).listZones({ fields, fetch: (url, options) => providerFetch(url, { ...options, secrets }) });
const intercept = (host, path, headers) => mock.get(`https://${host}`).intercept({ path, method: "GET", headers });
const bearerOf = (token) => ({ authorization: `Bearer ${token}` });

const CASES = {
	cloudflare: {
		fields: { dns_cloudflare_api_token: TOKEN },
		host: "api.cloudflare.com",
		headers: bearerOf(TOKEN),
		path: (page) => `/client/v4/zones?page=${page}&per_page=50`,
		body: (names, page = 1, total = 1) => ({
			success: true,
			result: names.map((name) => ({ name })),
			result_info: { page, total_pages: total },
		}),
		perPage: 50,
	},
	digitalocean: {
		fields: { dns_digitalocean_token: TOKEN },
		host: "api.digitalocean.com",
		headers: bearerOf(TOKEN),
		path: (page) => `/v2/domains?page=${page}&per_page=200`,
		body: (names, page = 1, total = 1) => ({
			domains: names.map((name) => ({ name })),
			links: page < total ? { pages: { next: "https://x/next" } } : {},
		}),
		perPage: 200,
	},
	"hetzner-cloud": {
		fields: { dns_hetzner_cloud_api_token: TOKEN },
		host: "api.hetzner.cloud",
		headers: bearerOf(TOKEN),
		path: (page) => `/v1/zones?page=${page}&per_page=50`,
		body: (names, page = 1, total = 1) => ({
			zones: names.map((name) => ({ name })),
			meta: { pagination: { page, next_page: page < total ? page + 1 : null } },
		}),
		perPage: 50,
	},
	gandi: {
		fields: { dns_gandi_token: TOKEN },
		host: "api.gandi.net",
		headers: bearerOf(TOKEN),
		path: (page) => `/v5/livedns/domains?page=${page}&per_page=100`,
		// a page is full at 100 items; "total" pages means the last one is short
		body: (names) => names.map((fqdn) => ({ fqdn })),
		perPage: 100,
	},
};

const zoneNames = (from, count) =>
	Array.from({ length: count }, (_, i) => `z${String(from + i).padStart(4, "0")}.example.org`);

for (const [id, c] of Object.entries(CASES)) {
	it(`${id}: one page, sorted and normalized`, async () => {
		intercept(c.host, c.path(1), c.headers).reply(200, c.body(["b.example.org", "A.Example.com."]), json);
		assert.deepEqual(await run(id, c.fields), ["a.example.com", "b.example.org"]);
	});

	it(`${id}: two pages`, async () => {
		const first = zoneNames(1, c.perPage);
		const second = ["last.example.org"];
		intercept(c.host, c.path(1), c.headers).reply(200, c.body(first, 1, 2), json);
		intercept(c.host, c.path(2), c.headers).reply(200, c.body(second, 2, 2), json);
		const zones = await run(id, c.fields);
		assert.equal(zones.length, c.perPage + 1);
		assert.equal(zones.truncated, undefined);
	});

	it(`${id}: more than 1000 names are cut and marked truncated`, async () => {
		const total = Math.ceil(1100 / c.perPage);
		for (let page = 1; page <= total; page++) {
			const chunk = zoneNames((page - 1) * c.perPage, c.perPage);
			intercept(c.host, c.path(page), c.headers).reply(200, c.body(chunk, page, total), json);
			if (page * c.perPage > 1000) break;
		}
		const zones = await run(id, c.fields);
		assert.equal(zones.length, 1000);
		assert.equal(zones.truncated, true);
		mock.assertNoPendingInterceptors();
	});

	it(`${id}: a 403 is forbidden with a hint and the token scrubbed`, async () => {
		intercept(c.host, c.path(1), c.headers).reply(
			403,
			{ message: `bad token ${TOKEN}`, errors: [{ message: `no ${TOKEN}` }] },
			json,
		);
		await assert.rejects(run(id, c.fields), (err) => {
			assert.ok(err instanceof DdnsProviderError);
			assert.equal(err.code, "forbidden");
			assert.ok(err.hint);
			assert.ok(!err.message.includes(TOKEN));
			assert.ok(err.message.includes("***"));
			return true;
		});
	});

	it(`${id}: a 500 is failed`, async () => {
		intercept(c.host, c.path(1), c.headers).reply(500, "<html>boom</html>");
		await assert.rejects(run(id, c.fields), (err) => err.code === "failed" && err.message.includes("boom"));
	});

	it(`${id}: a body of the wrong shape is failed`, async () => {
		intercept(c.host, c.path(1), c.headers).reply(200, { nope: true }, json);
		await assert.rejects(run(id, c.fields), (err) => err.code === "failed");
	});

	it(`${id}: IDN names come back as punycode and invalid names are left out`, async () => {
		intercept(c.host, c.path(1), c.headers).reply(
			200,
			c.body(["bücher.example", "not a name", "*.wild.org", "ok.org"]),
			json,
		);
		assert.deepEqual(await run(id, c.fields), ["ok.org", "xn--bcher-kva.example"]);
	});
}

it("cloudflare: the global key group sends X-Auth-Email and X-Auth-Key", async () => {
	const fields = { dns_cloudflare_email: "me@example.org", dns_cloudflare_api_key: "globalkey-9999" };
	intercept("api.cloudflare.com", CASES.cloudflare.path(1), {
		"x-auth-email": "me@example.org",
		"x-auth-key": "globalkey-9999",
	}).reply(200, CASES.cloudflare.body(["g.example.org"]), json);
	assert.deepEqual(await run("cloudflare", fields, ["globalkey-9999"]), ["g.example.org"]);
});

it("cloudflare: success false with status 200 is forbidden", async () => {
	intercept("api.cloudflare.com", CASES.cloudflare.path(1), bearerOf(TOKEN)).reply(
		200,
		{ success: false, errors: [{ message: "Authentication error" }] },
		json,
	);
	await assert.rejects(
		run("cloudflare", CASES.cloudflare.fields),
		(err) => err.code === "forbidden" && err.hint === "Zone Read",
	);
});

it("a 4.1 error (network) passes through", async () => {
	intercept("api.gandi.net", CASES.gandi.path(1), bearerOf(TOKEN)).replyWithError(new Error("boom"));
	await assert.rejects(run("gandi", CASES.gandi.fields), (err) => err.code === "network");
});

it("the registry is ordered and looks providers up", () => {
	assert.deepEqual(
		PROVIDERS.map((p) => p.id),
		["cloudflare", "digitalocean", "hetzner-cloud", "gandi"],
	);
	assert.equal(providerById("gandi").label, "Gandi");
	assert.equal(providerById("nope"), null);
	assert.equal(providerForCredential("hetzner-cloud").id, "hetzner-cloud");
	assert.equal(providerForCredential("route53"), null);
	assert.equal(listsDomains("cloudflare"), true);
	assert.equal(listsDomains("route53"), false);
});
