import assert from "node:assert/strict";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { after, afterEach, describe, it } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";

process.env.NPMPRO_TEST_ROOT = "/nonexistent-dns-provider-remove-test";
process.env.NPMPRO_TEST_OUTBOUND = "mock";
const { providerFetch } = await import("../lib/ddns/provider-fetch.js");
const { DdnsProviderError } = await import("../lib/ddns/errors.js");
const { PROVIDERS, providerById, removes } = await import("../lib/ddns/providers/index.js");

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
afterEach(() => {
	// every registered call happened (the persistent OVH clock answer stays registered)
	const left = mock
		.pendingInterceptors()
		.filter((entry) => !entry.persist)
		.map((entry) => `${entry.method} ${entry.origin}${entry.path}`);
	if (left.length > 0) throw new Error(`calls that did not happen: ${left.join(", ")}`);
});

after(() => {
	dns.lookup = realLookup;
	syncBuiltinESMExports();
});
const BAD_ID = /valid record id/u;
const DELETED_REFRESH_FAILED = /deleted but the zone refresh failed/u;
const json = { headers: { "content-type": "application/json" } };
const ZONE = "example.org";
const NAME = "home.example.org";
const V4 = "203.0.113.7";
const V6 = "2001:db8::7";
const TOKEN = "tok-secret-1234";
const SECRET = "sec-secret-5678";
const OVH_SECRET = "ovh-app-secret-1234";
const OVH_CONSUMER = "ovh-consumer-5678";
const OVH_BASE = "/1.0/domain/zone/example.org";
const api = (host) => mock.get(`https://${host}`);
const cfId = (n) => n.toString(16).padStart(32, "0");
const ID = 5;
const ZID = cfId(77);
const SCOPE = { zone: ZONE, name: NAME };

let ovhClock = false;
const ovhTime = () => {
	if (ovhClock) return;
	ovhClock = true;
	api("eu.api.ovh.com").intercept({ path: "/1.0/auth/time", method: "GET" }).reply(200, "1700000000", json).persist();
};

// Per provider: its fields and secrets, the read of the name and type (read(type, values, status)), the delete
// (del(type, status, body)), the answers of a good delete and of a 403, and how an id shows (ids: true)
const CASES = {
	cloudflare: {
		fields: { dns_cloudflare_api_token: TOKEN },
		secrets: [TOKEN],
		meta: { zone_id: ZID },
		ids: true,
		read(type, values) {
			api("api.cloudflare.com")
				.intercept({
					path: `/client/v4/zones/${ZID}/dns_records?type=${type}&name.exact=${NAME}`,
					method: "GET",
				})
				.reply(
					200,
					{
						success: true,
						result: values.map((content, i) => ({ id: cfId(ID + i), type, name: NAME, content })),
					},
					json,
				);
		},
		del(_type, status, body) {
			api("api.cloudflare.com")
				.intercept({ path: `/client/v4/zones/${ZID}/dns_records/${cfId(ID)}`, method: "DELETE" })
				.reply(status, body, json);
		},
		ok: [200, { success: true, result: { id: cfId(ID) } }],
		forbidden: [403, { success: false, errors: [{ code: 9109, message: `Invalid access token ${TOKEN}` }] }],
		gone: [404, { success: false, errors: [{ code: 81044, message: "Record does not exist" }] }],
	},
	digitalocean: {
		fields: { dns_digitalocean_token: TOKEN },
		secrets: [TOKEN],
		ids: true,
		read(type, values) {
			api("api.digitalocean.com")
				.intercept({ path: `/v2/domains/${ZONE}/records?type=${type}&name=${NAME}`, method: "GET" })
				.reply(
					200,
					{ domain_records: values.map((data, i) => ({ id: ID + i, type, name: "home", data })) },
					json,
				);
		},
		del(_type, status, body) {
			api("api.digitalocean.com")
				.intercept({ path: `/v2/domains/${ZONE}/records/${ID}`, method: "DELETE" })
				.reply(status, body, json);
		},
		ok: [204, ""],
		forbidden: [403, { id: "forbidden", message: `You are not allowed ${TOKEN}` }],
		gone: [404, { id: "not_found", message: "The resource you requested could not be found." }],
		documentedGone: true,
	},
	"hetzner-cloud": {
		fields: { dns_hetzner_cloud_api_token: TOKEN },
		secrets: [TOKEN],
		read(type, values, status = 200, zoneStatus = 200) {
			if (status === 404) {
				api("api.hetzner.cloud")
					.intercept({ path: `/v1/zones/${ZONE}`, method: "GET" })
					.reply(
						zoneStatus,
						zoneStatus === 200 ? { zone: { name: ZONE } } : { error: { code: "not_found" } },
						json,
					);
			}
			api("api.hetzner.cloud")
				.intercept({ path: `/v1/zones/${ZONE}/rrsets/home/${type}`, method: "GET" })
				.reply(
					status,
					status === 200
						? { rrset: { ttl: 60, records: values.map((value) => ({ value })) } }
						: { error: { code: "not_found" } },
					json,
				);
		},
		del(type, status, body) {
			api("api.hetzner.cloud")
				.intercept({ path: `/v1/zones/${ZONE}/rrsets/home/${type}`, method: "DELETE" })
				.reply(status, body, json);
		},
		ok: [201, { action: { id: 1 } }],
		forbidden: [403, { error: { code: "forbidden", message: `Insufficient permissions ${TOKEN}` } }],
		gone: [404, { error: { code: "not_found" } }],
	},
	gandi: {
		fields: { dns_gandi_token: TOKEN },
		secrets: [TOKEN],
		read(type, values, status = 200, zoneStatus = 200) {
			if (status === 404) {
				api("api.gandi.net")
					.intercept({ path: `/v5/livedns/domains/${ZONE}/records?rrset_type=TXT&per_page=1`, method: "GET" })
					.reply(zoneStatus, zoneStatus === 200 ? [] : { message: "no zone" }, json);
			}
			api("api.gandi.net")
				.intercept({ path: `/v5/livedns/domains/${ZONE}/records/home/${type}`, method: "GET" })
				.reply(status, status === 200 ? { rrset_values: values, rrset_ttl: 300 } : { message: "gone" }, json);
		},
		del(type, status, body) {
			api("api.gandi.net")
				.intercept({ path: `/v5/livedns/domains/${ZONE}/records/home/${type}`, method: "DELETE" })
				.reply(status, body, json);
		},
		ok: [204, ""],
		forbidden: [403, { message: `Access was denied ${TOKEN}` }],
		gone: [404, { message: "gone" }],
	},
	ovh: {
		fields: {
			dns_ovh_endpoint: "ovh-eu",
			dns_ovh_application_key: "app-key",
			dns_ovh_application_secret: OVH_SECRET,
			dns_ovh_consumer_key: OVH_CONSUMER,
		},
		secrets: [OVH_SECRET, OVH_CONSUMER],
		ids: true,
		read(type, values) {
			ovhTime();
			const pool = api("eu.api.ovh.com");
			pool.intercept({ path: `${OVH_BASE}/record?fieldType=${type}&subDomain=home`, method: "GET" }).reply(
				200,
				values.map((_, i) => ID + i),
				json,
			);
			values.forEach((target, i) => {
				pool.intercept({ path: `${OVH_BASE}/record/${ID + i}`, method: "GET" }).reply(
					200,
					{ id: ID + i, fieldType: type, subDomain: "home", target },
					json,
				);
			});
		},
		del(_type, status, body) {
			ovhTime();
			api("eu.api.ovh.com")
				.intercept({ path: `${OVH_BASE}/record/${ID}`, method: "DELETE" })
				.reply(status, body, json);
		},
		// the zone refresh follows a delete that happened
		after() {
			ovhTime();
			api("eu.api.ovh.com")
				.intercept({ path: `${OVH_BASE}/refresh`, method: "POST" })
				.reply(200, "", json);
		},
		ok: [200, ""],
		forbidden: [403, { class: "Client::Forbidden", message: `This call has not been granted ${OVH_CONSUMER}` }],
		gone: [404, { message: "gone" }],
	},
	desec: {
		fields: { dns_desec_token: TOKEN },
		secrets: [TOKEN],
		read(type, values, status = 200, zoneStatus = 200) {
			if (status === 404) {
				api("desec.io")
					.intercept({
						path: `/api/v1/domains/${ZONE}/rrsets/?type=TXT&subname=_acme-challenge`,
						method: "GET",
					})
					.reply(zoneStatus, zoneStatus === 200 ? [] : { detail: "Not found." }, json);
			}
			api("desec.io")
				.intercept({ path: `/api/v1/domains/${ZONE}/rrsets/home/${type}/`, method: "GET" })
				.reply(status, status === 200 ? { records: values, ttl: 3600 } : { detail: "Not found." }, json);
		},
		del(type, status, body) {
			api("desec.io")
				.intercept({ path: `/api/v1/domains/${ZONE}/rrsets/home/${type}/`, method: "DELETE" })
				.reply(status, body, json);
		},
		ok: [204, ""],
		forbidden: [403, { detail: `You do not have permission ${TOKEN}` }],
		gone: [404, { detail: "Not found." }],
	},
	porkbun: {
		fields: { dns_porkbun_key: TOKEN, dns_porkbun_secret: SECRET },
		secrets: [TOKEN, SECRET],
		ids: true,
		read(type, values) {
			api("api.porkbun.com")
				.intercept({ path: `/api/json/v3/dns/retrieveByNameType/${ZONE}/${type}/home`, method: "POST" })
				.reply(
					200,
					{
						status: "SUCCESS",
						records: values.map((content, i) => ({
							id: String(ID + i),
							type,
							name: NAME,
							content,
							ttl: "600",
						})),
					},
					json,
				);
		},
		del(_type, status, body) {
			api("api.porkbun.com")
				.intercept({ path: `/api/json/v3/dns/delete/${ZONE}/${ID}`, method: "POST" })
				.reply(status, body, json);
		},
		ok: [200, { status: "SUCCESS" }],
		forbidden: [403, { status: "ERROR", code: "INSUFFICIENT_SCOPE", message: `Scope missing ${TOKEN} ${SECRET}` }],
		gone: [400, { status: "ERROR", code: "INVALID_RECORD_ID", message: "DNS record ID was not found" }],
		documentedGone: true,
	},
};

// a read that answers with a status (a refusal, a missing zone) instead of records
const READ_STATUS = {
	cloudflare: (status, body) =>
		api("api.cloudflare.com")
			.intercept({ path: `/client/v4/zones/${ZID}/dns_records?type=A&name.exact=${NAME}`, method: "GET" })
			.reply(status, body, json),
	digitalocean: (status, body) =>
		api("api.digitalocean.com")
			.intercept({ path: `/v2/domains/${ZONE}/records?type=A&name=${NAME}`, method: "GET" })
			.reply(status, body, json),
	"hetzner-cloud": (status, body) =>
		api("api.hetzner.cloud")
			.intercept({ path: `/v1/zones/${ZONE}/rrsets/home/A`, method: "GET" })
			.reply(status, body, json),
	gandi: (status, body) =>
		api("api.gandi.net")
			.intercept({ path: `/v5/livedns/domains/${ZONE}/records/home/A`, method: "GET" })
			.reply(status, body, json),
	ovh: (status, body) => {
		ovhTime();
		api("eu.api.ovh.com")
			.intercept({ path: `${OVH_BASE}/record?fieldType=A&subDomain=home`, method: "GET" })
			.reply(status, body, json);
	},
	desec: (status, body) =>
		api("desec.io")
			.intercept({ path: `/api/v1/domains/${ZONE}/rrsets/home/A/`, method: "GET" })
			.reply(status, body, json),
	porkbun: (status, body) =>
		api("api.porkbun.com")
			.intercept({ path: `/api/json/v3/dns/retrieveByNameType/${ZONE}/A/home`, method: "POST" })
			.reply(status, body, json),
};
const forbiddenError = (err) =>
	err instanceof DdnsProviderError && err.code === "forbidden" && err.providerStatus === 401;

const removeOf = (id, args = {}) =>
	providerById(id).remove({
		...SCOPE,
		type: "A",
		value: V4,
		fields: CASES[id].fields,
		fetch: (url, options) => providerFetch(url, { ...options, secrets: CASES[id].secrets }),
		meta: CASES[id].meta,
		...args,
	});
const afterOf = (c) => c.after?.();

describe("removes", () => {
	it("is true exactly for the seven providers with a confirmed delete", () => {
		for (const id of Object.keys(CASES)) assert.equal(removes(id), true, id);
		for (const provider of PROVIDERS.filter((entry) => !Object.hasOwn(CASES, entry.id))) {
			assert.equal(removes(provider.credentialProvider), false, provider.id);
		}
		assert.equal(removes("nothing"), false);
		assert.equal(removes(undefined), false);
	});
});

for (const [id, c] of Object.entries(CASES)) {
	describe(`${id} record delete`, () => {
		it("deletes the A record that holds the written address", async () => {
			c.read("A", [V4]);
			c.del("A", ...c.ok);
			afterOf(c);
			assert.deepEqual(await removeOf(id), { gone: false });
		});

		it("deletes an AAAA record whose address is spelled another way", async () => {
			c.read("AAAA", ["2001:0DB8:0:0:0:0:0:7"]);
			c.del("AAAA", ...c.ok);
			afterOf(c);
			assert.deepEqual(await removeOf(id, { type: "AAAA", value: V6 }), { gone: false });
		});

		it("a record with another address is another client's: changed, nothing deleted", async () => {
			c.read("A", ["198.51.100.9"]);
			assert.deepEqual(await removeOf(id), { gone: false, changed: true });
		});

		it("a set with another value added keeps the whole set: changed, nothing deleted", async () => {
			c.read("A", [V4, "198.51.100.9"]);
			assert.deepEqual(await removeOf(id), { gone: false, changed: true });
		});

		it("a record that is not there is gone without a delete", async () => {
			c.read("A", [], 404);
			assert.deepEqual(await removeOf(id), { gone: true });
		});

		it("a 403 is forbidden with the secrets scrubbed", async () => {
			c.read("A", [V4]);
			c.del("A", ...c.forbidden);
			await assert.rejects(removeOf(id), (err) => {
				assert.ok(err instanceof DdnsProviderError);
				assert.equal(err.code, "forbidden");
				assert.equal(err.providerStatus, 403);
				for (const secret of c.secrets) assert.equal(err.message.includes(secret), false);
				return true;
			});
		});

		// the documented gone answers of DigitalOcean and Porkbun need no second read (own tests below)
		it("a 401 on the read is forbidden, never gone", async () => {
			READ_STATUS[id](401, { message: `bad key ${TOKEN}`, status: "ERROR" });
			await assert.rejects(removeOf(id), forbiddenError);
		});

		it("a 401 on the delete is forbidden, never gone", async () => {
			c.read("A", [V4]);
			c.del("A", 401, { message: `bad key ${TOKEN}`, status: "ERROR" });
			await assert.rejects(removeOf(id), forbiddenError);
		});

		// the generic recheck test below
		it("a failed delete is read again and an absent record is gone", { skip: c.documentedGone }, async () => {
			c.read("A", [V4]);
			c.del("A", ...c.gone);
			c.read("A", [], 404);
			assert.deepEqual(await removeOf(id), { gone: true });
		});

		it("a failed delete of a record that is still there stays a failure", async () => {
			c.read("A", [V4]);
			c.del("A", 500, { status: "ERROR", message: "boom" });
			c.read("A", [V4]);
			await assert.rejects(removeOf(id), (err) => err.code === "failed" && err.providerStatus === 500);
		});

		it("refuses another type, a name outside the zone and a bad value before any call", async () => {
			for (const args of [
				{ type: "CNAME" },
				{ type: "TXT" },
				{ type: "constructor" },
				{ name: "www.example.net" },
				{ name: "evilexample.org" },
				{ name: undefined },
				{ value: "not-an-address" },
				{ value: V6 },
				{ type: "AAAA", value: V4 },
				{ value: "" },
			]) {
				await assert.rejects(
					removeOf(id, args),
					(err) => err instanceof DdnsProviderError && err.code === "failed",
					JSON.stringify(args),
				);
			}
		});
	});
}

describe("providers with a record id", () => {
	for (const id of Object.keys(CASES).filter((key) => CASES[key].ids && key !== "ovh")) {
		it(`${id}: a stored id that is not the found record's is changed, nothing deleted`, async () => {
			const c = CASES[id];
			c.read("A", [V4]);
			assert.deepEqual(await removeOf(id, { meta: { ...c.meta, record_id: "999" } }), {
				gone: false,
				changed: true,
			});
		});
	}
});

describe("documented gone answers", () => {
	it("digitalocean: a 404 not_found of the delete is gone without another read", async () => {
		const c = CASES.digitalocean;
		c.read("A", [V4]);
		c.del("A", ...c.gone);
		assert.deepEqual(await removeOf("digitalocean"), { gone: true });
	});
	it("porkbun: INVALID_RECORD_ID of the delete is gone without another read", async () => {
		const c = CASES.porkbun;
		c.read("A", [V4]);
		c.del("A", ...c.gone);
		assert.deepEqual(await removeOf("porkbun"), { gone: true });
	});
});

describe("a missing zone is a failure, never gone", () => {
	const notGone = (err) => err instanceof DdnsProviderError && err.code === "failed";
	const missing = (err) => err instanceof DdnsProviderError && err.code === "failed" && err.providerStatus === 404;
	it("digitalocean: the read answers 404", async () => {
		api("api.digitalocean.com")
			.intercept({ path: `/v2/domains/${ZONE}/records?type=A&name=${NAME}`, method: "GET" })
			.reply(404, { id: "not_found" }, json);
		await assert.rejects(removeOf("digitalocean"), missing);
	});
	it("cloudflare: the zone is not on the credential", async () => {
		api("api.cloudflare.com")
			.intercept({ path: `/client/v4/zones?name=${ZONE}`, method: "GET" })
			.reply(200, { success: true, result: [] }, json);
		await assert.rejects(removeOf("cloudflare", { meta: undefined }), notGone);
	});
	it("cloudflare: the records call answers 404", async () => {
		READ_STATUS.cloudflare(404, { success: false, errors: [{ code: 7003, message: "no route" }] });
		await assert.rejects(removeOf("cloudflare"), notGone);
	});
	it("ovh: the record list answers 404", async () => {
		READ_STATUS.ovh(404, { message: "no zone" });
		await assert.rejects(removeOf("ovh"), missing);
	});
	it("porkbun: INVALID_DOMAIN", async () => {
		READ_STATUS.porkbun(400, { status: "ERROR", code: "INVALID_DOMAIN", message: "Invalid domain." });
		await assert.rejects(removeOf("porkbun"), notGone);
	});
	for (const id of ["gandi", "desec", "hetzner-cloud"]) {
		it(`${id}: a 404 on the set and on the zone`, async () => {
			CASES[id].read("A", [], 404, 404);
			await assert.rejects(removeOf(id), missing);
		});
	}
});

describe("cloudflare record delete details", () => {
	it("looks the zone up when none is cached and never sends the record id of another zone", async () => {
		const c = CASES.cloudflare;
		api("api.cloudflare.com")
			.intercept({ path: `/client/v4/zones?name=${ZONE}`, method: "GET" })
			.reply(200, { success: true, result: [{ id: ZID }] }, json);
		c.read("A", [V4]);
		c.del("A", ...c.ok);
		assert.deepEqual(await removeOf("cloudflare", { meta: undefined }), { gone: false });
	});
	it("only the record of the type and name is looked at: another type at the answer is ignored", async () => {
		api("api.cloudflare.com")
			.intercept({ path: `/client/v4/zones/${ZID}/dns_records?type=A&name.exact=${NAME}`, method: "GET" })
			.reply(200, { success: true, result: [{ id: cfId(9), type: "TXT", name: NAME, content: V4 }] }, json);
		assert.deepEqual(await removeOf("cloudflare"), { gone: true });
	});
});

describe("ovh record delete details", () => {
	it("refreshes the zone after the delete and a failed refresh is a failure", async () => {
		const c = CASES.ovh;
		c.read("A", [V4]);
		c.del("A", ...c.ok);
		ovhTime();
		api("eu.api.ovh.com")
			.intercept({ path: `${OVH_BASE}/refresh`, method: "POST" })
			.reply(500, { message: `no ${OVH_SECRET}` }, json);
		await assert.rejects(removeOf("ovh"), (err) => {
			assert.match(err.message, DELETED_REFRESH_FAILED);
			assert.equal(err.message.includes(OVH_SECRET), false);
			return true;
		});
	});
	it("a pending refresh of an earlier change is done first", async () => {
		const c = CASES.ovh;
		ovhTime();
		api("eu.api.ovh.com")
			.intercept({ path: `${OVH_BASE}/refresh`, method: "POST" })
			.reply(200, "", json);
		c.read("A", [V4]);
		c.del("A", ...c.ok);
		c.after();
		assert.deepEqual(await removeOf("ovh", { meta: { refresh_pending: true } }), { gone: false });
	});
	it("a refused apex and a wildcard are refused before a call", async () => {
		for (const name of [ZONE, `*.${ZONE}`]) {
			await assert.rejects(removeOf("ovh", { name }), (err) => err instanceof DdnsProviderError);
		}
	});
	it("a stored id that is not the found record's is changed", async () => {
		CASES.ovh.read("A", [V4]);
		assert.deepEqual(await removeOf("ovh", { meta: { record_id: 99 } }), { gone: false, changed: true });
	});
});

describe("an answer with another type or name is ignored", () => {
	it("digitalocean", async () => {
		for (const records of [
			[{ id: ID, type: "TXT", name: "home", data: V4 }],
			[{ id: ID, type: "A", name: "www", data: V4 }],
		]) {
			api("api.digitalocean.com")
				.intercept({ path: `/v2/domains/${ZONE}/records?type=A&name=${NAME}`, method: "GET" })
				.reply(200, { domain_records: records }, json);
			assert.deepEqual(await removeOf("digitalocean"), { gone: true });
		}
	});
	it("cloudflare: another name", async () => {
		api("api.cloudflare.com")
			.intercept({ path: `/client/v4/zones/${ZID}/dns_records?type=A&name.exact=${NAME}`, method: "GET" })
			.reply(
				200,
				{ success: true, result: [{ id: cfId(9), type: "A", name: `www.${ZONE}`, content: V4 }] },
				json,
			);
		assert.deepEqual(await removeOf("cloudflare"), { gone: true });
	});
	it("ovh", async () => {
		ovhTime();
		const pool = api("eu.api.ovh.com");
		pool.intercept({ path: `${OVH_BASE}/record?fieldType=A&subDomain=home`, method: "GET" }).reply(
			200,
			[7, 8],
			json,
		);
		pool.intercept({ path: `${OVH_BASE}/record/7`, method: "GET" }).reply(
			200,
			{ id: 7, fieldType: "TXT", subDomain: "home", target: V4 },
			json,
		);
		pool.intercept({ path: `${OVH_BASE}/record/8`, method: "GET" }).reply(
			200,
			{ id: 8, fieldType: "A", subDomain: "www", target: V4 },
			json,
		);
		assert.deepEqual(await removeOf("ovh"), { gone: true });
	});
	it("porkbun", async () => {
		for (const record of [
			{ id: "7", type: "TXT", name: NAME, content: V4 },
			{ id: "7", type: "A", name: `www.${ZONE}`, content: V4 },
		]) {
			api("api.porkbun.com")
				.intercept({ path: `/api/json/v3/dns/retrieveByNameType/${ZONE}/A/home`, method: "POST" })
				.reply(200, { status: "SUCCESS", records: [record] }, json);
			assert.deepEqual(await removeOf("porkbun"), { gone: true });
		}
	});
});

describe("a bad id from the provider's list is refused before any delete", () => {
	const bad = (err) => err instanceof DdnsProviderError && BAD_ID.test(err.message);
	it("cloudflare", async () => {
		api("api.cloudflare.com")
			.intercept({ path: `/client/v4/zones/${ZID}/dns_records?type=A&name.exact=${NAME}`, method: "GET" })
			.reply(200, { success: true, result: [{ id: "../x", type: "A", name: NAME, content: V4 }] }, json);
		await assert.rejects(removeOf("cloudflare"), bad);
	});
	it("digitalocean", async () => {
		api("api.digitalocean.com")
			.intercept({ path: `/v2/domains/${ZONE}/records?type=A&name=${NAME}`, method: "GET" })
			.reply(200, { domain_records: [{ id: "7/../x", type: "A", name: "home", data: V4 }] }, json);
		await assert.rejects(removeOf("digitalocean"), bad);
	});
	it("porkbun", async () => {
		api("api.porkbun.com")
			.intercept({ path: `/api/json/v3/dns/retrieveByNameType/${ZONE}/A/home`, method: "POST" })
			.reply(200, { status: "SUCCESS", records: [{ id: "../x", type: "A", name: NAME, content: V4 }] }, json);
		await assert.rejects(removeOf("porkbun"), bad);
	});
	it("ovh: an id that is not a number in the list is an unexpected answer", async () => {
		ovhTime();
		api("eu.api.ovh.com")
			.intercept({ path: `${OVH_BASE}/record?fieldType=A&subDomain=home`, method: "GET" })
			.reply(200, ["../x"], json);
		await assert.rejects(
			removeOf("ovh"),
			(err) => err instanceof DdnsProviderError && err.message === "Unexpected answer shape",
		);
	});
});

describe("a cached cloudflare zone id", () => {
	it("that is not 32 hex characters is looked up again, never put into a path", async () => {
		const c = CASES.cloudflare;
		api("api.cloudflare.com")
			.intercept({ path: `/client/v4/zones?name=${ZONE}`, method: "GET" })
			.reply(200, { success: true, result: [{ id: ZID }] }, json);
		c.read("A", [V4]);
		c.del("A", ...c.ok);
		assert.deepEqual(await removeOf("cloudflare", { meta: { zone_id: "../x" } }), { gone: false });
	});
});
