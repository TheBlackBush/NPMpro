import assert from "node:assert/strict";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { after, describe, it } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";

process.env.NPMPRO_TEST_ROOT = "/nonexistent-ddns-providers-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");
const { DdnsProviderError } = await import("../lib/ddns/errors.js");
const { PROVIDER_LIST, providerById, updaterFor } = await import("../lib/ddns/providers/index.js");

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
const call = (id, method, args, secrets = [TOKEN]) =>
	providerById(id)[method]({
		fetch: (url, options) => providerFetch(url, { ...options, secrets }),
		meta: {},
		...args,
	});
const api = (host) => mock.get(`https://${host}`);
const bodyIs = (expected) => (text) => text === JSON.stringify(expected);
const MORE_THAN_ONE = /more than one/u;
const REMOVED = /removed at the provider/u;
const LIST_PATH = `/1.0/domain/zone/example.com/record?${new URLSearchParams({ fieldType: "A", subDomain: "home" })}`;
const ANSWER_KO = /KO/u;
const REFRESH_FAILED = /zone refresh failed/u;
const BETWEEN = /between 300/u;
const cfRecords = (type, name, zoneId = "zid") =>
	`/client/v4/zones/${zoneId}/dns_records?type=${type}&name.exact=${name}`;
const bearerOf = { authorization: `Bearer ${TOKEN}` };

describe("registry", () => {
	it("lists the updater providers and finds them by credential provider", () => {
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.id),
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
			],
		);
		assert.deepEqual(PROVIDER_LIST[0], {
			id: "cloudflare",
			label: "Cloudflare",
			credential_provider: "cloudflare",
			record_types: ["A", "AAAA", "CNAME"],
			proxied: true,
			ipv6: true,
			ipv6_alone: true,
			admin_only: false,
			wildcards: true,
			aliases: true,
			zoneless: false,
			preset: false,
			zone: null,
			apex: true,
			min_ttl: 60,
		});
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.min_ttl),
			[60, 30, 60, 300, null, 3600, null, 600, null, null, null, null],
		);
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.aliases),
			[true, true, true, true, false, false, false, false, false, false, false, false],
		);
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.apex),
			[true, true, true, true, false, true, true, true, true, true, true, true],
		);
		assert.deepEqual(
			PROVIDER_LIST.filter((p) => !p.ipv6_alone).map((p) => p.id),
			["noip"],
		);
		assert.equal(PROVIDER_LIST.filter((p) => p.proxied).length, 1);
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.wildcards),
			[true, true, false, false, false, false, false, false, false, false, false, false],
		);
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.zoneless),
			[false, false, false, false, false, false, true, false, true, true, true, true],
		);
		assert.deepEqual(
			PROVIDER_LIST.filter((p) => p.preset).map((p) => [p.id, p.credential_provider, p.admin_only, p.zone]),
			[
				["namecheap", null, false, null],
				["noip", null, false, null],
				["dynu", null, false, null],
			],
		);
		assert.equal(PROVIDER_LIST[6].zone, "duckdns.org");
		assert.equal(updaterFor(null), null);
		assert.equal(updaterFor("gandi").id, "gandi");
		assert.equal(updaterFor("ovh").id, "ovh");
		assert.equal(updaterFor("powerdns"), null);
		assert.equal(updaterFor("acmedns"), null);
	});
});

describe("cloudflare", () => {
	const fields = { dns_cloudflare_api_token: TOKEN };
	const base = { zone: "example.com", name: "home.example.com", type: "A", fields };

	it("looks the zone id up once, reads with name.exact and returns proxied", async () => {
		api("api.cloudflare.com")
			.intercept({ path: "/client/v4/zones?name=example.com", method: "GET", headers: bearerOf })
			.reply(200, { success: true, result: [{ id: "zid" }] }, json);
		api("api.cloudflare.com")
			.intercept({
				path: cfRecords("A", "home.example.com"),
				method: "GET",
				headers: bearerOf,
			})
			.reply(200, { success: true, result: [{ id: "r1", content: "1.2.3.4", ttl: 1, proxied: true }] }, json);
		const found = await call("cloudflare", "read", base);
		assert.deepEqual(found, {
			values: ["1.2.3.4"],
			ttl: 1,
			proxied: true,
			meta: { zone_id: "zid", record_id: "r1", proxied: true },
		});
		// the cached zone id: no zone lookup now
		api("api.cloudflare.com")
			.intercept({ path: cfRecords("A", "home.example.com"), method: "GET" })
			.reply(200, { success: true, result: [] }, json);
		assert.equal(await call("cloudflare", "read", { ...base, meta: found.meta }), null);
		mock.assertNoPendingInterceptors();
	});

	it("reads a wildcard with the full name, a CNAME without its trailing dot, and two values", async () => {
		api("api.cloudflare.com")
			.intercept({
				path: cfRecords("CNAME", "*.example.com"),
				method: "GET",
			})
			.reply(200, { success: true, result: [{ id: "c1", content: "Target.Example.net.", ttl: 300 }] }, json);
		const alias = await call("cloudflare", "read", {
			...base,
			name: "*.example.com",
			type: "CNAME",
			meta: { zone_id: "zid" },
		});
		assert.deepEqual(alias.values, ["target.example.net"]);
		assert.equal(alias.proxied, false);
		api("api.cloudflare.com")
			.intercept({ path: cfRecords("A", "home.example.com"), method: "GET" })
			.reply(
				200,
				{
					success: true,
					result: [
						{ id: "a", content: "1.1.1.1" },
						{ id: "b", content: "2.2.2.2" },
					],
				},
				json,
			);
		const two = await call("cloudflare", "read", { ...base, meta: { zone_id: "zid" } });
		assert.deepEqual(two.values, ["1.1.1.1", "2.2.2.2"]);
		assert.equal(two.ttl, null);
	});

	it("PATCH sends only content, and ttl when set, never proxied", async () => {
		const patch = (expected) =>
			api("api.cloudflare.com")
				.intercept({
					path: "/client/v4/zones/zid/dns_records/r1",
					method: "PATCH",
					headers: bearerOf,
					body: bodyIs(expected),
				})
				.reply(200, { success: true, result: { id: "r1" } }, json);
		patch({ content: "5.6.7.8" });
		patch({ content: "5.6.7.8", ttl: 120 });
		const existing = { values: ["1.2.3.4"], ttl: 1, proxied: true, meta: { zone_id: "zid", record_id: "r1" } };
		const args = { ...base, ip: "5.6.7.8", existing, meta: existing.meta };
		assert.deepEqual(await call("cloudflare", "write", args), {
			meta: { zone_id: "zid", record_id: "r1" },
			created: false,
		});
		const plain = { ...existing, proxied: false, meta: { zone_id: "zid", record_id: "r1" } };
		await call("cloudflare", "write", { ...args, ttl: 120, existing: plain, meta: plain.meta });
		mock.assertNoPendingInterceptors();
	});

	it("never PATCHes without a record id", async () => {
		await assert.rejects(
			call("cloudflare", "write", {
				...base,
				ip: "5.6.7.8",
				existing: { values: ["1.2.3.4"], ttl: 1, meta: {} },
				meta: { zone_id: "zid" },
			}),
			(err) => err.code === "failed" && err.retry === true && err.message.includes("record id"),
		);
	});

	it("does not send ttl for a proxied record", async () => {
		api("api.cloudflare.com")
			.intercept({
				path: "/client/v4/zones/zid/dns_records/r1",
				method: "PATCH",
				body: bodyIs({ content: "5.6.7.8" }),
			})
			.reply(200, { success: true, result: { id: "r1" } }, json);
		const meta = { zone_id: "zid", record_id: "r1", proxied: true };
		const done = await call("cloudflare", "write", {
			...base,
			ip: "5.6.7.8",
			ttl: 120,
			existing: { values: ["1.2.3.4"], ttl: 1, proxied: true, meta },
			meta,
		});
		assert.equal(done.created, false);
		mock.assertNoPendingInterceptors();
	});

	it("drops a cached zone id that answers 404 and looks the zone up again", async () => {
		api("api.cloudflare.com")
			.intercept({ path: cfRecords("A", "home.example.com", "old"), method: "GET" })
			.reply(404, { success: false, errors: [{ message: "zone gone" }] }, json);
		api("api.cloudflare.com")
			.intercept({ path: "/client/v4/zones?name=example.com", method: "GET" })
			.reply(200, { success: true, result: [{ id: "fresh" }] }, json);
		api("api.cloudflare.com")
			.intercept({ path: cfRecords("A", "home.example.com", "fresh"), method: "GET" })
			.reply(200, { success: true, result: [{ id: "r2", content: "9.9.9.9", ttl: 1 }] }, json);
		const found = await call("cloudflare", "read", { ...base, meta: { zone_id: "old", record_id: "x" } });
		assert.equal(found.meta.zone_id, "fresh");
		assert.equal(found.meta.record_id, "r2");
		mock.assertNoPendingInterceptors();
	});

	it("a 404 for a freshly looked up zone id is a missing zone, not retried", async () => {
		api("api.cloudflare.com")
			.intercept({ path: "/client/v4/zones?name=example.com", method: "GET" })
			.reply(200, { success: true, result: [{ id: "zid" }] }, json);
		api("api.cloudflare.com")
			.intercept({ path: cfRecords("A", "home.example.com"), method: "GET" })
			.reply(404, { success: false }, json);
		await assert.rejects(call("cloudflare", "read", base), (err) => err.retry === false);
	});

	it("creates with proxied false and ttl 1, using the global key headers", async () => {
		const globalKey = { dns_cloudflare_email: "a@b.c", dns_cloudflare_api_key: TOKEN };
		const headers = { "x-auth-email": "a@b.c", "x-auth-key": TOKEN };
		api("api.cloudflare.com")
			.intercept({ path: "/client/v4/zones?name=example.com", method: "GET", headers })
			.reply(200, { success: true, result: [{ id: "zid" }] }, json);
		api("api.cloudflare.com")
			.intercept({
				path: "/client/v4/zones/zid/dns_records",
				method: "POST",
				headers,
				body: bodyIs({ type: "A", name: "home.example.com", content: "5.6.7.8", ttl: 1, proxied: false }),
			})
			.reply(200, { success: true, result: { id: "new" } }, json);
		const done = await call("cloudflare", "write", { ...base, fields: globalKey, ip: "5.6.7.8", existing: null });
		assert.deepEqual(done, { meta: { zone_id: "zid", record_id: "new" }, created: true });
	});

	it("refuses to write a record set with two values", async () => {
		await assert.rejects(
			call("cloudflare", "write", { ...base, ip: "5.6.7.8", existing: { values: ["1.1.1.1", "2.2.2.2"] } }),
			(err) => err.code === "failed" && err.retry === false,
		);
	});

	it("a zone that is not found is not retried", async () => {
		api("api.cloudflare.com")
			.intercept({ path: "/client/v4/zones?name=example.com", method: "GET" })
			.reply(200, { success: true, result: [] }, json);
		await assert.rejects(
			call("cloudflare", "read", base),
			(err) => err instanceof DdnsProviderError && err.retry === false,
		);
	});

	it("a 403 that echoes the token is forbidden, not retried and scrubbed", async () => {
		api("api.cloudflare.com")
			.intercept({ path: "/client/v4/zones?name=example.com", method: "GET" })
			.reply(403, { success: false, errors: [{ message: `denied ${TOKEN}` }] }, json);
		await assert.rejects(call("cloudflare", "read", base), (err) => {
			assert.equal(err.code, "forbidden");
			assert.equal(err.retry, false);
			assert.ok(!err.message.includes(TOKEN));
			assert.ok(err.message.includes("***"));
			return true;
		});
	});

	it("a 500 is retried", async () => {
		api("api.cloudflare.com")
			.intercept({ path: "/client/v4/zones?name=example.com", method: "GET" })
			.reply(500, "boom");
		await assert.rejects(call("cloudflare", "read", base), (err) => err.code === "failed" && err.retry === true);
	});
});

describe("digitalocean", () => {
	const fields = { dns_digitalocean_token: TOKEN };
	const base = { zone: "example.com", name: "home.example.com", type: "A", fields };
	const records = (host, type = "A") =>
		api("api.digitalocean.com").intercept({
			path: `/v2/domains/example.com/records?type=${type}&name=${host}`,
			method: "GET",
			headers: bearerOf,
		});

	it("reads by full name and type", async () => {
		records("home.example.com").reply(
			200,
			{ domain_records: [{ id: 7, type: "A", name: "home", data: "1.2.3.4", ttl: 300 }] },
			json,
		);
		assert.deepEqual(await call("digitalocean", "read", base), {
			values: ["1.2.3.4"],
			ttl: 300,
			meta: { record_id: 7 },
		});
		records("home.example.com").reply(200, { domain_records: [] }, json);
		assert.equal(await call("digitalocean", "read", base), null);
	});

	it("reads a wildcard with the full name and a CNAME data value in its three spellings", async () => {
		records("*.example.com", "CNAME").reply(
			200,
			{ domain_records: [{ id: 1, type: "CNAME", data: "Target.Example.net." }] },
			json,
		);
		const full = await call("digitalocean", "read", { ...base, name: "*.example.com", type: "CNAME" });
		assert.deepEqual(full.values, ["target.example.net"]);
		records("home.example.com", "CNAME").reply(
			200,
			{ domain_records: [{ id: 1, type: "CNAME", data: "@" }] },
			json,
		);
		assert.deepEqual((await call("digitalocean", "read", { ...base, type: "CNAME" })).values, ["example.com"]);
		records("home.example.com", "CNAME").reply(
			200,
			{ domain_records: [{ id: 1, type: "CNAME", data: "www" }] },
			json,
		);
		assert.deepEqual((await call("digitalocean", "read", { ...base, type: "CNAME" })).values, ["www.example.com"]);
		records("home.example.com", "CNAME").reply(
			200,
			{ domain_records: [{ id: 1, type: "CNAME", data: "target.example.net" }] },
			json,
		);
		assert.deepEqual((await call("digitalocean", "read", { ...base, type: "CNAME" })).values, [
			"target.example.net",
		]);
	});

	it("PATCH sends data, and ttl when set; a CNAME target gets a trailing dot", async () => {
		const patch = (expected) =>
			api("api.digitalocean.com")
				.intercept({
					path: "/v2/domains/example.com/records/7",
					method: "PATCH",
					headers: bearerOf,
					body: bodyIs(expected),
				})
				.reply(200, { domain_record: { id: 7 } }, json);
		patch({ data: "5.6.7.8" });
		patch({ data: "5.6.7.8", ttl: 60 });
		patch({ data: "target.example.net." });
		const existing = { values: ["1.2.3.4"], ttl: 300, meta: { record_id: 7 } };
		const args = { ...base, ip: "5.6.7.8", existing, meta: existing.meta };
		assert.deepEqual(await call("digitalocean", "write", args), { meta: { record_id: 7 }, created: false });
		await call("digitalocean", "write", { ...args, ttl: 60 });
		await call("digitalocean", "write", { ...args, type: "CNAME", ip: "Target.Example.net" });
		mock.assertNoPendingInterceptors();
	});

	it("creates with the relative name: host, apex @ and wildcard *", async () => {
		const create = (expected) =>
			api("api.digitalocean.com")
				.intercept({
					path: "/v2/domains/example.com/records",
					method: "POST",
					headers: bearerOf,
					body: bodyIs(expected),
				})
				.reply(201, { domain_record: { id: 9 } }, json);
		create({ type: "A", name: "home", data: "5.6.7.8" });
		create({ type: "AAAA", name: "@", data: "2a00::1", ttl: 120 });
		create({ type: "A", name: "*", data: "5.6.7.8" });
		const make = (extra) => call("digitalocean", "write", { ...base, ip: "5.6.7.8", existing: null, ...extra });
		assert.deepEqual(await make({}), { meta: { record_id: 9 }, created: true });
		await make({ name: "example.com", type: "AAAA", ip: "2a00::1", ttl: 120 });
		await make({ name: "*.example.com" });
		mock.assertNoPendingInterceptors();
	});

	it("errors: 404 is a missing zone (not retried), 403 scrubbed, 500 retried", async () => {
		records("home.example.com").reply(404, { message: "not found" }, json);
		await assert.rejects(call("digitalocean", "read", base), (err) => err.retry === false);
		records("home.example.com").reply(403, { message: `no ${TOKEN}` }, json);
		await assert.rejects(call("digitalocean", "read", base), (err) => {
			assert.equal(err.code, "forbidden");
			assert.equal(err.retry, false);
			assert.ok(!err.message.includes(TOKEN));
			return true;
		});
		records("home.example.com").reply(500, "boom");
		await assert.rejects(call("digitalocean", "read", base), (err) => err.retry === true);
	});

	it("a 404 on the PATCH is a record removed at the provider, retried", async () => {
		api("api.digitalocean.com")
			.intercept({ path: "/v2/domains/example.com/records/7", method: "PATCH" })
			.reply(404, { message: "gone" }, json);
		const existing = { values: ["1.2.3.4"], ttl: 300, meta: { record_id: 7 } };
		await assert.rejects(
			call("digitalocean", "write", { ...base, ip: "5.6.7.8", existing, meta: existing.meta }),
			(err) => err.code === "failed" && err.retry === true && err.message.includes("removed at the provider"),
		);
	});

	it("returns both values of a two-value set and refuses to write it", async () => {
		records("home.example.com").reply(
			200,
			{
				domain_records: [
					{ id: 1, type: "A", data: "1.1.1.1" },
					{ id: 2, type: "A", data: "2.2.2.2" },
				],
			},
			json,
		);
		const two = await call("digitalocean", "read", base);
		assert.deepEqual(two.values, ["1.1.1.1", "2.2.2.2"]);
		await assert.rejects(call("digitalocean", "write", { ...base, ip: "3.3.3.3", existing: two }), MORE_THAN_ONE);
	});
});

describe("hetzner-cloud", () => {
	const fields = { dns_hetzner_cloud_api_token: TOKEN };
	const base = { zone: "example.com", name: "home.example.com", type: "A", fields };
	const rrset = (rr, type = "A") => `/v1/zones/example.com/rrsets/${rr}/${type}`;
	const host = () => api("api.hetzner.cloud");

	it("reads the rrset with the apex as @, and 404 is missing", async () => {
		host()
			.intercept({ path: rrset("home"), method: "GET", headers: bearerOf })
			.reply(200, { rrset: { records: [{ value: "1.2.3.4" }], ttl: 600 } }, json);
		assert.deepEqual(await call("hetzner-cloud", "read", base), { values: ["1.2.3.4"], ttl: 600, meta: {} });
		host()
			.intercept({ path: rrset("@", "AAAA"), method: "GET" })
			.reply(200, { rrset: { records: [{ value: "a" }, { value: "b" }], ttl: null } }, json);
		const apex = await call("hetzner-cloud", "read", { ...base, name: "example.com", type: "AAAA" });
		assert.deepEqual(apex.values, ["a", "b"]);
		assert.equal(apex.ttl, null);
		host()
			.intercept({ path: rrset("home"), method: "GET" })
			.reply(404, { error: { code: "not_found" } }, json);
		assert.equal(await call("hetzner-cloud", "read", base), null);
	});

	it("set_records, then change_ttl with the old ttl when the re-read differs", async () => {
		host()
			.intercept({
				path: `${rrset("home")}/actions/set_records`,
				method: "POST",
				headers: bearerOf,
				body: bodyIs({ records: [{ value: "5.6.7.8" }] }),
			})
			.reply(201, { action: { id: 1 } }, json);
		host()
			.intercept({ path: rrset("home"), method: "GET" })
			.reply(200, { rrset: { records: [{ value: "5.6.7.8" }], ttl: 10_800 } }, json);
		host()
			.intercept({
				path: `${rrset("home")}/actions/change_ttl`,
				method: "POST",
				body: bodyIs({ ttl: 600 }),
			})
			.reply(201, { action: { id: 2 } }, json);
		const existing = { values: ["1.2.3.4"], ttl: 600, meta: {} };
		const done = await call("hetzner-cloud", "write", { ...base, ip: "5.6.7.8", existing });
		assert.deepEqual(done, { meta: {}, created: false });
		mock.assertNoPendingInterceptors();
	});

	it("a 404 on set_records is the zone-not-found path", async () => {
		host()
			.intercept({ path: `${rrset("home")}/actions/set_records`, method: "POST" })
			.reply(404, { error: { code: "not_found" } }, json);
		const existing = { values: ["1.2.3.4"], ttl: 600, meta: {} };
		await assert.rejects(
			call("hetzner-cloud", "write", { ...base, ip: "5.6.7.8", existing }),
			(err) => err.retry === false && err.message.includes("check the credential"),
		);
	});

	it("keeps no change_ttl call when the ttl survived; a set ttl is applied", async () => {
		const set = () =>
			host()
				.intercept({ path: `${rrset("home")}/actions/set_records`, method: "POST" })
				.reply(201, { action: { id: 1 } }, json);
		set();
		host()
			.intercept({ path: rrset("home"), method: "GET" })
			.reply(200, { rrset: { records: [{ value: "5.6.7.8" }], ttl: 600 } }, json);
		const existing = { values: ["1.2.3.4"], ttl: 600, meta: {} };
		const kept = await call("hetzner-cloud", "write", { ...base, ip: "5.6.7.8", existing });
		assert.equal(kept.created, false);
		set();
		host()
			.intercept({ path: rrset("home"), method: "GET" })
			.reply(200, { rrset: { records: [{ value: "5.6.7.8" }], ttl: 600 } }, json);
		host()
			.intercept({ path: `${rrset("home")}/actions/change_ttl`, method: "POST", body: bodyIs({ ttl: 120 }) })
			.reply(201, { action: { id: 2 } }, json);
		await call("hetzner-cloud", "write", { ...base, ip: "5.6.7.8", existing, ttl: 120 });
		mock.assertNoPendingInterceptors();
	});

	it("creates an rrset with the relative name (ttl only when set), a CNAME with a trailing dot", async () => {
		const create = (expected) =>
			host()
				.intercept({
					path: "/v1/zones/example.com/rrsets",
					method: "POST",
					headers: bearerOf,
					body: bodyIs(expected),
				})
				.reply(201, { rrset: {} }, json);
		create({ name: "home", type: "A", records: [{ value: "5.6.7.8" }] });
		create({ name: "home", type: "CNAME", records: [{ value: "target.example.net." }], ttl: 300 });
		assert.deepEqual(await call("hetzner-cloud", "write", { ...base, ip: "5.6.7.8", existing: null }), {
			meta: {},
			created: true,
		});
		await call("hetzner-cloud", "write", {
			...base,
			type: "CNAME",
			ip: "target.example.net",
			ttl: 300,
			existing: null,
		});
		mock.assertNoPendingInterceptors();
	});

	it("refuses a wildcard name with a clear failed error, without a request", async () => {
		for (const method of ["read", "write"]) {
			await assert.rejects(
				call("hetzner-cloud", method, { ...base, name: "*.example.com", ip: "1.1.1.1" }),
				(err) => {
					assert.equal(err.code, "failed");
					assert.equal(err.message, "This provider does not support wildcard records");
					return true;
				},
			);
		}
	});

	it("errors: 403 scrubbed and not retried, 500 retried, two values reported", async () => {
		host()
			.intercept({ path: rrset("home"), method: "GET" })
			.reply(403, { error: { message: `no ${TOKEN}` } }, json);
		await assert.rejects(call("hetzner-cloud", "read", base), (err) => {
			assert.equal(err.retry, false);
			assert.ok(!err.message.includes(TOKEN));
			return true;
		});
		host()
			.intercept({ path: rrset("home"), method: "GET" })
			.reply(500, "boom");
		await assert.rejects(call("hetzner-cloud", "read", base), (err) => err.retry === true);
	});
});

describe("gandi", () => {
	const fields = { dns_gandi_token: TOKEN };
	const base = { zone: "example.com", name: "home.example.com", type: "A", fields };
	const rrset = (rr, type = "A") => `/v5/livedns/domains/example.com/records/${rr}/${type}`;
	const host = () => api("api.gandi.net");

	it("reads, 404 is missing, a CNAME loses its trailing dot", async () => {
		host()
			.intercept({ path: rrset("home"), method: "GET", headers: bearerOf })
			.reply(200, { rrset_values: ["1.2.3.4", "5.5.5.5"], rrset_ttl: 900 }, json);
		assert.deepEqual(await call("gandi", "read", base), { values: ["1.2.3.4", "5.5.5.5"], ttl: 900, meta: {} });
		host()
			.intercept({ path: rrset("home"), method: "GET" })
			.reply(404, { message: "no" }, json);
		assert.equal(await call("gandi", "read", base), null);
		host()
			.intercept({ path: rrset("home", "CNAME"), method: "GET" })
			.reply(200, { rrset_values: ["Target.Example.net."], rrset_ttl: 300 }, json);
		assert.deepEqual((await call("gandi", "read", { ...base, type: "CNAME" })).values, ["target.example.net"]);
	});

	it("PUTs the value and the ttl: kept, set, or 300 on a create", async () => {
		const put = (path, expected, status = 201) =>
			host()
				.intercept({ path, method: "PUT", headers: bearerOf, body: bodyIs(expected) })
				.reply(status, { message: "ok" }, json);
		put(rrset("home"), { rrset_values: ["5.6.7.8"], rrset_ttl: 900 }, 200);
		put(rrset("home"), { rrset_values: ["5.6.7.8"], rrset_ttl: 3600 });
		put(rrset("@"), { rrset_values: ["5.6.7.8"], rrset_ttl: 300 });
		put(rrset("home", "CNAME"), { rrset_values: ["target.example.net."], rrset_ttl: 300 });
		const existing = { values: ["1.2.3.4"], ttl: 900, meta: {} };
		assert.deepEqual(await call("gandi", "write", { ...base, ip: "5.6.7.8", existing }), {
			meta: {},
			created: false,
		});
		await call("gandi", "write", { ...base, ip: "5.6.7.8", existing, ttl: 3600 });
		assert.equal(
			(await call("gandi", "write", { ...base, name: "example.com", ip: "5.6.7.8", existing: null })).created,
			true,
		);
		await call("gandi", "write", { ...base, type: "CNAME", ip: "Target.Example.net", existing: null });
		mock.assertNoPendingInterceptors();
	});

	it("a 404 on the PUT is the zone-not-found path", async () => {
		host()
			.intercept({ path: rrset("home"), method: "PUT" })
			.reply(404, { message: "no zone" }, json);
		await assert.rejects(
			call("gandi", "write", { ...base, ip: "5.6.7.8", existing: null }),
			(err) => err.retry === false && err.message.includes("check the credential"),
		);
	});

	it("keeps the existing ttl even out of range, and checks only a ttl the user set", async () => {
		host()
			.intercept({
				path: rrset("home"),
				method: "PUT",
				body: bodyIs({ rrset_values: ["5.6.7.8"], rrset_ttl: 60 }),
			})
			.reply(200, { message: "ok" }, json);
		const done = await call("gandi", "write", {
			...base,
			ip: "5.6.7.8",
			existing: { values: ["1.2.3.4"], ttl: 60, meta: {} },
		});
		assert.equal(done.created, false);
		mock.assertNoPendingInterceptors();
	});

	it("refuses a ttl outside 300 to 2592000 and a wildcard, without a request", async () => {
		for (const ttl of [299, 2_592_001]) {
			await assert.rejects(call("gandi", "write", { ...base, ip: "5.6.7.8", existing: null, ttl }), BETWEEN);
		}
		await assert.rejects(
			call("gandi", "read", { ...base, name: "*.example.com" }),
			(err) => err.code === "failed" && err.message === "This provider does not support wildcard records",
		);
	});

	it("errors: 403 scrubbed and not retried, 500 retried, two values not written", async () => {
		host()
			.intercept({ path: rrset("home"), method: "GET" })
			.reply(403, { message: `no ${TOKEN}` }, json);
		await assert.rejects(call("gandi", "read", base), (err) => {
			assert.equal(err.code, "forbidden");
			assert.equal(err.retry, false);
			assert.ok(!err.message.includes(TOKEN));
			return true;
		});
		host()
			.intercept({ path: rrset("home"), method: "PUT" })
			.reply(500, "boom");
		await assert.rejects(
			call("gandi", "write", { ...base, ip: "5.6.7.8", existing: null }),
			(err) => err.retry === true,
		);
		await assert.rejects(
			call("gandi", "write", { ...base, ip: "5.6.7.8", existing: { values: ["1.1.1.1", "2.2.2.2"], ttl: 300 } }),
			MORE_THAN_ONE,
		);
	});
});

describe("ovh", () => {
	const SECRET = ["ovh", "app", "secret", "1234"].join("-");
	const CONSUMER = ["ovh", "consumer", "5678"].join("-");
	const ovhFields = {
		dns_ovh_endpoint: "ovh-eu",
		dns_ovh_application_key: "app-key",
		dns_ovh_application_secret: SECRET,
		dns_ovh_consumer_key: CONSUMER,
	};
	const secrets = [SECRET, CONSUMER];
	const base = { zone: "example.com", name: "home.example.com", type: "A", fields: ovhFields };
	const pool = () => api("eu.api.ovh.com");
	const run = (method, args) => call("ovh", method, args, secrets);
	const time = () => pool().intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "1700000000", json);
	const list = (ids) => {
		time();
		pool().intercept({ path: LIST_PATH, method: "GET" }).reply(200, ids, json);
	};
	const record = (id, target, ttl = 300, extra = {}) => {
		time();
		pool()
			.intercept({ path: `/1.0/domain/zone/example.com/record/${id}`, method: "GET" })
			.reply(200, { id, zone: "example.com", fieldType: "A", subDomain: "home", target, ttl, ...extra }, json);
	};
	const refresh = (status = 200) => {
		time();
		pool()
			.intercept({ path: "/1.0/domain/zone/example.com/refresh", method: "POST" })
			.reply(status, status === 200 ? "" : { message: `no ${SECRET}` }, json);
	};

	it("reads one record by type and sub domain", async () => {
		list([11]);
		record(11, "1.2.3.4");
		assert.deepEqual(await run("read", base), {
			values: ["1.2.3.4"],
			ttl: 300,
			meta: { record_id: 11, refresh_pending: false },
		});
		mock.assertNoPendingInterceptors();
	});

	it("reports every value of a multi-value set, and ignores a record of another name", async () => {
		list([11, 12, 13]);
		record(11, "1.2.3.4");
		record(12, "5.5.5.5", 0);
		record(13, "9.9.9.9", 300, { subDomain: "homer" });
		assert.deepEqual(await run("read", base), {
			values: ["1.2.3.4", "5.5.5.5"],
			ttl: 300,
			meta: { record_id: 11, refresh_pending: false },
		});
		list([]);
		assert.equal(await run("read", base), null);
	});

	it("updates the record and then refreshes the zone", async () => {
		time();
		pool()
			.intercept({
				path: "/1.0/domain/zone/example.com/record/11",
				method: "PUT",
				body: bodyIs({ target: "5.6.7.8", ttl: 600 }),
			})
			.reply(200, "", json);
		refresh();
		const done = await run("write", {
			...base,
			ip: "5.6.7.8",
			ttl: 600,
			existing: { values: ["1.2.3.4"], ttl: 300, meta: { record_id: 11 } },
			meta: { record_id: 11 },
		});
		assert.deepEqual(done, { meta: { record_id: 11, refresh_pending: false }, created: false });
		mock.assertNoPendingInterceptors();
	});

	it("is a failure when the refresh fails, with the secrets scrubbed", async () => {
		time();
		pool()
			.intercept({
				path: "/1.0/domain/zone/example.com/record/11",
				method: "PUT",
				body: bodyIs({ target: "5.6.7.8" }),
			})
			.reply(200, "", json);
		refresh(500);
		await assert.rejects(
			run("write", {
				...base,
				ip: "5.6.7.8",
				existing: { values: ["1.2.3.4"], ttl: 300 },
				meta: { record_id: 11 },
			}),
			(err) => {
				assert.equal(err.name, "DdnsProviderError");
				assert.equal(err.retry, true);
				assert.match(err.message, REFRESH_FAILED);
				assert.ok(!err.message.includes(SECRET));
				assert.ok(!err.message.includes(CONSUMER));
				assert.deepEqual(err.meta, { record_id: 11, refresh_pending: true });
				return true;
			},
		);
	});

	it("a pending refresh is done first by the next read and cleared; a failing one throws and keeps the flag", async () => {
		refresh(500);
		await assert.rejects(run("read", { ...base, meta: { refresh_pending: true } }), REFRESH_FAILED);
		refresh();
		list([11]);
		record(11, "1.2.3.4");
		const done = await run("read", { ...base, meta: { record_id: 11, refresh_pending: true } });
		assert.deepEqual(done.meta, { record_id: 11, refresh_pending: false });
		mock.assertNoPendingInterceptors();
	});

	it("a refresh that says 404 keeps the saved-but-not-refreshed message, a 404 on the PUT says the record is gone", async () => {
		time();
		pool()
			.intercept({ path: "/1.0/domain/zone/example.com/record/11", method: "PUT" })
			.reply(404, { message: "gone" }, json);
		await assert.rejects(
			run("write", {
				...base,
				ip: "5.6.7.8",
				existing: { values: ["1.2.3.4"], ttl: 300 },
				meta: { record_id: 11 },
			}),
			(err) => err.retry === true && err.message.includes("created again"),
		);
		time();
		pool().intercept({ path: "/1.0/domain/zone/example.com/record", method: "POST" }).reply(200, { id: 5 }, json);
		refresh(404);
		await assert.rejects(run("write", { ...base, ip: "5.6.7.8", existing: null }), REFRESH_FAILED);
	});

	it("creates the record and then refreshes the zone", async () => {
		time();
		pool()
			.intercept({
				path: "/1.0/domain/zone/example.com/record",
				method: "POST",
				body: bodyIs({ fieldType: "A", subDomain: "home", target: "5.6.7.8" }),
			})
			.reply(
				200,
				{ id: 77, fieldType: "A", subDomain: "home", target: "5.6.7.8", ttl: 0, zone: "example.com" },
				json,
			);
		refresh();
		assert.deepEqual(await run("write", { ...base, ip: "5.6.7.8", existing: null }), {
			meta: { record_id: 77, refresh_pending: false },
			created: true,
		});
		mock.assertNoPendingInterceptors();
	});

	it("does not refresh after a refused change, and a 403 is not retried", async () => {
		time();
		pool()
			.intercept({ path: "/1.0/domain/zone/example.com/record/11", method: "PUT" })
			.reply(403, { message: `no ${SECRET}` }, json);
		await assert.rejects(
			run("write", {
				...base,
				ip: "5.6.7.8",
				existing: { values: ["1.2.3.4"], ttl: 300 },
				meta: { record_id: 11 },
			}),
			(err) => {
				assert.equal(err.code, "forbidden");
				assert.equal(err.retry, false);
				assert.ok(!err.message.includes(SECRET));
				return true;
			},
		);
		time();
		pool().intercept({ path: LIST_PATH, method: "GET" }).reply(403, { message: "no" }, json);
		await assert.rejects(run("read", base), (err) => err.retry === false);
		mock.assertNoPendingInterceptors();
	});

	it("refuses wildcards, the apex and a record set with more than one value", async () => {
		const failed = (err) => err.code === "failed" && err.retry === false;
		await assert.rejects(run("read", { ...base, name: "*.example.com" }), failed);
		await assert.rejects(run("write", { ...base, name: "example.com", ip: "1.1.1.1", existing: null }), failed);
		await assert.rejects(
			run("write", { ...base, ip: "5.6.7.8", existing: { values: ["1.1.1.1", "2.2.2.2"], ttl: 300 } }),
			MORE_THAN_ONE,
		);
	});
});

describe("desec", () => {
	const DESEC_TOKEN = ["desec", "tok", "9876"].join("-");
	const desecFields = { dns_desec_token: DESEC_TOKEN };
	const secrets = [DESEC_TOKEN];
	const base = { zone: "example.com", name: "home.example.com", type: "A", fields: desecFields };
	const pool = () => api("desec.io");
	const run = (method, args) => call("desec", method, args, secrets);
	const RRSET = "/api/v1/domains/example.com/rrsets/home/A/";
	const authOk = { authorization: `Token ${DESEC_TOKEN}` };

	it("reads the RRset with the token header", async () => {
		pool()
			.intercept({ path: RRSET, method: "GET", headers: authOk })
			.reply(200, { subname: "home", type: "A", records: ["1.2.3.4"], ttl: 3600 }, json);
		assert.deepEqual(await run("read", base), { values: ["1.2.3.4"], ttl: 3600, meta: {} });
		mock.assertNoPendingInterceptors();
	});

	it("reads the apex as @ and reports every value of a multi-value set", async () => {
		pool()
			.intercept({ path: "/api/v1/domains/example.com/rrsets/@/A/", method: "GET" })
			.reply(200, { records: ["1.1.1.1", "2.2.2.2"], ttl: 7200 }, json);
		assert.deepEqual(await run("read", { ...base, name: "example.com" }), {
			values: ["1.1.1.1", "2.2.2.2"],
			ttl: 7200,
			meta: {},
		});
	});

	it("answers null for a missing RRset and creates it with a POST", async () => {
		pool().intercept({ path: RRSET, method: "GET" }).reply(404, { detail: "Not found." }, json);
		assert.equal(await run("read", base), null);
		pool()
			.intercept({
				path: "/api/v1/domains/example.com/rrsets/",
				method: "POST",
				body: bodyIs({ subname: "home", type: "A", records: ["5.6.7.8"], ttl: 3600 }),
			})
			.reply(201, { subname: "home" }, json);
		assert.deepEqual(await run("write", { ...base, ip: "5.6.7.8", existing: null }), { meta: {}, created: true });
		pool()
			.intercept({
				path: "/api/v1/domains/example.com/rrsets/",
				method: "POST",
				body: bodyIs({ type: "AAAA", records: ["2001:db8::1"], ttl: 7200 }),
			})
			.reply(201, {}, json);
		await run("write", {
			...base,
			name: "example.com",
			type: "AAAA",
			ip: "2001:db8::1",
			ttl: 7200,
			existing: null,
		});
		mock.assertNoPendingInterceptors();
	});

	it("changes an existing RRset with a PATCH that never empties the records", async () => {
		pool()
			.intercept({ path: RRSET, method: "PATCH", body: bodyIs({ records: ["5.6.7.8"], ttl: 7200 }) })
			.reply(200, {}, json);
		const existing = { values: ["1.2.3.4"], ttl: 3600 };
		assert.deepEqual(await run("write", { ...base, ip: "5.6.7.8", ttl: 7200, existing }), {
			meta: {},
			created: false,
		});
		pool()
			.intercept({ path: RRSET, method: "PATCH", body: bodyIs({ records: ["5.6.7.8"] }) })
			.reply(200, {}, json);
		await run("write", { ...base, ip: "5.6.7.8", existing });
		mock.assertNoPendingInterceptors();
	});

	it("a PATCH answered 404 (the RRset was deleted meanwhile) is a retried failure, not a missing zone", async () => {
		pool().intercept({ path: RRSET, method: "PATCH" }).reply(404, { detail: "Not found." }, json);
		await assert.rejects(
			run("write", { ...base, ip: "5.6.7.8", existing: { values: ["1.2.3.4"], ttl: 3600 } }),
			(err) => err.code === "failed" && err.retry !== false && REMOVED.test(err.message),
		);
		mock.assertNoPendingInterceptors();
	});

	it("refuses a record set with two values, a wildcard and a TTL under 3600", async () => {
		const failed = (err) => err.code === "failed" && err.retry === false;
		await assert.rejects(
			run("write", { ...base, ip: "5.6.7.8", existing: { values: ["1.1.1.1", "2.2.2.2"], ttl: 3600 } }),
			MORE_THAN_ONE,
		);
		await assert.rejects(run("read", { ...base, name: "*.example.com" }), failed);
		await assert.rejects(run("write", { ...base, ip: "5.6.7.8", ttl: 600, existing: null }), failed);
	});

	it("takes only an https endpoint that passes the guard", async () => {
		const custom = { ...desecFields, dns_desec_endpoint: "https://desec.example.net/custom/v1" };
		api("desec.example.net")
			.intercept({ path: "/custom/v1/domains/example.com/rrsets/home/A/", method: "GET" })
			.reply(404, {}, json);
		assert.equal(await run("read", { ...base, fields: custom }), null);
		const refused = (code) => (err) => err.code === code && err.retry === false;
		await assert.rejects(
			run("read", {
				...base,
				fields: { ...desecFields, dns_desec_endpoint: "http://desec.example.net/api/v1/" },
			}),
			refused("not-https"),
		);
		await assert.rejects(
			run("read", { ...base, fields: { ...desecFields, dns_desec_endpoint: "not a url" } }),
			refused("not-https"),
		);
		await assert.rejects(
			run("read", { ...base, fields: { ...desecFields, dns_desec_endpoint: "https://127.0.0.1/api/v1/" } }),
			refused("blocked"),
		);
	});

	it("reports a 401 as forbidden without the token, and never retries it", async () => {
		pool()
			.intercept({ path: RRSET, method: "GET" })
			.reply(401, { detail: `bad ${DESEC_TOKEN}` }, json);
		await assert.rejects(run("read", base), (err) => {
			assert.equal(err.code, "forbidden");
			assert.equal(err.retry, false);
			assert.ok(!err.message.includes(DESEC_TOKEN));
			return true;
		});
		pool()
			.intercept({ path: RRSET, method: "PATCH" })
			.reply(400, [{ ttl: [`low ${DESEC_TOKEN}`] }], json);
		await assert.rejects(
			run("write", { ...base, ip: "5.6.7.8", existing: { values: ["1.2.3.4"], ttl: 3600 } }),
			(err) => err.code === "failed" && !err.message.includes(DESEC_TOKEN),
		);
	});

	it("has no zone fetch", () => {
		assert.equal(providerById("desec").listZones, undefined);
	});
});

describe("duckdns", () => {
	// a token with characters that change when URL-encoded
	const DUCK_TOKEN = ["duck", "tok/+ab&cd=12 xyz"].join("-");
	const fields = { dns_duckdns_token: DUCK_TOKEN };
	const secrets = [DUCK_TOKEN];
	const base = { zone: "duckdns.org", name: "home.duckdns.org", type: "A", fields, ip: "5.6.7.8", existing: null };
	const run = (method, args) => call("duckdns", method, args, secrets);
	const encoded = encodeURIComponent(DUCK_TOKEN);
	const pathOf = (extra) => `/update?domains=home&token=${encoded}&${extra}&verbose=true`;
	const duck = () => api("www.duckdns.org");

	it("is a zoneless provider without a record read", async () => {
		const provider = providerById("duckdns");
		assert.equal(provider.zoneless, true);
		assert.equal(provider.zone, "duckdns.org");
		assert.equal(provider.listZones, undefined);
		assert.equal(await run("read", base), null);
		assert.equal(updaterFor("duckdns").id, "duckdns");
	});

	it("sends one GET with the subdomain, the token and the address, and takes OK as success", async () => {
		duck()
			.intercept({ path: pathOf("ip=5.6.7.8"), method: "GET" })
			.reply(200, "OK\n5.6.7.8\n\nUPDATED", { headers: { "content-type": "text/plain" } });
		assert.deepEqual(await run("write", base), { meta: {}, created: false });
		mock.assertNoPendingInterceptors();
	});

	it("sends an IPv6 address as ipv6", async () => {
		duck()
			.intercept({ path: pathOf(`ipv6=${encodeURIComponent("2001:db8::1")}`), method: "GET" })
			.reply(200, "OK\n\n2001:db8::1\nNOCHANGE");
		assert.deepEqual(await run("write", { ...base, type: "AAAA", ip: "2001:db8::1" }), {
			meta: {},
			created: false,
		});
		mock.assertNoPendingInterceptors();
	});

	it("takes KO as a refusal without a retry, and scrubs the token from the message", async () => {
		duck()
			.intercept({ path: pathOf("ip=5.6.7.8"), method: "GET" })
			.reply(200, "KO");
		await assert.rejects(
			run("write", base),
			(err) =>
				err.code === "forbidden" && err.retry === false && ANSWER_KO.test(err.message) && Boolean(err.hint),
		);
	});

	it("takes an empty body or any other first line as a retried failure", async () => {
		duck()
			.intercept({ path: pathOf("ip=5.6.7.8"), method: "GET" })
			.reply(200, "");
		await assert.rejects(run("write", base), (err) => err.code === "failed" && err.retry !== false);
		duck()
			.intercept({ path: pathOf("ip=5.6.7.8"), method: "GET" })
			.reply(200, "<html>maintenance</html>");
		await assert.rejects(run("write", base), (err) => err.code === "failed" && err.retry !== false);
		duck()
			.intercept({ path: pathOf("ip=5.6.7.8"), method: "GET" })
			.reply(502, "OK");
		await assert.rejects(run("write", base), (err) => err.code === "failed");
	});

	it("never lets the token into an error message, plain, URL-encoded or echoed by the answer", async () => {
		const echoes = [`KO ${DUCK_TOKEN}`, `bad ${encoded}`, `bad ${encoded.replaceAll("%20", "+")}`];
		for (const body of echoes) {
			duck()
				.intercept({ path: pathOf("ip=5.6.7.8"), method: "GET" })
				.reply(200, body);
			await assert.rejects(run("write", base), (err) => {
				assert.ok(err.message.includes("***"), err.message);
				return !err.message.includes(DUCK_TOKEN) && !err.message.includes(encoded);
			});
		}
		duck()
			.intercept({ path: pathOf("ip=5.6.7.8"), method: "GET" })
			.replyWithError(Object.assign(new Error(`connect failed ${DUCK_TOKEN}`), { code: "ECONNRESET" }));
		await assert.rejects(run("write", base), (err) => {
			assert.ok(!err.message.includes(DUCK_TOKEN) && !err.message.includes(encoded), err.message);
			return err.code === "network";
		});
	});

	it("refuses a wildcard name", async () => {
		await assert.rejects(
			run("write", { ...base, name: "*.home.duckdns.org" }),
			(err) => err.code === "failed" && err.retry === false,
		);
	});
});

describe("porkbun", () => {
	const KEY = ["pk1", "key", "4321"].join("-");
	const SECRET = ["sk1", "secret", "8765"].join("-");
	const pbFields = { dns_porkbun_key: KEY, dns_porkbun_secret: SECRET };
	const secrets = [KEY, SECRET];
	const base = { zone: "example.com", name: "home.example.com", type: "A", fields: pbFields };
	const pool = () => api("api.porkbun.com");
	const run = (method, args) => call("porkbun", method, args, secrets);
	const auth = { apikey: KEY, secretapikey: SECRET };
	const READ = "/api/json/v3/dns/retrieveByNameType/example.com/A/home";
	const EDIT = "/api/json/v3/dns/editByNameType/example.com/A/home";
	const record = (over = {}) => ({
		id: "111",
		name: "home.example.com",
		type: "A",
		content: "1.2.3.4",
		ttl: "600",
		prio: null,
		...over,
	});

	it("reads with both credentials in the body", async () => {
		pool()
			.intercept({ path: READ, method: "POST", body: bodyIs(auth) })
			.reply(200, { status: "SUCCESS", records: [record()] }, json);
		assert.deepEqual(await run("read", base), { values: ["1.2.3.4"], ttl: 600, meta: { record_id: "111" } });
		mock.assertNoPendingInterceptors();
	});

	it("reads the apex without a subdomain, reports two values, and answers null for no record", async () => {
		pool()
			.intercept({ path: "/api/json/v3/dns/retrieveByNameType/example.com/A", method: "POST" })
			.reply(
				200,
				{
					status: "SUCCESS",
					records: [
						record({ name: "example.com", id: 5 }),
						record({ name: "example.com", content: "2.2.2.2" }),
					],
				},
				json,
			);
		const apex = await run("read", { ...base, name: "example.com" });
		assert.deepEqual(apex.values, ["1.2.3.4", "2.2.2.2"]);
		assert.equal(apex.meta.record_id, 5);
		pool().intercept({ path: READ, method: "POST" }).reply(200, { status: "SUCCESS", records: [] }, json);
		assert.equal(await run("read", base), null);
	});

	it("edits by name and type with content and ttl only, keeping the record's own TTL", async () => {
		pool()
			.intercept({ path: EDIT, method: "POST", body: bodyIs({ ...auth, content: "5.6.7.8", ttl: 900 }) })
			.reply(200, { status: "SUCCESS" }, json);
		const existing = { values: ["1.2.3.4"], ttl: 600 };
		assert.deepEqual(await run("write", { ...base, ip: "5.6.7.8", ttl: 900, existing }), {
			meta: {},
			created: false,
		});
		pool()
			.intercept({ path: EDIT, method: "POST", body: bodyIs({ ...auth, content: "5.6.7.8", ttl: 600 }) })
			.reply(200, { status: "SUCCESS" }, json);
		await run("write", { ...base, ip: "5.6.7.8", existing });
		mock.assertNoPendingInterceptors();
	});

	it("creates a missing record and keeps the numeric id", async () => {
		pool()
			.intercept({
				path: "/api/json/v3/dns/create/example.com",
				method: "POST",
				body: bodyIs({ ...auth, type: "A", name: "home", content: "5.6.7.8", ttl: 600 }),
			})
			.reply(200, { status: "SUCCESS", id: 42 }, json);
		assert.deepEqual(await run("write", { ...base, ip: "5.6.7.8", ttl: 600, existing: null }), {
			meta: { record_id: 42 },
			created: true,
		});
		pool()
			.intercept({
				path: "/api/json/v3/dns/create/example.com",
				method: "POST",
				body: bodyIs({ ...auth, type: "AAAA", content: "2001:db8::1" }),
			})
			.reply(200, { status: "SUCCESS", id: 43, warnings: ["not delegated"] }, json);
		await run("write", { ...base, name: "example.com", type: "AAAA", ip: "2001:db8::1", existing: null });
		mock.assertNoPendingInterceptors();
	});

	it("refuses two values, a wildcard and a TTL under 600, and treats a missing record as removed", async () => {
		const failed = (err) => err.code === "failed" && err.retry === false;
		await assert.rejects(
			run("write", { ...base, ip: "5.6.7.8", existing: { values: ["1.1.1.1", "2.2.2.2"], ttl: 600 } }),
			MORE_THAN_ONE,
		);
		await assert.rejects(run("read", { ...base, name: "*.example.com" }), failed);
		await assert.rejects(run("write", { ...base, ip: "5.6.7.8", ttl: 300, existing: null }), failed);
		pool()
			.intercept({ path: EDIT, method: "POST" })
			.reply(400, { status: "ERROR", message: "Could not find record to edit." }, json);
		await assert.rejects(
			run("write", { ...base, ip: "5.6.7.8", existing: { values: ["1.2.3.4"], ttl: 600 } }),
			(err) => err.code === "failed" && err.retry !== false && REMOVED.test(err.message),
		);
	});

	it("reports an ERROR status and a 403 without either secret", async () => {
		pool()
			.intercept({ path: READ, method: "POST" })
			.reply(400, { status: "ERROR", code: "INVALID_API_KEYS_001", message: `bad ${KEY} ${SECRET}` }, json);
		await assert.rejects(run("read", base), (err) => {
			assert.equal(err.code, "forbidden");
			assert.equal(err.retry, false);
			assert.ok(!err.message.includes(KEY) && !err.message.includes(SECRET));
			return true;
		});
		pool()
			.intercept({ path: READ, method: "POST" })
			.reply(200, { status: "ERROR", message: `odd ${SECRET}` }, json);
		await assert.rejects(run("read", base), (err) => err.code === "failed" && !err.message.includes(SECRET));
		pool()
			.intercept({ path: "/api/json/v3/dns/create/example.com", method: "POST" })
			.reply(403, `denied ${KEY}`, { headers: { "content-type": "text/plain" } });
		await assert.rejects(run("write", { ...base, ip: "5.6.7.8", existing: null }), (err) => {
			assert.equal(err.code, "forbidden");
			assert.ok(!err.message.includes(KEY));
			return true;
		});
	});

	it("reads the error code before a missing record", async () => {
		const existing = { values: ["1.2.3.4"], ttl: 600 };
		const w = () => run("write", { ...base, ip: "5.6.7.8", existing });
		pool().intercept({ path: EDIT, method: "POST" }).reply(404, { status: "ERROR", message: "gone" }, json);
		await assert.rejects(w(), (err) => err.retry !== false && REMOVED.test(err.message));
		pool()
			.intercept({ path: EDIT, method: "POST" })
			.reply(400, { status: "ERROR", code: "INVALID_DOMAIN", message: "Invalid domain." }, json);
		await assert.rejects(w(), (err) => err.retry === false && err.code === "failed" && !REMOVED.test(err.message));
		pool()
			.intercept({ path: EDIT, method: "POST" })
			.reply(400, { status: "ERROR", code: "INVALID_API_KEYS_001", message: "Key not found" }, json);
		await assert.rejects(w(), (err) => err.code === "forbidden" && err.retry === false);
		pool()
			.intercept({ path: EDIT, method: "POST" })
			.reply(400, { status: "ERROR", code: "ZONE_RECORD_LIMIT", message: "Limit reached" }, json);
		await assert.rejects(w(), (err) => err.code === "failed" && err.retry !== false && !REMOVED.test(err.message));
		mock.assertNoPendingInterceptors();
	});

	it("edits the apex without a subdomain in the URL", async () => {
		pool()
			.intercept({ path: "/api/json/v3/dns/editByNameType/example.com/A", method: "POST" })
			.reply(200, { status: "SUCCESS" }, json);
		const done = await run("write", {
			...base,
			name: "example.com",
			ip: "5.6.7.8",
			existing: { values: ["1.2.3.4"], ttl: null },
		});
		assert.equal(done.created, false);
		mock.assertNoPendingInterceptors();
	});

	it("keeps only the records of the asked name and type", async () => {
		pool()
			.intercept({ path: READ, method: "POST" })
			.reply(
				200,
				{
					status: "SUCCESS",
					records: [
						record({ name: "other.example.com", content: "9.9.9.9" }),
						record({ type: "AAAA", content: "::1" }),
					],
				},
				json,
			);
		assert.equal(await run("read", base), null);
	});

	it("has no zone fetch", () => {
		assert.equal(providerById("porkbun").listZones, undefined);
	});
});

const DYNU_STOPPED = new Set(["nohost", "badauth", "abuse", "!donator"]);
const dynuWait = (body, retry) => {
	if (body === "911") return 10 * 60_000;
	return retry || DYNU_STOPPED.has(body) ? undefined : 6 * 60 * 60_000;
};

describe("update-URL presets (namecheap, noip, dynu)", () => {
	// secrets with characters that change when URL-encoded
	const PASSWORD = ["pw", "a/b+c&d=1 2"].join("-");
	const USER = "me+box@example.com";
	const encodedPw = encodeURIComponent(PASSWORD);
	const echoes = (extra = "") => [
		`${extra}${PASSWORD}`,
		`${extra}${encodedPw}`,
		`${extra}${encodedPw.replaceAll("%20", "+")}`,
	];
	const noLeak = (err) => !err.message.includes(PASSWORD) && !err.message.includes(encodedPw);

	describe("namecheap", () => {
		const nc = () => api("dynamicdns.park-your-domain.com");
		const fields = { domain: "example.com", password: PASSWORD };
		const secrets = [PASSWORD];
		const base = { zone: "", name: "home.example.com", type: "A", fields, ip: "5.6.7.8", existing: null };
		const run = (method, args) => call("namecheap", method, args, secrets);
		const pathOf = (host) => `/update?host=${host}&domain=example.com&password=${encodedPw}&ip=5.6.7.8`;
		const xml = (count, errors = "") =>
			`<?xml version="1.0" encoding="utf-16"?><interface-response><Command>SETDNSHOST</Command><ErrCount>${count}</ErrCount>${
				errors === "" ? "<errors />" : `<errors>${errors}</errors>`
			}<Done>true</Done></interface-response>`;

		it("is a zoneless address provider without a read", async () => {
			const provider = providerById("namecheap");
			assert.equal(provider.zoneless, true);
			assert.equal(provider.credentialProvider, null);
			assert.equal(provider.adminOnly, false);
			assert.equal(provider.ipv6, false);
			assert.deepEqual(provider.recordTypes, ["A"]);
			assert.equal(await run("read", base), null);
		});

		it("sends one GET with the host, the domain, the password and the address, and takes ErrCount 0 as success", async () => {
			nc()
				.intercept({ path: pathOf("home"), method: "GET" })
				.reply(200, xml(0), { headers: { "content-type": "application/json" } });
			assert.deepEqual(await run("write", base), { meta: {}, created: false });
			nc()
				.intercept({ path: pathOf("%40"), method: "GET" })
				.reply(200, xml(0));
			assert.deepEqual(await run("write", { ...base, name: "example.com" }), { meta: {}, created: false });
			nc()
				.intercept({ path: pathOf("a.b"), method: "GET" })
				.reply(200, xml(0));
			assert.deepEqual(await run("write", { ...base, name: "a.b.example.com" }), { meta: {}, created: false });
			mock.assertNoPendingInterceptors();
		});

		it("takes ErrCount above 0 as a refusal with the first error text that stops the record", async () => {
			nc()
				.intercept({ path: pathOf("home"), method: "GET" })
				.reply(200, xml(1, "<Err1>Passwords do not match</Err1>"));
			await assert.rejects(
				run("write", base),
				(err) =>
					err.code === "forbidden" &&
					err.retry === false &&
					err.stop === true &&
					err.retryAfterMs === undefined &&
					err.message.includes("Passwords do not match") &&
					noLeak(err),
			);
		});

		it("takes a body that is no answer, an HTTP error or ErrCount missing as a retried failure", async () => {
			for (const [status, body] of [
				[200, ""],
				[200, "<html>maintenance</html>"],
				[200, "<interface-response><Done>true</Done></interface-response>"],
				[200, "not xml ErrCount 0"],
				[502, xml(0)],
			]) {
				nc()
					.intercept({ path: pathOf("home"), method: "GET" })
					.reply(status, body);
				await assert.rejects(run("write", base), (err) => err.code === "failed" && err.retry !== false);
			}
		});

		it("never lets the password into a message, plain, URL-encoded, echoed or in a network error", async () => {
			for (const body of echoes("<Err1>bad ").map((text) => xml(1, `${text}</Err1>`))) {
				nc()
					.intercept({ path: pathOf("home"), method: "GET" })
					.reply(200, body);
				await assert.rejects(run("write", base), (err) => err.message.includes("***") && noLeak(err));
			}
			nc()
				.intercept({ path: pathOf("home"), method: "GET" })
				.replyWithError(Object.assign(new Error(`connect failed ${PASSWORD}`), { code: "ECONNRESET" }));
			await assert.rejects(run("write", base), (err) => err.code === "network" && noLeak(err));
		});

		it("refuses IPv6, a wildcard and missing details before any call", async () => {
			await assert.rejects(
				run("write", { ...base, type: "AAAA", ip: "2001:db8::1" }),
				(err) => err.retry === false,
			);
			await assert.rejects(run("write", { ...base, name: "*.example.com" }), (err) => err.retry === false);
			await assert.rejects(
				run("write", { ...base, fields: { domain: "example.com" } }),
				(err) => err.retry === false,
			);
			await assert.rejects(
				run("write", { ...base, fields: { password: PASSWORD } }),
				(err) => err.retry === false,
			);
		});
	});

	describe("noip", () => {
		const np = () => api("dynupdate.no-ip.com");
		const fields = { username: USER, password: PASSWORD };
		const secrets = [PASSWORD, USER];
		const base = { zone: "", name: "home.example.net", type: "A", fields, ip: "5.6.7.8", existing: null };
		const run = (method, args) => call("noip", method, args, secrets);
		const basic = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;
		const send = (ipKey = "myip", ip = "5.6.7.8") => ({
			path: `/nic/update?hostname=home.example.net&${ipKey}=${typeof ip === "string" ? encodeURIComponent(ip) : ip.raw}`,
			method: "GET",
			headers: (headers) =>
				headers.authorization === basic &&
				headers["user-agent"] === "NPMpro-DDNS/1.0 github.com/TheBlackBush/NPMpro",
		});

		it("sends one GET with Basic auth and a user agent, and takes good and nochg as success", async () => {
			np().intercept(send()).reply(200, "good 5.6.7.8");
			assert.deepEqual(await run("write", base), { meta: {}, created: false });
			np().intercept(send()).reply(200, "nochg 5.6.7.8\n");
			assert.deepEqual(await run("write", base), { meta: {}, created: false });
			np().intercept(send("myipv6", "2001:db8::1")).reply(200, "good 2001:db8::1");
			assert.deepEqual(await run("write", { ...base, type: "AAAA", ip: "2001:db8::1" }), {
				meta: {},
				created: false,
			});
			mock.assertNoPendingInterceptors();
		});

		it("makes one call per record: a both record sends myip and myipv6 together, an A record myip only", async () => {
			assert.equal(providerById("noip").oneCall, true);
			const v6 = encodeURIComponent("2001:db8::1");
			np()
				.intercept(send("myip", { raw: `5.6.7.8&myipv6=${v6}` }))
				.reply(200, "good 5.6.7.8,2001:db8::1");
			assert.deepEqual(await run("write", { ...base, addresses: { ipv4: "5.6.7.8", ipv6: "2001:db8::1" } }), {
				meta: {},
				created: false,
			});
			np().intercept(send()).reply(200, "good 5.6.7.8");
			assert.deepEqual(await run("write", { ...base, addresses: { ipv4: "5.6.7.8" } }), {
				meta: {},
				created: false,
			});
			mock.assertNoPendingInterceptors();
		});

		it("tells each failure answer, retries only 911 and stops on the account answers", async () => {
			const cases = [
				["nohost", 200, "forbidden", false],
				["badauth", 401, "forbidden", false],
				["badagent", 200, "forbidden", false],
				["!donator", 200, "forbidden", false],
				["abuse", 200, "forbidden", false],
				["911", 200, "failed", true],
			];
			for (const [body, status, code, retry] of cases) {
				np().intercept(send()).reply(status, body);
				await assert.rejects(
					run("write", base),
					(err) =>
						err.code === code &&
						err.retry === retry &&
						err.retryAfterMs === (body === "911" ? 30 * 60_000 : undefined) &&
						(err.stop === true) === (body !== "911") &&
						err.message.includes(body) &&
						err.providerStatus === status,
					body,
				);
			}
			np().intercept(send()).reply(200, "something new");
			await assert.rejects(run("write", base), (err) => err.code === "failed" && err.retry !== false);
			np().intercept(send()).reply(500, "good 5.6.7.8");
			await assert.rejects(run("write", base), (err) => err.code === "failed");
		});

		it("never lets the password or the user name into a message", async () => {
			for (const body of [...echoes("badauth "), `badauth ${USER}`]) {
				np().intercept(send()).reply(401, body);
				await assert.rejects(run("write", base), (err) => noLeak(err) && !err.message.includes(USER));
			}
			np()
				.intercept(send())
				.replyWithError(Object.assign(new Error(`connect failed ${PASSWORD} ${USER}`), { code: "ECONNRESET" }));
			await assert.rejects(
				run("write", base),
				(err) => err.code === "network" && noLeak(err) && !err.message.includes(USER),
			);
		});

		it("refuses a wildcard and missing details before any call", async () => {
			await assert.rejects(run("write", { ...base, name: "*.example.net" }), (err) => err.retry === false);
			await assert.rejects(
				run("write", { ...base, fields: { password: PASSWORD } }),
				(err) => err.retry === false,
			);
		});
	});

	describe("dynu", () => {
		const dy = () => api("api.dynu.com");
		const fields = { username: USER, password: PASSWORD };
		const secrets = [PASSWORD, USER];
		const base = { zone: "", name: "home.example.org", type: "A", fields, ip: "5.6.7.8", existing: null };
		const run = (method, args) => call("dynu", method, args, secrets);
		const basic = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;
		const send = (query) => ({
			path: `/nic/update?hostname=home.example.org&${query}`,
			method: "GET",
			headers: (headers) => headers.authorization === basic,
		});

		it("always sends the hostname and blocks the other family, with Basic auth", async () => {
			dy().intercept(send("myip=5.6.7.8&myipv6=no")).reply(200, "good 5.6.7.8");
			assert.deepEqual(await run("write", base), { meta: {}, created: false });
			dy()
				.intercept(send(`myip=no&myipv6=${encodeURIComponent("2001:db8::1")}`))
				.reply(200, "nochg");
			assert.deepEqual(await run("write", { ...base, type: "AAAA", ip: "2001:db8::1" }), {
				meta: {},
				created: false,
			});
			mock.assertNoPendingInterceptors();
		});

		it("tells each failure answer and retries only the retryable ones", async () => {
			const cases = [
				["nohost", "forbidden", false],
				["badauth", "forbidden", false],
				["notfqdn", "forbidden", false],
				["abuse", "forbidden", false],
				["numhost", "forbidden", false],
				["!donator", "forbidden", false],
				["unknown", "forbidden", false],
				["911", "failed", true],
				["servererror", "failed", true],
				["dnserr", "failed", true],
			];
			for (const [body, code, retry] of cases) {
				dy().intercept(send("myip=5.6.7.8&myipv6=no")).reply(200, body);
				await assert.rejects(
					run("write", base),
					(err) =>
						err.code === code &&
						err.retry === retry &&
						err.message.includes(body) &&
						err.retryAfterMs === dynuWait(body, retry) &&
						(err.stop === true) === DYNU_STOPPED.has(body),
					body,
				);
			}
			dy().intercept(send("myip=5.6.7.8&myipv6=no")).reply(200, "surprise");
			await assert.rejects(run("write", base), (err) => err.code === "failed" && err.retry !== false);
			dy().intercept(send("myip=5.6.7.8&myipv6=no")).reply(500, "good");
			await assert.rejects(run("write", base), (err) => err.code === "failed");
		});

		it("never lets the password or the user name into a message", async () => {
			for (const body of [...echoes("badauth "), `badauth ${USER}`]) {
				dy().intercept(send("myip=5.6.7.8&myipv6=no")).reply(200, body);
				await assert.rejects(run("write", base), (err) => noLeak(err) && !err.message.includes(USER));
			}
		});

		it("refuses a wildcard and missing details before any call", async () => {
			await assert.rejects(run("write", { ...base, name: "*.example.org" }), (err) => err.retry === false);
			await assert.rejects(
				run("write", { ...base, fields: { password: PASSWORD } }),
				(err) => err.retry === false,
			);
		});
	});
});
