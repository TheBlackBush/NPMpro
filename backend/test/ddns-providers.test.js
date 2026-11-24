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
const BETWEEN = /between 300/u;
const cfRecords = (type, name, zoneId = "zid") =>
	`/client/v4/zones/${zoneId}/dns_records?type=${type}&name.exact=${name}`;
const bearerOf = { authorization: `Bearer ${TOKEN}` };

describe("registry", () => {
	it("lists the four updater providers and finds them by credential provider", () => {
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.id),
			["cloudflare", "digitalocean", "hetzner-cloud", "gandi"],
		);
		assert.deepEqual(PROVIDER_LIST[0], {
			id: "cloudflare",
			label: "Cloudflare",
			credential_provider: "cloudflare",
			record_types: ["A", "AAAA", "CNAME"],
			proxied: true,
			ipv6: true,
			admin_only: false,
			wildcards: true,
			min_ttl: 60,
		});
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.min_ttl),
			[60, 30, 60, 300],
		);
		assert.equal(PROVIDER_LIST.filter((p) => p.proxied).length, 1);
		assert.deepEqual(
			PROVIDER_LIST.map((p) => p.wildcards),
			[true, true, false, false],
		);
		assert.equal(updaterFor("gandi").id, "gandi");
		assert.equal(updaterFor("ovh"), null);
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
