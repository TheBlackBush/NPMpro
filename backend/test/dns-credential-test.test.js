import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DdnsProviderError } from "../lib/ddns/errors.js";
import cloudflare from "../lib/ddns/providers/cloudflare.js";
import desec from "../lib/ddns/providers/desec.js";
import digitalocean from "../lib/ddns/providers/digitalocean.js";
import gandi from "../lib/ddns/providers/gandi.js";
import hetzner from "../lib/ddns/providers/hetzner-cloud.js";
import ovh from "../lib/ddns/providers/ovh.js";
import porkbun from "../lib/ddns/providers/porkbun.js";
import { testCredential } from "../lib/dns-check/credential-test.js";

const TOKEN = "do-token-1234567890";
const FIELDS = { dns_digitalocean_token: TOKEN };

// a fake provider call: the answers are picked by the start of the url
const fakeFetch =
	(routes, calls = []) =>
	(url, options) => {
		calls.push(url);
		for (const [prefix, answer] of routes) {
			if (!url.startsWith(prefix)) continue;
			if (answer instanceof Error) return Promise.reject(answer);
			return Promise.resolve({
				status: answer.status ?? 200,
				json: answer.json ?? null,
				text: JSON.stringify(answer.json ?? ""),
				headers: {},
			});
		}
		return Promise.reject(new Error(`unexpected ${url} ${JSON.stringify(options?.headers)}`));
	};
const ZONES = "https://api.digitalocean.com/v2/domains?";
const RECORDS = "https://api.digitalocean.com/v2/domains/example.com/records";
const page = { json: { domains: [{ name: "example.com" }, { name: "example.org" }], links: {} } };
const run = (routes, extra = {}) =>
	testCredential({ provider: digitalocean, fields: FIELDS, secrets: [TOKEN], fetch: fakeFetch(routes), ...extra });

describe("testCredential", () => {
	it("works with a zone page and a record read that finds nothing", async () => {
		const calls = [];
		const result = await testCredential({
			provider: digitalocean,
			fields: FIELDS,
			secrets: [TOKEN],
			domains: ["example.com"],
			fetch: fakeFetch(
				[
					[ZONES, page],
					[RECORDS, { json: { domain_records: [] } }],
				],
				calls,
			),
		});
		assert.deepEqual(result, { supported: true, state: "works", zones_seen: 2, needs: null, message: null });
		assert.equal(calls.length, 2);
		assert.ok(calls[1].startsWith(RECORDS));
	});

	it("reads only a zone the zone page listed: a domain below a zone or not on the page is not read", async () => {
		const calls = [];
		const below = await run([[ZONES, page]], {
			domains: ["sub.example.com", "missing.example"],
			fetch: fakeFetch([[ZONES, page]], calls),
		});
		assert.equal(below.state, "works");
		assert.equal(calls.length, 1);
		const later = [];
		const other = "https://api.digitalocean.com/v2/domains/example.org/records";
		const listed = await run([], {
			domains: ["sub.example.com", "Example.ORG"],
			fetch: fakeFetch(
				[
					[ZONES, page],
					[other, { json: { domain_records: [] } }],
				],
				later,
			),
		});
		assert.equal(listed.state, "works");
		assert.equal(later.length, 2);
		assert.ok(later[1].startsWith(other));
	});

	it("makes no record read without a domain", async () => {
		const calls = [];
		const result = await testCredential({
			provider: digitalocean,
			fields: FIELDS,
			secrets: [TOKEN],
			fetch: fakeFetch([[ZONES, page]], calls),
		});
		assert.equal(result.state, "works");
		assert.equal(calls.length, 1);
	});

	it("reads one zone page only", async () => {
		const calls = [];
		const next = { json: { domains: [{ name: "a.example" }], links: { pages: { next: "x" } } } };
		const result = await testCredential({
			provider: digitalocean,
			fields: FIELDS,
			secrets: [TOKEN],
			fetch: fakeFetch([[ZONES, next]], calls),
		});
		assert.equal(result.state, "works");
		assert.equal(calls.length, 1);
	});

	it("maps 401 and 403 of DigitalOcean to wrong-key and missing-right with the right named", async () => {
		const wrong = await run([[ZONES, { status: 401, json: { message: `bad ${TOKEN}` } }]]);
		assert.equal(wrong.state, "wrong-key");
		assert.ok(!wrong.message.includes(TOKEN));
		assert.ok(wrong.message.includes("***"));
		const missing = await run([[ZONES, { status: 403, json: { message: "no" } }]]);
		assert.equal(missing.state, "missing-right");
		assert.equal(typeof missing.needs, "string");
		assert.ok(missing.needs.length > 0);
	});

	it("maps a refused record read like a refused zone list", async () => {
		const result = await run(
			[
				[ZONES, page],
				[RECORDS, { status: 403, json: { message: "no" } }],
			],
			{
				domains: ["example.com"],
			},
		);
		assert.equal(result.state, "missing-right");
	});

	it("says refused for Gandi 403 and for OVH", async () => {
		const gandiResult = await testCredential({
			provider: gandi,
			fields: { dns_gandi_token: "gandi-token-12345" },
			secrets: ["gandi-token-12345"],
			fetch: fakeFetch([["https://api.gandi.net/", { status: 403, json: { message: "denied" } }]]),
		});
		assert.equal(gandiResult.state, "refused");
		const gandi401 = await testCredential({
			provider: gandi,
			fields: { dns_gandi_token: "gandi-token-12345" },
			secrets: ["gandi-token-12345"],
			fetch: fakeFetch([["https://api.gandi.net/", { status: 401, json: { message: "denied" } }]]),
		});
		assert.equal(gandi401.state, "wrong-key");
		assert.equal(ovh.apex, false);
	});

	it("makes no record read for OVH, which has no apex read", async () => {
		const calls = [];
		const result = await testCredential({
			provider: ovh,
			fields: {
				dns_ovh_endpoint: "ovh-eu",
				dns_ovh_application_key: "ak-12345",
				dns_ovh_application_secret: "as-12345",
				dns_ovh_consumer_key: "ck-12345",
			},
			secrets: ["as-12345", "ck-12345"],
			domains: ["example.com"],
			fetch: fakeFetch(
				[
					["https://eu.api.ovh.com/1.0/auth/time", { json: 1700000000 }],
					["https://eu.api.ovh.com/1.0/domain/zone", { json: ["example.com"] }],
				],
				calls,
			),
		});
		assert.equal(result.state, "works");
		assert.ok(
			calls.every((url) => !url.includes("/record")),
			calls.join(" "),
		);
	});

	it("says refused for a 403 of OVH and deSEC, missing-right for Porkbun 403 and wrong-key for 400", async () => {
		const any = (status) =>
			fakeFetch([["https://", { status, json: { message: "no", status: "ERROR", code: "INVALID_API_KEYS" } }]]);
		const ovhFields = {
			dns_ovh_endpoint: "ovh-eu",
			dns_ovh_application_key: "ak-12345",
			dns_ovh_application_secret: "as-12345",
			dns_ovh_consumer_key: "ck-12345",
		};
		const ovh403 = await testCredential({ provider: ovh, fields: ovhFields, secrets: [], fetch: any(403) });
		assert.equal(ovh403.state, "refused");
		const desec403 = await testCredential({
			provider: desec,
			fields: { dns_desec_token: "desec-token-1234" },
			secrets: [],
			fetch: any(403),
		});
		assert.equal(desec403.state, "refused");
		const pb = { dns_porkbun_key: "pk-12345", dns_porkbun_secret: "sk-12345" };
		assert.equal(
			(await testCredential({ provider: porkbun, fields: pb, secrets: [], fetch: any(403) })).state,
			"missing-right",
		);
		assert.equal(
			(await testCredential({ provider: porkbun, fields: pb, secrets: [], fetch: any(400) })).state,
			"wrong-key",
		);
	});

	it("maps a zone the account does not have (404 of a record read) to failed for DigitalOcean", async () => {
		const result = await run(
			[
				[ZONES, page],
				[RECORDS, { status: 404, json: { message: "not found" } }],
			],
			{
				domains: ["example.com"],
			},
		);
		assert.equal(result.state, "failed");
		assert.ok(result.message.length > 0);
	});

	it("maps Hetzner 401 and 403", async () => {
		const run401 = (status) =>
			testCredential({
				provider: hetzner,
				fields: { dns_hetzner_cloud_api_token: "hetzner-token-1234" },
				secrets: ["hetzner-token-1234"],
				fetch: fakeFetch([["https://api.hetzner.cloud/", { status, json: { error: { message: "no" } } }]]),
			});
		assert.equal((await run401(401)).state, "wrong-key");
		assert.equal((await run401(403)).state, "missing-right");
	});

	it("asks Cloudflare's verify call after a refusal: 401 code 1000 is wrong-key, else refused", async () => {
		const token = "cf-token-1234567890";
		const withVerify = (verify) =>
			testCredential({
				provider: cloudflare,
				fields: { dns_cloudflare_api_token: token },
				secrets: [token],
				fetch: fakeFetch([
					[
						"https://api.cloudflare.com/client/v4/zones",
						{ status: 403, json: { success: false, errors: [{ code: 9109, message: "Invalid" }] } },
					],
					["https://api.cloudflare.com/client/v4/user/tokens/verify", verify],
				]),
			});
		const wrong = await withVerify({
			status: 401,
			json: { success: false, errors: [{ code: 1000, message: "Invalid API Token" }] },
		});
		assert.equal(wrong.state, "wrong-key");
		assert.equal(
			(await withVerify({ status: 403, json: { success: false, errors: [{ code: 9109 }] } })).state,
			"refused",
		);
		assert.equal((await withVerify({ status: 200, json: { success: true } })).state, "refused");
	});

	it("keeps refused when the Cloudflare verify call fails", async () => {
		const token = "cf-token-1234567890";
		const result = await testCredential({
			provider: cloudflare,
			fields: { dns_cloudflare_api_token: token },
			secrets: [token],
			fetch: fakeFetch([
				[
					"https://api.cloudflare.com/client/v4/zones",
					{ status: 403, json: { success: false, errors: [{ code: 9109, message: "Invalid" }] } },
				],
				[
					"https://api.cloudflare.com/client/v4/user/tokens/verify",
					new DdnsProviderError({ code: "timeout", message: "late" }),
				],
			]),
		});
		assert.equal(result.state, "refused");
	});

	it("rethrows a bug in the Cloudflare verify call instead of reading it as refused", async () => {
		const token = "cf-token-1234567890";
		await assert.rejects(
			testCredential({
				provider: cloudflare,
				fields: { dns_cloudflare_api_token: token },
				secrets: [token],
				fetch: fakeFetch([
					[
						"https://api.cloudflare.com/client/v4/zones",
						{ status: 403, json: { success: false, errors: [{ code: 9109, message: "Invalid" }] } },
					],
					["https://api.cloudflare.com/client/v4/user/tokens/verify", new TypeError("bug")],
				]),
			}),
			TypeError,
		);
	});

	it("maps timeout and network to unreachable, blocked to blocked, the rest to failed", async () => {
		const throws = (code) => run([[ZONES, new DdnsProviderError({ code, message: "x" })]]);
		assert.equal((await throws("timeout")).state, "unreachable");
		assert.equal((await throws("network")).state, "unreachable");
		assert.equal((await throws("blocked")).state, "blocked");
		assert.equal((await throws("not-https")).state, "failed");
		const server = await run([[ZONES, { status: 500, json: { message: "boom" } }]]);
		assert.equal(server.state, "failed");
		assert.equal(server.needs, null);
		assert.ok(server.message.includes("boom"));
	});

	it("rethrows an error that is not a provider error", async () => {
		await assert.rejects(run([[ZONES, new TypeError("bug")]]), TypeError);
	});
});
