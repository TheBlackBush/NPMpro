import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import { chosenProvider, ddnsRecordPayload, ddnsRecordValidate, ddnsRulesInput } from "./DdnsForms.js";
import {
	CREDENTIAL,
	credentiallessChoices,
	providerFieldsOf,
	providerIdOf,
	providerNoteOf,
	withoutCredential,
} from "./DdnsProviderRules.js";

const base = { aliases: false, wildcards: false, zoneless: false, preset: false, apex: true, minTtl: null, ipv6: true };
const PROVIDERS = [
	{
		...base,
		id: "cloudflare",
		label: "Cloudflare",
		credentialProvider: "cloudflare",
		aliases: true,
		wildcards: true,
	},
	{ ...base, id: "ovh", label: "OVH", credentialProvider: "ovh", apex: false },
	{ ...base, id: "desec", label: "deSEC", credentialProvider: "desec", minTtl: 3600 },
	{
		...base,
		id: "duckdns",
		label: "DuckDNS",
		credentialProvider: "duckdns",
		zoneless: true,
		zone: "duckdns.org",
	},
	{
		...base,
		id: "namecheap",
		label: "Namecheap",
		credentialProvider: null,
		zoneless: true,
		preset: true,
		ipv6: false,
	},
	{ ...base, id: "noip", label: "No-IP", credentialProvider: null, zoneless: true, preset: true, ipv6Alone: false },
	{ ...base, id: "dynu", label: "Dynu", credentialProvider: null, zoneless: true, preset: true },
	{ ...base, id: "custom", label: "Custom HTTP", credentialProvider: null, zoneless: true, adminOnly: true },
];
const byId = (id) => PROVIDERS.find((provider) => provider.id === id);
const FORM = {
	name: "home.example.com",
	providerId: "noip",
	kind: "address",
	ipVersion: "ipv4",
	enabled: true,
	username: "me",
	password: "secret-pass",
	url: "",
	domain: "",
	ttl: "",
};
const check = (values, stored = null) => {
	const form = { ...FORM, ...values };
	return ddnsRecordValidate(ddnsRulesInput(form, chosenProvider(form, PROVIDERS, [])), {
		providers: PROVIDERS,
		credentials: [],
		zones: [],
		stored,
	});
};

it("offers the presets to everyone and the custom provider to administrators", () => {
	assert.deepEqual(
		credentiallessChoices(PROVIDERS, false).map((p) => p.id),
		["namecheap", "noip", "dynu"],
	);
	assert.deepEqual(
		credentiallessChoices(PROVIDERS, true).map((p) => p.id),
		["namecheap", "noip", "dynu", "custom"],
	);
});

it("starts a saved record with its own provider when it takes no credential", () => {
	assert.equal(providerIdOf({ provider: "noip" }, PROVIDERS), "noip");
	assert.equal(providerIdOf({ provider: "cloudflare" }, PROVIDERS), CREDENTIAL);
	assert.equal(withoutCredential("noip"), true);
	assert.equal(withoutCredential(CREDENTIAL), false);
	assert.equal(withoutCredential(""), false);
});

it("hides the alias, TTL, zone and wildcard of every zoneless provider", () => {
	for (const id of ["duckdns", "namecheap", "noip", "dynu", "custom"]) {
		const shown = providerFieldsOf(byId(id));
		assert.deepEqual([shown.alias, shown.ttl, shown.zone, shown.wildcard], [false, false, false, false], id);
	}
	const cloudflare = providerFieldsOf(byId("cloudflare"));
	assert.deepEqual(
		[cloudflare.alias, cloudflare.ttl, cloudflare.zone, cloudflare.wildcard],
		[true, true, true, true],
	);
});

it("takes the IP versions each provider takes and the fields each preset asks for", () => {
	assert.deepEqual(providerFieldsOf(byId("namecheap")).ipVersions, ["ipv4"]);
	assert.deepEqual(providerFieldsOf(byId("noip")).ipVersions, ["ipv4", "both"]);
	assert.deepEqual(providerFieldsOf(byId("dynu")).ipVersions, ["ipv4", "ipv6", "both"]);
	assert.deepEqual(providerFieldsOf(byId("namecheap")).fields, ["domain", "password"]);
	assert.deepEqual(providerFieldsOf(byId("noip")).fields, ["username", "password"]);
	assert.deepEqual(providerFieldsOf(byId("custom")).fields, ["url", "method", "expect"]);
	assert.deepEqual(providerFieldsOf(byId("duckdns")).fields, []);
	assert.deepEqual(providerFieldsOf(null).ipVersions, ["ipv4", "ipv6", "both"]);
});

it("gives a note for DuckDNS, deSEC, OVH, the presets and the custom provider, and every note has a text", () => {
	assert.deepEqual(providerNoteOf(byId("duckdns")), { id: "ddns.note.duckdns", values: { zone: "duckdns.org" } });
	assert.deepEqual(providerNoteOf(byId("desec")), { id: "ddns.note.desec", values: { min: 3600 } });
	assert.equal(providerNoteOf(byId("cloudflare")), null);
	for (const provider of PROVIDERS.filter((entry) => entry.id !== "cloudflare")) {
		assert.ok(en[providerNoteOf(provider).id], provider.id);
	}
});

it("checks the account details of a preset, and keeps the saved ones when a field stays empty", () => {
	assert.deepEqual(check({}), {});
	assert.equal(check({ username: "" }).username.id, "error.ddns-preset-required");
	assert.equal(check({ password: "" }).password.id, "error.ddns-preset-required");
	assert.equal(check({ password: "abc" }).password.id, "ddns.error.password-short");
	const stored = { id: 1, name: "home.example.com", secretSet: true, ttl: null, kind: "address", ipVersion: "ipv4" };
	assert.deepEqual(check({ username: "", password: "" }, stored), {});
});

it("asks Namecheap for a domain that holds the name", () => {
	const namecheap = { providerId: "namecheap", username: "" };
	assert.equal(check(namecheap).domain.id, "error.ddns-preset-required");
	assert.equal(check({ ...namecheap, domain: "not a domain" }).domain.id, "error.ddns-preset-domain-invalid");
	assert.equal(check({ ...namecheap, domain: "example.org" }).domain.id, "error.ddns-zone-mismatch");
	assert.deepEqual(check({ ...namecheap, domain: "example.com" }), {});
});

it("refuses a wildcard, a TTL and an alias for a preset, and a bad name", () => {
	assert.equal(check({ name: "*.example.com" }).name.id, "error.ddns-wildcard-unsupported");
	assert.equal(check({ name: "no good" }).name.id, "error.ddns-name-invalid");
	// the window hides the TTL and the alias, so the rules never see them
	assert.deepEqual(check({ ttl: "300", kind: "alias", target: "a.example.net" }), {});
	assert.equal(check({ providerId: "nothing" }).providerId.id, "error.ddns-no-updater");
});

it("needs the custom URL unless one is saved, and an https one", () => {
	const custom = { providerId: "custom", username: "", password: "" };
	assert.equal(check(custom).url.id, "error.ddns-custom-url-required");
	assert.equal(check({ ...custom, url: "http://example.com/u" }).url.id, "error.ddns-custom-url-https");
	assert.deepEqual(check({ ...custom, url: "https://example.com/u?ip={ip}" }), {});
	const stored = { id: 2, name: "home.example.com", urlSet: true, ttl: null, kind: "address", ipVersion: "ipv4" };
	assert.deepEqual(check(custom, stored), {});
});

it("never sends an IP version the provider does not take", () => {
	assert.equal(
		ddnsRulesInput({ ...FORM, providerId: "namecheap", ipVersion: "both" }, byId("namecheap")).ipVersion,
		"ipv4",
	);
	assert.equal(ddnsRulesInput({ ...FORM, ipVersion: "ipv6" }, byId("noip")).ipVersion, "ipv4");
	assert.equal(ddnsRulesInput({ ...FORM, ipVersion: "both" }, byId("noip")).ipVersion, "both");
});

it("sends a preset with its provider and the typed fields only", () => {
	const form = { ...FORM, providerId: "namecheap", domain: "example.com", username: "ignored", ttl: "300" };
	assert.deepEqual(ddnsRecordPayload(form, null, true, byId("namecheap")), {
		id: undefined,
		name: "home.example.com",
		kind: "address",
		enabled: true,
		provider: "namecheap",
		domain: "example.com",
		password: "secret-pass",
		ipVersion: "ipv4",
	});
});

it("leaves an empty write-only field out of an edit, and the provider with it", () => {
	const stored = { id: 7, name: "home.example.com" };
	const sent = ddnsRecordPayload({ ...FORM, username: "", password: "" }, stored, false, byId("noip"));
	assert.equal("username" in sent, false);
	assert.equal("password" in sent, false);
	assert.equal("provider" in sent, false);
	assert.equal(sent.ttl, null);
	assert.equal(sent.id, 7);
});

it("sends the custom method and expected text, and clears the text when emptied", () => {
	const form = { ...FORM, providerId: "custom", url: " https://example.com/u ", method: "POST", expect: "good" };
	const sent = ddnsRecordPayload(form, null, false, byId("custom"));
	assert.deepEqual(
		[sent.url, sent.method, sent.expect, sent.provider],
		["https://example.com/u", "POST", "good", "custom"],
	);
	assert.equal("dnsCredentialId" in sent, false);
	const cleared = ddnsRecordPayload(
		{ ...form, url: "", expect: " " },
		{ id: 3, name: "x.example.com" },
		false,
		byId("custom"),
	);
	assert.equal("url" in cleared, false);
	assert.equal(cleared.expect, null);
});

it("keeps a credential record as before: the credential is sent, no provider, no account fields", () => {
	const form = { ...FORM, providerId: CREDENTIAL, credentialId: 4, username: "x", url: "https://x.example/" };
	const sent = ddnsRecordPayload(form, null, true, byId("ovh"));
	assert.equal(sent.dnsCredentialId, 4);
	assert.equal("provider" in sent, false);
	assert.equal("url" in sent, false);
	assert.equal("username" in sent, false);
});

it("every error id the provider-less rules return has a text in en.json", () => {
	const found = [
		check({ providerId: "nothing" }),
		check({ name: "no good" }),
		check({ providerId: "namecheap", domain: "example.org", username: "" }),
		check({ providerId: "namecheap", domain: "x y" }),
		check({ providerId: "custom", url: "http://example.com" }),
		check({ providerId: "custom" }),
		check({ password: "abc", username: "" }),
	];
	for (const errors of found) {
		for (const entry of Object.values(errors)) assert.ok(en[entry.id], entry.id);
	}
});
