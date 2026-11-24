import assert from "node:assert/strict";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { after, it } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";

process.env.NPMPRO_TEST_ROOT = "/nonexistent-dns-zone-lists-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");
const { DdnsProviderError } = await import("../lib/ddns/errors.js");
const {
	PROVIDERS,
	providerById,
	providerForCredential,
	listsDomains,
	listProviderZones,
	ZONE_LIST_DEADLINE_MS,
	PROVIDER_LIST,
	updaterFor,
} = await import("../lib/ddns/providers/index.js");

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
	linode: {
		fields: { dns_linode_key: TOKEN },
		host: "api.linode.com",
		headers: bearerOf(TOKEN),
		path: (page) => `/v4/domains?page=${page}&page_size=100`,
		body: (names, page = 1, total = 1) => ({
			data: names.map((domain) => ({ domain })),
			page,
			pages: total,
			results: names.length,
		}),
		perPage: 100,
	},
	// cursor paging: page N asks with the cursor "c<N-1>" the answer of page N-1 gave
	vultr: {
		fields: { dns_vultr_key: TOKEN },
		host: "api.vultr.com",
		headers: bearerOf(TOKEN),
		path: (page) => `/v2/domains?per_page=500${page === 1 ? "" : `&cursor=c${page - 1}`}`,
		body: (names, page = 1, total = 1) => ({
			domains: names.map((domain) => ({ domain })),
			meta: { total: names.length, links: { next: page < total ? `c${page}` : "", prev: "" } },
		}),
		perPage: 500,
	},
	// the Link header of the answer holds the cursor URL of the next page
	desec: {
		fields: { dns_desec_token: TOKEN },
		host: "desec.io",
		headers: { authorization: `Token ${TOKEN}` },
		path: (page) => `/api/v1/domains/${page === 1 ? "" : `?cursor=c${page - 1}`}`,
		body: (names) => names.map((name) => ({ name })),
		replyHeaders: (page, total) =>
			page < total ? { link: `<https://desec.io/api/v1/domains/?cursor=c${page}>; rel="next"` } : {},
		perPage: 500,
	},
};

const replyOf = (c, page, total) => ({ headers: { ...json.headers, ...c.replyHeaders?.(page, total) } });

const zoneNames = (from, count) =>
	Array.from({ length: count }, (_, i) => `z${String(from + i).padStart(4, "0")}.example.org`);

for (const [id, c] of Object.entries(CASES)) {
	it(`${id}: one page, sorted and normalized`, async () => {
		intercept(c.host, c.path(1), c.headers).reply(
			200,
			c.body(["b.example.org", "A.Example.com."]),
			replyOf(c, 1, 1),
		);
		assert.deepEqual(await run(id, c.fields), ["a.example.com", "b.example.org"]);
	});

	it(`${id}: two pages`, async () => {
		const first = zoneNames(1, c.perPage);
		const second = ["last.example.org"];
		intercept(c.host, c.path(1), c.headers).reply(200, c.body(first, 1, 2), replyOf(c, 1, 2));
		intercept(c.host, c.path(2), c.headers).reply(200, c.body(second, 2, 2), replyOf(c, 2, 2));
		const zones = await run(id, c.fields);
		assert.equal(zones.length, c.perPage + 1);
		assert.equal(zones.truncated, undefined);
	});

	it(`${id}: more than 1000 names are cut and marked truncated`, async () => {
		const total = Math.ceil(1100 / c.perPage);
		for (let page = 1; page <= total; page++) {
			const chunk = zoneNames((page - 1) * c.perPage, c.perPage);
			intercept(c.host, c.path(page), c.headers).reply(200, c.body(chunk, page, total), replyOf(c, page, total));
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

for (const id of ["linode", "vultr", "desec"]) {
	it(`${id}: a 401 is forbidden`, async () => {
		const c = CASES[id];
		intercept(c.host, c.path(1), c.headers).reply(401, { detail: "Invalid token." }, json);
		await assert.rejects(
			run(id, c.fields),
			(err) => err.code === "forbidden" && err.hint && err.providerStatus === 401,
		);
	});
}

it("linode, vultr: zone listing only, no DDNS updater", () => {
	for (const id of ["linode", "vultr"]) {
		assert.equal(updaterFor(id), null);
		assert.equal(listsDomains(id), true);
		assert.ok(!PROVIDER_LIST.some((p) => p.id === id));
	}
});

it("desec: a cursor URL of another host is refused without a second request", async () => {
	const c = CASES.desec;
	intercept(c.host, c.path(1), c.headers).reply(200, c.body(["a.example.org"]), {
		headers: { ...json.headers, link: '<https://evil.example/api/v1/domains/?cursor=x>; rel="next"' },
	});
	await assert.rejects(run("desec", c.fields), (err) => err.code === "failed");
});

it("desec: a custom endpoint is used for the list", async () => {
	mock.get("https://dns.example.org")
		.intercept({ path: "/v1/domains/", method: "GET" })
		.reply(200, [{ name: "x.example.org" }], json);
	assert.deepEqual(await run("desec", { ...CASES.desec.fields, dns_desec_endpoint: "https://dns.example.org/v1" }), [
		"x.example.org",
	]);
});

it("cloudflare: the global key group sends X-Auth-Email and X-Auth-Key", async () => {
	const fields = { dns_cloudflare_email: "me@example.org", dns_cloudflare_api_key: "globalkey-9999" };
	intercept("api.cloudflare.com", CASES.cloudflare.path(1), {
		"x-auth-email": "me@example.org",
		"x-auth-key": "globalkey-9999",
	}).reply(200, CASES.cloudflare.body(["g.example.org"]), json);
	assert.deepEqual(await run("cloudflare", fields, ["globalkey-9999"]), ["g.example.org"]);
});

for (const code of [9109, 10000, 9103, 9106, 6003, 6111]) {
	it(`cloudflare: success false with auth code ${code} is forbidden`, async () => {
		intercept("api.cloudflare.com", CASES.cloudflare.path(1), bearerOf(TOKEN)).reply(
			200,
			{ success: false, errors: [{ code, message: "Authentication error" }] },
			json,
		);
		await assert.rejects(
			run("cloudflare", CASES.cloudflare.fields),
			(err) => err.code === "forbidden" && err.hint === "Zone Read",
		);
	});
}

it("cloudflare: success false with another code is failed and scrubbed", async () => {
	intercept("api.cloudflare.com", CASES.cloudflare.path(1), bearerOf(TOKEN)).reply(
		200,
		{ success: false, errors: [{ code: 1000, message: `broken ${TOKEN}` }] },
		json,
	);
	await assert.rejects(
		run("cloudflare", CASES.cloudflare.fields),
		(err) => err.code === "failed" && !err.hint && !err.message.includes(TOKEN),
	);
});

it("cloudflare: a 401 is forbidden", async () => {
	intercept("api.cloudflare.com", CASES.cloudflare.path(1), bearerOf(TOKEN)).reply(401, { success: false }, json);
	await assert.rejects(run("cloudflare", CASES.cloudflare.fields), (err) => err.code === "forbidden");
});

it("a provider that always says there is a next page stops after 25 requests with truncated", async () => {
	const c = CASES.digitalocean;
	for (let page = 1; page <= 25; page++) {
		intercept(c.host, c.path(page), c.headers).reply(200, c.body([`p${page}.example.org`], 1, 99), json);
	}
	const zones = await run("digitalocean", c.fields);
	assert.equal(zones.length, 25);
	assert.equal(zones.truncated, true);
	mock.assertNoPendingInterceptors();
});

it("a page that repeats the previous one stops paging with truncated", async () => {
	const h = CASES["hetzner-cloud"];
	intercept(h.host, h.path(1), h.headers).reply(200, h.body(["a.example.org"], 1, 9), json);
	intercept(h.host, h.path(2), h.headers).reply(200, h.body(["a.example.org"], 2, 9), json);
	const zones = await run("hetzner-cloud", h.fields);
	assert.deepEqual([...zones], ["a.example.org"]);
	assert.equal(zones.truncated, true);
});

it("a 4.1 error (network) passes through", async () => {
	intercept("api.gandi.net", CASES.gandi.path(1), bearerOf(TOKEN)).replyWithError(new Error("boom"));
	await assert.rejects(run("gandi", CASES.gandi.fields), (err) => err.code === "network");
});

it("the registry is ordered and looks providers up", () => {
	assert.deepEqual(
		PROVIDERS.map((p) => p.id),
		[
			"cloudflare",
			"digitalocean",
			"hetzner-cloud",
			"gandi",
			"ovh",
			"desec",
			"duckdns",
			"porkbun",
			"namecheap",
			"noip",
			"dynu",
			"custom",
			"powerdns",
			"linode",
			"vultr",
		],
	);
	assert.equal(providerById("gandi").label, "Gandi");
	assert.equal(providerById("nope"), null);
	assert.equal(providerForCredential("hetzner-cloud").id, "hetzner-cloud");
	assert.equal(providerForCredential("route53"), null);
	assert.equal(listsDomains("cloudflare"), true);
	assert.equal(listsDomains("route53"), false);
});

const PDNS = {
	dns_pdns_endpoint: "https://pdns.example.org/",
	dns_pdns_api_key: TOKEN,
	dns_pdns_server_id: "localhost",
};
const pdnsHeaders = { "x-api-key": TOKEN };

it("powerdns: https endpoint, dots stripped, IDN as punycode, sorted", async () => {
	intercept("pdns.example.org", "/api/v1/servers/localhost/zones", pdnsHeaders).reply(
		200,
		[{ name: "b.example.org." }, { name: "bücher.example." }, { name: "a.example.org." }],
		json,
	);
	const zones = await run("powerdns", PDNS);
	assert.deepEqual([...zones], ["a.example.org", "b.example.org", "xn--bcher-kva.example"]);
	assert.equal(zones.truncated, undefined);
});

it("powerdns: an http LAN endpoint is allowed", async () => {
	mock.get("http://192.168.1.5:8081")
		.intercept({ path: "/api/v1/servers/localhost/zones", method: "GET", headers: pdnsHeaders })
		.reply(200, [{ name: "lan.example." }], json);
	const zones = await run("powerdns", { ...PDNS, dns_pdns_endpoint: "http://192.168.1.5:8081" });
	assert.deepEqual([...zones], ["lan.example"]);
});

it("powerdns: an http public endpoint is refused without a request", async () => {
	await assert.rejects(
		run("powerdns", { ...PDNS, dns_pdns_endpoint: "http://pdns.example.org:8081" }),
		(err) => err instanceof DdnsProviderError && err.code === "not-https",
	);
});

it("powerdns: a 401 is forbidden with the hint and the key scrubbed", async () => {
	intercept("pdns.example.org", "/api/v1/servers/localhost/zones", pdnsHeaders).reply(
		401,
		{ error: `Unauthorized ${TOKEN}` },
		json,
	);
	await assert.rejects(
		run("powerdns", PDNS),
		(err) => err.code === "forbidden" && err.hint.includes("api-allow-from") && !err.message.includes(TOKEN),
	);
});

it("powerdns: the server id is URL-encoded and an empty one means localhost", async () => {
	intercept("pdns.example.org", "/api/v1/servers/a%2Fb%20c/zones", pdnsHeaders).reply(200, [], json);
	assert.deepEqual([...(await run("powerdns", { ...PDNS, dns_pdns_server_id: "a/b c" }))], []);
	intercept("pdns.example.org", "/api/v1/servers/localhost/zones", pdnsHeaders).reply(200, [], json);
	assert.deepEqual([...(await run("powerdns", { ...PDNS, dns_pdns_server_id: "" }))], []);
});

it("powerdns: an endpoint that is not an http(s) URL is failed", async () => {
	for (const dns_pdns_endpoint of ["not a url", "ftp://pdns.example.org", undefined]) {
		await assert.rejects(
			run("powerdns", { ...PDNS, dns_pdns_endpoint }),
			(err) => err.code === "failed" && err.message === "The PowerDNS endpoint is not a URL",
		);
	}
});

it("powerdns: a non-array answer is failed", async () => {
	intercept("pdns.example.org", "/api/v1/servers/localhost/zones", pdnsHeaders).reply(200, { zones: [] }, json);
	await assert.rejects(run("powerdns", PDNS), (err) => err.code === "failed");
});

it("powerdns: the endpoint is read as certbot reads it", async () => {
	const cases = [
		["https://pdns.example.org/api/v1", "/api/v1/servers/localhost/zones"],
		["https://pdns.example.org/api/v1/", "/api/v1/servers/localhost/zones"],
		["https://pdns.example.org/pdns", "/pdns/api/v1/servers/localhost/zones"],
		["https://user:pw@pdns.example.org/?x=1#h", "/api/v1/servers/localhost/zones"],
	];
	for (const [dns_pdns_endpoint, path] of cases) {
		intercept("pdns.example.org", path, pdnsHeaders).reply(200, [], json);
		assert.deepEqual([...(await run("powerdns", { ...PDNS, dns_pdns_endpoint }))], []);
	}
	mock.assertNoPendingInterceptors();
});

it("one deadline covers every page of a list: past it, the list ends with code timeout", async () => {
	assert.equal(ZONE_LIST_DEADLINE_MS, 60_000);
	const cf = CASES.cloudflare;
	// each page answers in time on its own (10 s per call), the two together do not fit in 150 ms
	intercept(cf.host, cf.path(1), cf.headers)
		.reply(200, cf.body(["a.example"], 1, 2), json)
		.delay(100);
	intercept(cf.host, cf.path(2), cf.headers)
		.reply(200, cf.body(["b.example"], 2, 2), json)
		.delay(100);
	await assert.rejects(
		listProviderZones(providerById("cloudflare"), { fields: cf.fields, secrets: [TOKEN], deadlineMs: 150 }),
		(err) =>
			err instanceof DdnsProviderError &&
			err.code === "timeout" &&
			err.message === "The zone list did not finish within 0.15 s and was stopped",
	);
});

it("a list that ends before its deadline is returned, the secrets scrubbed from its errors", async () => {
	const cf = CASES.cloudflare;
	intercept(cf.host, cf.path(1), cf.headers).reply(200, cf.body(["a.example"]), json);
	assert.deepEqual(
		[...(await listProviderZones(providerById("cloudflare"), { fields: cf.fields, secrets: [TOKEN] }))],
		["a.example"],
	);
	intercept(cf.host, cf.path(1), cf.headers).reply(500, { errors: [{ message: `bad ${TOKEN}` }] }, json);
	await assert.rejects(
		listProviderZones(providerById("cloudflare"), { fields: cf.fields, secrets: [TOKEN] }),
		(err) => err.code === "failed" && !err.message.includes(TOKEN),
	);
});
