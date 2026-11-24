import assert from "node:assert/strict";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { after, describe, it } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";

process.env.NPMPRO_TEST_ROOT = "/nonexistent-dns-provider-challenges-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");
const { DdnsProviderError } = await import("../lib/ddns/errors.js");
const { cleansChallenges, providerById, refusalOf } = await import("../lib/ddns/providers/index.js");
const { collectChallenges, fullName, isChallengeName, unquote } = await import(
	"../lib/ddns/providers/challenge-common.js"
);

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
const NOT_CHALLENGE = /Not an ACME challenge/u;
const DELETED_REFRESH_FAILED = /deleted but the zone refresh failed/u;
const ZONE = "example.org";
const TOKEN = "tok-secret-1234";
const SECRET = "sec-secret-5678";
const TIME = "2026-11-01T10:00:00.000Z";
const bearerOf = { authorization: `Bearer ${TOKEN}` };
const api = (host) => mock.get(`https://${host}`);
const cfId = (n) => n.toString(16).padStart(32, "0");
const full = (n) => `${n}.${ZONE}`;

// a challenge record of the tests: n is relative to the zone, id and v its identity and value, t its time
const rec = (i, n = "_acme-challenge") => ({ n: i === 0 ? n : `${n}.h${i}`, id: i + 1, v: `value-${i}`, t: TIME });
const recs = (from, count) => Array.from({ length: count }, (_, i) => rec(from + i));
const chunks = (list, size) => {
	const out = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out.length > 0 ? out : [[]];
};

const OVH_SECRET = "ovh-app-secret-1234";
const OVH_CONSUMER = "ovh-consumer-5678";
const OVH_BASE = "/1.0/domain/zone/example.org";

// Per provider: the fields and secrets, how its list answers look (setList), what a listed item looks like (item), and
// the page size it pages by. setList({ pages, noise, cname }) registers the interceptors of one listing: pages hold
// challenge TXT records, noise a TXT at _acme-txt.x, cname a CNAME at _acme-challenge.
const CASES = {
	cloudflare: {
		fields: { dns_cloudflare_api_token: TOKEN },
		secrets: [TOKEN],
		pageSize: 100,
		hasTime: true,
		id: (r) => cfId(r.id),
		setList({ pages, noise, cname }) {
			const pool = api("api.cloudflare.com");
			pool.intercept({ path: `/client/v4/zones?name=${ZONE}`, method: "GET", headers: bearerOf }).reply(
				200,
				{ success: true, result: [{ id: "zid" }] },
				json,
			);
			pages.forEach((page, i) => {
				const result = page.map((r) => ({
					id: cfId(r.id),
					type: "TXT",
					name: full(r.n),
					content: `"${r.v}"`,
					modified_on: r.t,
				}));
				if (i === 0 && noise) result.push({ id: "n1", type: "TXT", name: full("_acme-txt.x"), content: "zzz" });
				if (i === 0 && cname)
					result.push({ id: "c1", type: "CNAME", name: full("_acme-challenge"), content: "x.example.net" });
				pool.intercept({
					path: `/client/v4/zones/zid/dns_records?name.startswith=_acme-challenge&per_page=100&page=${i + 1}`,
					method: "GET",
					headers: bearerOf,
				}).reply(200, { success: true, result, result_info: { page: i + 1, total_pages: pages.length } }, json);
			});
		},
		lookup() {
			api("api.cloudflare.com")
				.intercept({ path: `/client/v4/zones?name=${ZONE}`, method: "GET" })
				.reply(200, { success: true, result: [{ id: "zid" }] }, json);
		},
		del: (item) => ({
			path: `/client/v4/zones/zid/dns_records/${item.id}`,
			method: "DELETE",
			host: "api.cloudflare.com",
		}),
		ok: [200, { success: true, result: { id: "x" } }],
		forbidden: [403, { success: false, errors: [{ code: 9109, message: `Invalid access token ${TOKEN}` }] }],
		// a failed delete is looked at again with one list by name
		recheck(item, present) {
			api("api.cloudflare.com")
				.intercept({
					path: `/client/v4/zones/zid/dns_records?name.exact=${item.name}`,
					method: "GET",
				})
				.reply(200, { success: true, result: present ? [{ id: item.id }] : [] }, json);
		},
		gone: [404, { success: false, errors: [{ code: 81044, message: "Record does not exist" }] }],
		goneNeedsRecheck: true,
	},
	digitalocean: {
		fields: { dns_digitalocean_token: TOKEN },
		secrets: [TOKEN],
		pageSize: 200,
		hasTime: false,
		id: (r) => r.id,
		setList({ pages, noise, cname }) {
			const pool = api("api.digitalocean.com");
			pages.forEach((page, i) => {
				const domain_records = page.map((r) => ({ id: r.id, type: "TXT", name: r.n, data: r.v }));
				if (i === 0 && noise) domain_records.push({ id: 900, type: "TXT", name: "_acme-txt.x", data: "zzz" });
				pool.intercept({
					path: `/v2/domains/${ZONE}/records?type=TXT&page=${i + 1}&per_page=200`,
					method: "GET",
					headers: bearerOf,
				}).reply(
					200,
					{ domain_records, links: i + 1 < pages.length ? { pages: { next: "https://x/next" } } : {} },
					json,
				);
			});
			pool.intercept({
				path: `/v2/domains/${ZONE}/records?type=CNAME&name=_acme-challenge.${ZONE}`,
				method: "GET",
			}).reply(
				200,
				{ domain_records: cname ? [{ id: 800, type: "CNAME", name: "_acme-challenge", data: "x." }] : [] },
				json,
			);
		},
		del: (item) => ({
			path: `/v2/domains/${ZONE}/records/${item.id}`,
			method: "DELETE",
			host: "api.digitalocean.com",
		}),
		ok: [204, ""],
		forbidden: [403, { id: "forbidden", message: `You are not allowed ${TOKEN}` }],
		gone: [404, { id: "not_found", message: "The resource you requested could not be found." }],
	},
	"hetzner-cloud": {
		fields: { dns_hetzner_cloud_api_token: TOKEN },
		secrets: [TOKEN],
		pageSize: 50,
		hasTime: false,
		set: true,
		setList({ pages, noise, cname }) {
			const pool = api("api.hetzner.cloud");
			pages.forEach((page, i) => {
				const rrsets = page.map((r) => ({ name: r.n, type: "TXT", records: [{ value: `"${r.v}"` }] }));
				if (i === 0 && noise) rrsets.push({ name: "_acme-txt.x", type: "TXT", records: [{ value: '"zzz"' }] });
				pool.intercept({
					path: `/v1/zones/${ZONE}/rrsets?type=TXT&page=${i + 1}&per_page=50`,
					method: "GET",
					headers: bearerOf,
				}).reply(
					200,
					{ rrsets, meta: { pagination: { page: i + 1, next_page: i + 1 < pages.length ? i + 2 : null } } },
					json,
				);
			});
			pool.intercept({ path: `/v1/zones/${ZONE}/rrsets?type=CNAME&name=_acme-challenge`, method: "GET" }).reply(
				200,
				{ rrsets: cname ? [{ name: "_acme-challenge", type: "CNAME", records: [] }] : [] },
				json,
			);
		},
		// the set is read before the delete: values as the provider shows them
		readSet(item, values, status = 200) {
			api("api.hetzner.cloud")
				.intercept({ path: `/v1/zones/${ZONE}/rrsets/${item.name.replace(`.${ZONE}`, "")}/TXT`, method: "GET" })
				.reply(
					status,
					status === 200
						? { rrset: { ttl: 60, records: values.map((value) => ({ value })) } }
						: { error: { code: "not_found" } },
					json,
				);
		},
		quote: (v) => `"${v}"`,
		del: (item) => ({
			path: `/v1/zones/${ZONE}/rrsets/${item.name.replace(`.${ZONE}`, "")}/TXT`,
			method: "DELETE",
			host: "api.hetzner.cloud",
		}),
		ok: [201, { action: { id: 1 } }],
		forbidden: [403, { error: { code: "forbidden", message: `Insufficient permissions ${TOKEN}` } }],
	},
	gandi: {
		fields: { dns_gandi_token: TOKEN },
		secrets: [TOKEN],
		pageSize: 100,
		hasTime: false,
		set: true,
		setList({ pages, noise, cname }) {
			const pool = api("api.gandi.net");
			pages.forEach((page, i) => {
				const body = page.map((r) => ({ rrset_name: r.n, rrset_type: "TXT", rrset_values: [`"${r.v}"`] }));
				if (i === 0 && noise)
					body.push({ rrset_name: "_acme-txt.x", rrset_type: "TXT", rrset_values: ['"zzz"'] });
				pool.intercept({
					path: `/v5/livedns/domains/${ZONE}/records?rrset_type=TXT&page=${i + 1}&per_page=100`,
					method: "GET",
					headers: bearerOf,
				}).reply(200, body, json);
			});
			pool.intercept({ path: `/v5/livedns/domains/${ZONE}/records/_acme-challenge/CNAME`, method: "GET" }).reply(
				cname ? 200 : 404,
				cname ? { rrset_values: ["x.example.net."] } : { message: "not found" },
				json,
			);
		},
		readSet(item, values, status = 200, zoneStatus = 200) {
			if (status === 404) {
				api("api.gandi.net")
					.intercept({ path: `/v5/livedns/domains/${ZONE}/records?rrset_type=TXT&per_page=1`, method: "GET" })
					.reply(zoneStatus, zoneStatus === 200 ? [] : { message: "no zone" }, json);
			}
			api("api.gandi.net")
				.intercept({
					path: `/v5/livedns/domains/${ZONE}/records/${item.name.replace(`.${ZONE}`, "")}/TXT`,
					method: "GET",
				})
				.reply(status, status === 200 ? { rrset_values: values, rrset_ttl: 300 } : { message: "gone" }, json);
		},
		quote: (v) => v,
		del: (item) => ({
			path: `/v5/livedns/domains/${ZONE}/records/${item.name.replace(`.${ZONE}`, "")}/TXT`,
			method: "DELETE",
			host: "api.gandi.net",
		}),
		ok: [204, ""],
		forbidden: [403, { message: `Access was denied ${TOKEN}` }],
	},
	ovh: {
		fields: {
			dns_ovh_endpoint: "ovh-eu",
			dns_ovh_application_key: "app-key",
			dns_ovh_application_secret: OVH_SECRET,
			dns_ovh_consumer_key: OVH_CONSUMER,
		},
		secrets: [OVH_SECRET, OVH_CONSUMER],
		pageSize: 20,
		hasTime: false,
		id: (r) => r.id,
		setList({ pages, noise, cname }) {
			const pool = api("eu.api.ovh.com");
			pool.intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "1700000000", json).persist();
			const all = pages.flat();
			const extra = noise ? [{ id: 900, n: "_acme-txt.x", v: "zzz" }] : [];
			const everything = [...all, ...extra];
			pool.intercept({ path: `${OVH_BASE}/record?fieldType=TXT`, method: "GET" }).reply(
				200,
				everything.map((r) => r.id),
				json,
			);
			// the listing reads the ids in batches of 20: the cut test hands more pages than 25 batches
			for (const r of everything) {
				pool.intercept({ path: `${OVH_BASE}/record/${r.id}`, method: "GET" }).reply(
					200,
					{ id: r.id, zone: ZONE, fieldType: "TXT", subDomain: r.n, target: `"${r.v}"`, ttl: 60 },
					json,
				);
			}
			pool.intercept({
				path: `${OVH_BASE}/record?fieldType=CNAME&subDomain=_acme-challenge`,
				method: "GET",
			}).reply(200, cname ? [800] : [], json);
			if (cname) {
				pool.intercept({ path: `${OVH_BASE}/record/800`, method: "GET" }).reply(
					200,
					{
						id: 800,
						zone: ZONE,
						fieldType: "CNAME",
						subDomain: "_acme-challenge",
						target: "x.example.net.",
						ttl: 60,
					},
					json,
				);
			}
		},
		del: (item) => ({ path: `${OVH_BASE}/record/${item.id}`, method: "DELETE", host: "eu.api.ovh.com" }),
		ok: [200, ""],
		forbidden: [403, { class: "Client::Forbidden", message: `This call has not been granted ${OVH_CONSUMER}` }],
		gone: [404, { message: "gone" }],
		goneNeedsRecheck: true,
	},
	desec: {
		fields: { dns_desec_token: TOKEN },
		secrets: [TOKEN],
		pageSize: 250,
		hasTime: true,
		set: true,
		setList({ pages, noise, cname }) {
			const pool = api("desec.io");
			const headers = { authorization: `Token ${TOKEN}` };
			pages.forEach((page, i) => {
				const body = page.map((r) => ({
					subname: r.n,
					type: "TXT",
					records: [`"${r.v}"`],
					created: "2026-10-01T10:00:00Z",
					touched: r.t,
				}));
				if (i === 0 && noise) body.push({ subname: "_acme-txt.x", type: "TXT", records: ['"zzz"'] });
				const link =
					i + 1 < pages.length
						? {
								link: `<https://desec.io/api/v1/domains/${ZONE}/rrsets/?type=TXT&cursor=c${i + 1}>; rel="next"`,
							}
						: {};
				pool.intercept({
					path: `/api/v1/domains/${ZONE}/rrsets/?type=TXT${i === 0 ? "" : `&cursor=c${i}`}`,
					method: "GET",
					headers,
				}).reply(200, body, { headers: { ...json.headers, ...link } });
			});
			pool.intercept({
				path: `/api/v1/domains/${ZONE}/rrsets/?type=CNAME&subname=_acme-challenge`,
				method: "GET",
			}).reply(
				200,
				cname ? [{ subname: "_acme-challenge", type: "CNAME", records: ["x.example.net."] }] : [],
				json,
			);
		},
		readSet(item, values, status = 200, zoneStatus = 200) {
			if (status === 404) {
				api("desec.io")
					.intercept({
						path: `/api/v1/domains/${ZONE}/rrsets/?type=TXT&subname=_acme-challenge`,
						method: "GET",
					})
					.reply(zoneStatus, zoneStatus === 200 ? [] : { detail: "Not found." }, json);
			}
			api("desec.io")
				.intercept({
					path: `/api/v1/domains/${ZONE}/rrsets/${item.name.replace(`.${ZONE}`, "")}/TXT/`,
					method: "GET",
				})
				.reply(status, status === 200 ? { records: values, ttl: 3600 } : { detail: "Not found." }, json);
		},
		quote: (v) => `"${v}"`,
		del: (item) => ({
			path: `/api/v1/domains/${ZONE}/rrsets/${item.name.replace(`.${ZONE}`, "")}/TXT/`,
			method: "DELETE",
			host: "desec.io",
		}),
		ok: [204, ""],
		forbidden: [403, { detail: `You do not have permission ${TOKEN}` }],
	},
	porkbun: {
		fields: { dns_porkbun_key: TOKEN, dns_porkbun_secret: SECRET },
		secrets: [TOKEN, SECRET],
		pageSize: 100000,
		hasTime: false,
		id: (r) => String(r.id),
		setList({ pages, noise, cname }) {
			const records = pages
				.flat()
				.map((r) => ({ id: String(r.id), name: full(r.n), type: "TXT", content: r.v, ttl: "600" }));
			if (noise) records.push({ id: "900", name: full("_acme-txt.x"), type: "TXT", content: "zzz", ttl: "600" });
			if (cname)
				records.push({
					id: "800",
					name: full("_acme-challenge"),
					type: "CNAME",
					content: "x.example.net",
					ttl: "600",
				});
			api("api.porkbun.com")
				.intercept({
					path: `/api/json/v3/dns/retrieve/${ZONE}`,
					method: "POST",
					body: (text) => {
						const sent = JSON.parse(text);
						return sent.apikey === TOKEN && sent.secretapikey === SECRET;
					},
				})
				.reply(200, { status: "SUCCESS", records }, json);
		},
		del: (item) => ({
			path: `/api/json/v3/dns/delete/${ZONE}/${item.id}`,
			method: "POST",
			host: "api.porkbun.com",
		}),
		ok: [200, { status: "SUCCESS" }],
		forbidden: [403, { status: "ERROR", code: "INSUFFICIENT_SCOPE", message: `Scope missing ${TOKEN} ${SECRET}` }],
		gone: [400, { status: "ERROR", code: "INVALID_RECORD_ID", message: "DNS record ID was not found" }],
	},
};

const listOf = (id, extra = {}) =>
	providerById(id).listChallenges({
		zone: ZONE,
		fields: CASES[id].fields,
		fetch: (url, options) => providerFetch(url, { ...options, secrets: CASES[id].secrets }),
		...extra,
	});
const removeOf = (id, item) =>
	providerById(id).removeChallenge({
		zone: ZONE,
		item,
		fields: CASES[id].fields,
		fetch: (url, options) => providerFetch(url, { ...options, secrets: CASES[id].secrets }),
	});
const expectedItem = (c, r) => {
	const name = full(r.n);
	const id = c.set ? null : c.id(r);
	return { key: `${name}|${id ?? "set"}`, name, id, values: [r.v], changed_on: c.hasTime ? TIME : null };
};
const itemOf = (c, r) => expectedItem(c, r);

const BAD_ID = /valid record id/u;
const rel = (name) => name.replace(`.${ZONE}`, "");
const ovhTime = () =>
	api("eu.api.ovh.com").intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "1700000000", json);
const ovhRefresh = (status, body = "") => {
	ovhTime();
	api("eu.api.ovh.com")
		.intercept({ path: `${OVH_BASE}/refresh`, method: "POST" })
		.reply(status, body, json);
};
// the read of a record before its delete: over.absent (not there), over.type, over.name, over.value (what it shows)
const pre = (id, item, over = {}) => {
	const c = CASES[id];
	const type = over.type ?? "TXT";
	const name = over.name ?? item.name;
	const value = over.value ?? item.values[0];
	if (c.set) {
		c.readSet(item, [c.quote(item.values[0])], over.absent ? 404 : 200);
	} else if (id === "cloudflare") {
		c.lookup();
		api("api.cloudflare.com")
			.intercept({ path: `/client/v4/zones/zid/dns_records?name.exact=${item.name}`, method: "GET" })
			.reply(
				200,
				{ success: true, result: over.absent ? [] : [{ id: item.id, type, name, content: `"${value}"` }] },
				json,
			);
	} else if (id === "digitalocean") {
		api("api.digitalocean.com")
			.intercept({ path: `/v2/domains/${ZONE}/records?name=${item.name}`, method: "GET" })
			.reply(
				200,
				{ domain_records: over.absent ? [] : [{ id: item.id, type, name: rel(name), data: value }] },
				json,
			);
	} else if (id === "ovh") {
		ovhTime();
		api("eu.api.ovh.com")
			.intercept({ path: `${OVH_BASE}/record/${item.id}`, method: "GET" })
			.reply(
				over.absent ? 404 : 200,
				over.absent
					? { message: "gone" }
					: { id: item.id, fieldType: type, subDomain: rel(name), target: `"${value}"` },
				json,
			);
	} else {
		api("api.porkbun.com")
			.intercept({
				path: `/api/json/v3/dns/retrieveByNameType/${ZONE}/TXT/_acme-challenge`,
				method: "POST",
			})
			.reply(
				200,
				{ status: "SUCCESS", records: over.absent ? [] : [{ id: item.id, type, name, content: value }] },
				json,
			);
	}
};
// the second read after a delete that failed: the record is no longer there
const again = (id, item) => {
	const c = CASES[id];
	if (c.set) c.readSet(item, [], 404);
	else if (id === "cloudflare") c.recheck(item, false);
	else if (id === "ovh") {
		ovhTime();
		api("eu.api.ovh.com")
			.intercept({ path: `${OVH_BASE}/record/${item.id}`, method: "GET" })
			.reply(404, {}, json);
	} else if (id === "digitalocean") {
		api("api.digitalocean.com")
			.intercept({ path: `/v2/domains/${ZONE}/records?name=${item.name}`, method: "GET" })
			.reply(200, { domain_records: [] }, json);
	} else {
		api("api.porkbun.com")
			.intercept({
				path: `/api/json/v3/dns/retrieveByNameType/${ZONE}/TXT/_acme-challenge`,
				method: "POST",
			})
			.reply(200, { status: "SUCCESS", records: [] }, json);
	}
};
const delMock = (id, item, status, body) => {
	const d = CASES[id].del(item);
	if (id === "ovh") ovhTime();
	api(d.host).intercept({ path: d.path, method: d.method }).reply(status, body, json);
};

describe("challenge helpers", () => {
	it("unquote strips one or several quoted strings and keeps an unquoted value", () => {
		assert.equal(unquote('"abc"'), "abc");
		assert.equal(unquote('"ab" "cd"'), "abcd");
		assert.equal(unquote('"a\\"b"'), 'a"b');
		assert.equal(unquote("plain"), "plain");
		assert.equal(unquote(undefined), "");
	});

	it("fullName completes relative names and isChallengeName takes only the challenge names", () => {
		assert.equal(fullName(ZONE, "@", true), ZONE);
		assert.equal(fullName(ZONE, "_acme-challenge", true), "_acme-challenge.example.org");
		assert.equal(fullName(ZONE, "_ACME-challenge.Example.org.", false), "_acme-challenge.example.org");
		assert.equal(isChallengeName("_acme-challenge.example.org", ZONE), true);
		assert.equal(isChallengeName("_acme-challenge.www.example.org", ZONE), true);
		assert.equal(isChallengeName("_acme-challenge-x.example.org", ZONE), false);
		assert.equal(isChallengeName("_acme-txt.x.example.org", ZONE), false);
		assert.equal(isChallengeName("_acme-challenge.example.net", ZONE), false);
	});

	it("collectChallenges stops after 25 pages with truncated", async () => {
		let calls = 0;
		const result = await collectChallenges({
			zone: ZONE,
			fetchPage: () => {
				calls++;
				return Promise.resolve({ records: [], more: true });
			},
		});
		assert.equal(calls, 25);
		assert.equal(result.truncated, true);
	});
});

for (const [id, c] of Object.entries(CASES)) {
	describe(`${id} challenges`, () => {
		it("lists one page: only TXT at the challenge names, quotes removed, the time read", async () => {
			const pages = [[rec(0), rec(1, "_acme-challenge.www")]];
			c.setList({ pages, noise: true, cname: true });
			const result = await listOf(id);
			assert.deepEqual(
				result.items.map((item) => item.name),
				["_acme-challenge.example.org", "_acme-challenge.www.h1.example.org"],
			);
			assert.equal(result.skipped_cnames, 1);
			assert.equal(result.truncated, false);
			const first = result.items.find((item) => item.name === "_acme-challenge.example.org");
			assert.deepEqual(first, expectedItem(c, pages[0][0]));
			assert.equal(
				result.items.some((item) => item.name.includes("_acme-txt")),
				false,
			);
		});

		it("lists nothing and counts no CNAME when there is none", async () => {
			c.setList({ pages: [[]], noise: true, cname: false });
			assert.deepEqual(await listOf(id), { items: [], skipped_cnames: 0, truncated: false });
		});

		if (c.pageSize < 1000) {
			it("lists two pages", async () => {
				const first = recs(0, c.pageSize);
				const second = recs(c.pageSize, 3);
				c.setList({ pages: [first, second], noise: false, cname: false });
				const result = await listOf(id);
				assert.equal(result.items.length, c.pageSize + 3);
				assert.equal(result.truncated, false);
			});

			it("cuts at 500 items and says truncated", async () => {
				c.setList({ pages: chunks(recs(0, 501), c.pageSize), noise: false, cname: false });
				const result = await listOf(id);
				assert.equal(result.items.length, 500);
				assert.equal(result.truncated, true);
			});
		}

		it("deletes one item", async () => {
			const item = itemOf(c, rec(0));
			pre(id, item);
			delMock(id, item, c.ok[0], c.ok[1]);
			if (id === "ovh") ovhRefresh(200);
			assert.deepEqual(await removeOf(id, item), { gone: false });
		});

		it("a 403 is forbidden with the secrets scrubbed", async () => {
			const item = itemOf(c, rec(0));
			pre(id, item);
			delMock(id, item, c.forbidden[0], c.forbidden[1]);
			await assert.rejects(removeOf(id, item), (err) => {
				assert.ok(err instanceof DdnsProviderError);
				assert.equal(err.code, "forbidden");
				assert.equal(err.providerStatus, 403);
				assert.equal(err.status, undefined);
				for (const secret of c.secrets) assert.equal(err.message.includes(secret), false);
				return true;
			});
		});

		it("a failed delete (404 or not) is read again and an absent record is gone", async () => {
			const item = itemOf(c, rec(0));
			pre(id, item);
			delMock(id, item, 404, { status: "ERROR", message: "not here" });
			again(id, item);
			assert.deepEqual(await removeOf(id, item), { gone: true });
		});

		it("a record that is no longer there is gone without a delete", async () => {
			const item = itemOf(c, rec(0));
			pre(id, item, { absent: true });
			assert.deepEqual(await removeOf(id, item), { gone: true });
		});

		if (c.set) {
			it("a value added since the list keeps the set: changed, nothing deleted", async () => {
				const item = itemOf(c, rec(0));
				c.readSet(item, [c.quote(item.values[0]), c.quote("another-client")]);
				assert.deepEqual(await removeOf(id, item), { gone: false, changed: true });
			});
		} else {
			const WRONG = [
				["a record of another type", { type: "A" }],
				["a record at another name", { name: "www.example.org" }],
				["a TXT with another value", { value: "another-value" }],
			];
			for (const [label, over] of WRONG) {
				// Porkbun reads only TXT records, so the type is not part of its answer
				it(`an id that points at ${label} deletes nothing: changed`, {
					skip: id === "porkbun" && over.type,
				}, async () => {
					const item = itemOf(c, rec(0));
					pre(id, item, over);
					assert.deepEqual(await removeOf(id, item), { gone: false, changed: true });
				});
			}

			it("a bad id makes no request", async () => {
				for (const bad of [
					null,
					undefined,
					"",
					"1/../x",
					0,
					-1,
					1.5,
					{},
					[1],
					"abc",
					typeof c.id(rec(0)) === "number" ? "7" : 7,
				]) {
					const item = { ...itemOf(c, rec(0)), id: bad };
					await assert.rejects(
						removeOf(id, item),
						(err) => err instanceof DdnsProviderError && BAD_ID.test(err.message),
					);
				}
			});
		}

		it("refuses a name that is no challenge name before any call", async () => {
			await assert.rejects(
				removeOf(id, { name: "www.example.org", id: 1, values: [] }),
				(err) => err instanceof DdnsProviderError && NOT_CHALLENGE.test(err.message),
			);
		});
	});
}

describe("a missing zone is a failure, never gone", () => {
	const missing = (err) => err instanceof DdnsProviderError && err.code === "failed" && err.providerStatus === 404;
	it("digitalocean: the read of the name answers 404", async () => {
		const item = itemOf(CASES.digitalocean, rec(0));
		api("api.digitalocean.com")
			.intercept({ path: `/v2/domains/${ZONE}/records?name=${item.name}`, method: "GET" })
			.reply(404, { id: "not_found" }, json);
		await assert.rejects(removeOf("digitalocean", item), missing);
	});
	it("gandi: a 404 on the set and on the zone", async () => {
		const c = CASES.gandi;
		const item = itemOf(c, rec(0));
		c.readSet(item, [], 404, 404);
		await assert.rejects(removeOf("gandi", item), missing);
	});
	it("gandi: a delete that answers 404 while the zone list answers 404 is a failure", async () => {
		const c = CASES.gandi;
		const item = itemOf(c, rec(0));
		c.readSet(item, [c.quote(item.values[0])]);
		delMock("gandi", item, 404, { message: "no" });
		c.readSet(item, [], 404, 404);
		await assert.rejects(removeOf("gandi", item), missing);
	});
	it("desec: a 404 on the RRset and on the domain", async () => {
		const c = CASES.desec;
		const item = itemOf(c, rec(0));
		c.readSet(item, [], 404, 404);
		await assert.rejects(removeOf("desec", item), missing);
	});
});

describe("desec challenge list", () => {
	it("a next link of another origin is refused and never followed", async () => {
		api("desec.io")
			.intercept({ path: `/api/v1/domains/${ZONE}/rrsets/?type=TXT`, method: "GET" })
			.reply(200, [], { headers: { ...json.headers, link: '<https://evil.example/x?cursor=c1>; rel="next"' } });
		await assert.rejects(
			listOf("desec"),
			(err) => err instanceof DdnsProviderError && err.message === "Unexpected answer shape",
		);
	});
});

describe("cloudflare delete details", () => {
	it("a failed delete that is still listed stays a failure", async () => {
		const c = CASES.cloudflare;
		const item = itemOf(c, rec(0));
		pre("cloudflare", item);
		delMock("cloudflare", item, 500, { success: false, errors: [{ message: "boom" }] });
		c.recheck(item, true);
		await assert.rejects(
			removeOf("cloudflare", item),
			(err) => err.code === "failed" && err.providerStatus === 500,
		);
	});
});

describe("ovh delete details", () => {
	it("refreshes the zone after the delete and a failed refresh is a failure", async () => {
		const item = itemOf(CASES.ovh, rec(0));
		pre("ovh", item);
		delMock("ovh", item, 200, "");
		ovhRefresh(500, { message: `no ${OVH_SECRET}` });
		await assert.rejects(removeOf("ovh", item), (err) => {
			assert.match(err.message, DELETED_REFRESH_FAILED);
			assert.equal(err.message.includes(OVH_SECRET), false);
			return true;
		});
	});
});

describe("porkbun delete details", () => {
	it("the documented INVALID_RECORD_ID answer is gone without another read", async () => {
		const c = CASES.porkbun;
		const item = itemOf(c, rec(0));
		pre("porkbun", item);
		delMock("porkbun", item, c.gone[0], c.gone[1]);
		assert.deepEqual(await removeOf("porkbun", item), { gone: true });
	});
});

describe("refusalOf", () => {
	const refused = (providerStatus) => new DdnsProviderError({ providerStatus, code: "forbidden", message: "x" });
	const MAP = {
		cloudflare: { 401: "refused", 403: "refused" },
		digitalocean: { 401: "wrong-key", 403: "missing-right" },
		"hetzner-cloud": { 401: "wrong-key", 403: "missing-right" },
		gandi: { 401: "wrong-key", 403: "refused" },
		ovh: { 401: "refused", 403: "refused" },
		desec: { 401: "wrong-key", 403: "refused" },
		porkbun: { 400: "wrong-key", 403: "missing-right" },
		linode: { 401: "wrong-key", 403: "missing-right" },
		vultr: { 401: "wrong-key" },
		bunny: { 401: "wrong-key" },
		ionos: { 401: "wrong-key" },
		godaddy: { 401: "wrong-key", 403: "refused" },
		powerdns: { 401: "wrong-key" },
	};
	for (const [id, map] of Object.entries(MAP)) {
		it(`${id}: the mapped statuses and an unmapped one`, () => {
			for (const [code, expected] of Object.entries(map)) {
				assert.equal(refusalOf(providerById(id), refused(Number(code))), expected, `${id} ${code}`);
			}
			assert.equal(refusalOf(providerById(id), refused(418)), "refused");
			assert.equal(refusalOf(id === "powerdns" ? "powerdns" : id, refused(418)), "refused");
		});
	}

	it("a provider without a mapping, and an unknown one, answer refused", () => {
		assert.equal(refusalOf(providerById("duckdns"), refused(401)), "refused");
		assert.equal(refusalOf("nothing", refused(401)), "refused");
		assert.equal(refusalOf(null, undefined), "refused");
	});

	it("cloudflare asks the verify call: only a 401 with code 1000 is a wrong token", async () => {
		const verify = (status, body, fields = { dns_cloudflare_api_token: TOKEN }) => {
			if (status !== null) {
				api("api.cloudflare.com")
					.intercept({ path: "/client/v4/user/tokens/verify", method: "GET", headers: bearerOf })
					.reply(status, body, json);
			}
			return providerById("cloudflare").verifyRefusal({
				fields,
				fetch: (url, options) => providerFetch(url, { ...options, secrets: [TOKEN] }),
			});
		};
		assert.equal(
			await verify(401, { success: false, errors: [{ code: 1000, message: "Invalid API Token" }] }),
			"wrong-key",
		);
		assert.equal(await verify(401, { success: false, errors: [{ code: 10000 }] }), "refused");
		assert.equal(await verify(403, { success: false, errors: [] }), "refused");
		assert.equal(await verify(200, { success: true, result: { status: "active" } }), "refused");
		assert.equal(
			await verify(null, null, { dns_cloudflare_email: "a@b.c", dns_cloudflare_api_key: "k" }),
			"refused",
		);
	});
});

describe("cleansChallenges", () => {
	it("is true exactly for the providers with a confirmed list and delete", () => {
		const yes = ["cloudflare", "digitalocean", "hetzner-cloud", "gandi", "ovh", "desec", "porkbun"];
		for (const id of yes) assert.equal(cleansChallenges(id), true, id);
		for (const id of [
			"duckdns",
			"linode",
			"vultr",
			"bunny",
			"ionos",
			"godaddy",
			"powerdns",
			"namecheap",
			"noip",
			"dynu",
			"custom",
			"nothing",
		]) {
			assert.equal(cleansChallenges(id), false, id);
		}
		assert.equal(cleansChallenges(undefined), false);
	});
});
