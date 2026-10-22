import assert from "node:assert/strict";
import { it } from "node:test";
import dnsFields from "../certbot/dns-fields.json" with { type: "json" };
import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { buildValues, getFieldDefinition, publicView, toIni } from "../lib/dns-credential-values.js";

const apiKeyRequired = /API key/u;
const unknownKeyDns = /dns_other/u;
const lineBreakError = /line break/u;
const oneOfError = /one of/u;
const globalKeyRequired = /Global API key/u;
const tokenRequired = /Token/u;
const credentialsRequired = /credentials/u;
const noDefinitionError = /no field definition/u;
const eitherError = /either/u;
const secretValue = /secret"/u;

const f = (pairs) => Object.entries(pairs).map(([key, value]) => ({ key, value }));

it("every field definition belongs to a known provider and its keys appear in the plugin template", () => {
	for (const [provider, def] of Object.entries(dnsFields)) {
		assert.ok(dnsPlugins[provider], `unknown provider ${provider}`);
		for (const field of def.fields) {
			assert.ok(
				dnsPlugins[provider].credentials.includes(field.key),
				`${provider}: ${field.key} not in template`,
			);
		}
	}
});

it("providers without a definition return null", () => {
	assert.equal(getFieldDefinition("google"), null);
});

it("fields build values and INI lines in definition order", () => {
	const values = buildValues("porkbun", { fields: f({ dns_porkbun_secret: "s", dns_porkbun_key: "k" }) }, null);
	assert.deepEqual(values, { fields: { dns_porkbun_key: "k", dns_porkbun_secret: "s" } });
	assert.equal(toIni(values), "dns_porkbun_key = k\ndns_porkbun_secret = s\n");
});

it("values are trimmed and empty optional fields are left out", () => {
	const values = buildValues("desec", { fields: f({ dns_desec_token: " t ", dns_desec_endpoint: "" }) }, null);
	assert.deepEqual(values, { fields: { dns_desec_token: "t" } });
});

it("a missing required field is rejected", () => {
	assert.throws(() => buildValues("namecheap", { fields: f({ dns_namecheap_username: "u" }) }, null), apiKeyRequired);
});

it("an unknown field key is rejected", () => {
	assert.throws(
		() => buildValues("vultr", { fields: f({ dns_vultr_key: "k", dns_other: "x" }) }, null),
		unknownKeyDns,
	);
});

it("a newline in a value is rejected", () => {
	assert.throws(
		() => buildValues("vultr", { fields: f({ dns_vultr_key: "k\ndns_injected = 1" }) }, null),
		lineBreakError,
	);
	assert.throws(() => buildValues("vultr", { fields: f({ dns_vultr_key: "k\rx" }) }, null), lineBreakError);
});

it("one_of requires exactly one complete group", () => {
	const token = buildValues("cloudflare", { fields: f({ dns_cloudflare_api_token: "t" }) }, null);
	assert.deepEqual(token, { fields: { dns_cloudflare_api_token: "t" } });
	assert.throws(() => buildValues("cloudflare", { fields: [] }, null), oneOfError);
	assert.throws(
		() =>
			buildValues(
				"cloudflare",
				{
					fields: f({
						dns_cloudflare_api_token: "t",
						dns_cloudflare_email: "a@b.c",
						dns_cloudflare_api_key: "k",
					}),
				},
				null,
			),
		oneOfError,
	);
	assert.throws(
		() => buildValues("cloudflare", { fields: f({ dns_cloudflare_email: "a@b.c" }) }, null),
		globalKeyRequired,
	);
});

it("an empty secret keeps the previous value of the same provider", () => {
	const previous = { fields: { dns_namecheap_username: "u", dns_namecheap_api_key: "old" } };
	const values = buildValues(
		"namecheap",
		{ fields: f({ dns_namecheap_username: "u2", dns_namecheap_api_key: "" }) },
		previous,
	);
	assert.deepEqual(values, { fields: { dns_namecheap_username: "u2", dns_namecheap_api_key: "old" } });
});

it("previous values are ignored when they came from another provider", () => {
	const previous = { fields: { dns_vultr_key: "old" } };
	assert.throws(() => buildValues("duckdns", { fields: f({ dns_duckdns_token: "" }) }, previous), tokenRequired);
});

it("ini fallback is used for providers without a definition and keeps the old text when empty", () => {
	assert.deepEqual(buildValues("google", { ini: "dns_google_credentials = /x.json" }, null), {
		ini: "dns_google_credentials = /x.json",
	});
	assert.deepEqual(buildValues("google", { ini: "" }, { ini: "old" }), { ini: "old" });
	assert.throws(() => buildValues("google", { ini: "" }, null), credentialsRequired);
	assert.throws(() => buildValues("google", { fields: f({ a: "b" }) }, null), noDefinitionError);
});

it("ini is accepted for defined providers too (migrated credentials)", () => {
	assert.deepEqual(buildValues("vultr", { ini: "dns_vultr_key = k" }, null), { ini: "dns_vultr_key = k" });
	assert.equal(toIni({ ini: "dns_vultr_key = k" }), "dns_vultr_key = k\n");
});

it("passing both ini and fields is rejected", () => {
	assert.throws(() => buildValues("vultr", { ini: "x", fields: f({ dns_vultr_key: "k" }) }, null), eitherError);
});

it("publicView never contains secret values", () => {
	const view = publicView("namecheap", { fields: { dns_namecheap_username: "u", dns_namecheap_api_key: "secret" } });
	assert.deepEqual(view, {
		fields: [
			{ key: "dns_namecheap_username", value: "u", is_set: true },
			{ key: "dns_namecheap_api_key", is_set: true },
		],
		ini_set: false,
	});
	assert.ok(!secretValue.test(JSON.stringify(view)));
	assert.deepEqual(publicView("google", { ini: "x" }), { fields: [], ini_set: true });
});

it("publicView of undecryptable values marks nothing as set", () => {
	assert.deepEqual(publicView("vultr", null), { fields: [{ key: "dns_vultr_key", is_set: false }], ini_set: false });
});
