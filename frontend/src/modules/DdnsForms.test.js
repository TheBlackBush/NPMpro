import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	ddnsApiErrorOf,
	ddnsErrorOf,
	ddnsMessageValues,
	ddnsRecordPayload,
	ddnsRecordValidate,
	ddnsRulesInput,
	isIpv6Suffix,
	minTtlOf,
	normalizeRecordName,
	recordStateOf,
	suggestedZone,
	zoneFor,
} from "./DdnsForms.js";

const PROVIDERS = [
	{ id: "cloudflare", label: "Cloudflare", credentialProvider: "cloudflare", wildcards: true, minTtl: 60 },
	{ id: "gandi", label: "Gandi", credentialProvider: "gandi", wildcards: false, aliases: true, minTtl: 300 },
	{
		id: "ovh",
		label: "OVH",
		credentialProvider: "ovh",
		wildcards: false,
		aliases: false,
		apex: false,
		minTtl: null,
	},
	{
		id: "duckdns",
		label: "DuckDNS",
		credentialProvider: "duckdns",
		wildcards: false,
		aliases: false,
		zoneless: true,
		zone: "duckdns.org",
		minTtl: null,
	},
];
const CREDENTIALS = [
	{ id: 1, name: "Cloudflare main", provider: "cloudflare", ownerUserId: 1 },
	{ id: 2, name: "Gandi", provider: "gandi", ownerUserId: 1 },
	{ id: 3, name: "Other", provider: "route53", ownerUserId: 1 },
	{ id: 4, name: "OVH", provider: "ovh", ownerUserId: 1 },
	{ id: 5, name: "Duck", provider: "duckdns", ownerUserId: 1 },
];
const ZONES = [
	{ name: "example.com", credentialId: 1, ownerUserId: 1 },
	{ name: "example.org", credentialId: 2, ownerUserId: 1 },
	{ name: "example.net", credentialId: 4, ownerUserId: 1 },
];
const CONTEXT = { providers: PROVIDERS, credentials: CREDENTIALS, zones: ZONES, stored: null };
const NEW = { name: "home.example.com", credentialId: 1, kind: "address", ipVersion: "ipv4" };
const check = (values, context = {}) => ddnsRecordValidate({ ...NEW, ...values }, { ...CONTEXT, ...context });
// an alias form sends no IP version
const alias = (values, context = {}) => check({ kind: "alias", ipVersion: undefined, ...values }, context);
const STORED = {
	id: 5,
	name: "home.example.com",
	dnsCredentialId: 1,
	zone: "example.com",
	kind: "address",
	target: null,
	ipVersion: "ipv4",
	ipv6Suffix: null,
};

// the cases of backend/test/ddns-ipv6.test.js
it("accepts interface ids of at most 64 bits (the backend cases)", () => {
	for (const text of ["::1", "::a:b:c:d", "0:0:0:0:1:2:3:4", "::ffff:ffff:ffff:ffff"]) {
		assert.equal(isIpv6Suffix(text), true, text);
	}
});

it("refuses a suffix over 64 bits, an all-zero suffix and other text (the backend cases)", () => {
	for (const text of [
		"1::1",
		"2a00::1",
		"::1:0:0:0:0",
		"1:2:3:4:5:6:7:8",
		"",
		"zz",
		"1.2.3.4",
		"::1::2",
		"::",
		"0:0:0:0:0:0:0:0",
		5,
		null,
	]) {
		assert.equal(isIpv6Suffix(text), false, String(text));
	}
});

it("normalizes a record name like the backend and keeps a wildcard", () => {
	assert.deepEqual(normalizeRecordName("  Home.Example.COM. "), { name: "home.example.com", wildcard: false });
	assert.deepEqual(normalizeRecordName("*.Example.com"), { name: "*.example.com", wildcard: true });
	assert.deepEqual(normalizeRecordName("bücher.de"), { name: "xn--bcher-kva.de", wildcard: false });
	for (const bad of ["", "localhost", "a b.com", "1.2.3.4", "**.example.com", null]) {
		assert.deepEqual(normalizeRecordName(bad), { error: "error.ddns-name-invalid" }, String(bad));
	}
});

it("finds the zone of a credential and suggests one", () => {
	assert.equal(zoneFor("a.b.example.com", 1, ZONES), "example.com");
	assert.equal(zoneFor("*.example.com", 1, ZONES), "example.com");
	assert.equal(zoneFor("home.example.com", 2, ZONES), null);
	assert.equal(zoneFor("home.example.com", 9, ZONES), null);
	assert.equal(suggestedZone("home.example.com"), "example.com");
	assert.equal(suggestedZone("example.com"), "example.com");
});

it("accepts a valid new address record", () => {
	assert.deepEqual(check({}), {});
	assert.deepEqual(check({ ipVersion: "both", ipv6Suffix: "::1", ttl: "300" }), {});
});

it("needs a credential whose provider has an updater", () => {
	assert.equal(check({ credentialId: undefined }).credentialId.id, "ddns.error.credential-required");
	assert.equal(check({ credentialId: 3 }).credentialId.id, "error.ddns-no-updater");
});

it("refuses an invalid name", () => {
	assert.deepEqual(check({ name: "localhost" }).name, {
		id: "error.ddns-name-invalid",
		values: { name: "localhost" },
	});
});

it("allows a wildcard only where the provider allows it", () => {
	assert.deepEqual(check({ name: "*.example.com" }), {});
	const refused = check({ name: "*.example.org", credentialId: 2 });
	assert.deepEqual(refused.name, { id: "error.ddns-wildcard-unsupported", values: { provider: "Gandi" } });
});

it("keeps a stored wildcard on a provider without wildcards when the save keeps it", () => {
	const stored = { ...STORED, name: "*.example.org", dnsCredentialId: 2, zone: "example.org" };
	assert.deepEqual(check({ name: "*.example.org", credentialId: 2 }, { stored }), {});
	assert.equal(check({ name: "*.example.org", credentialId: 2, ttl: 300 }, { stored }).name, undefined);
	// a rename or a credential change runs the rule again
	const moved = check({ name: "*.sub.example.org", credentialId: 2 }, { stored });
	assert.equal(moved.name.id, "error.ddns-wildcard-unsupported");
});

it("refuses an alias and a name at the apex for a provider without them (the backend cases)", () => {
	const aliasRefused = alias({ name: "a.example.net", credentialId: 4, target: "x.example.org" });
	assert.deepEqual(aliasRefused.target, { id: "error.ddns-alias-unsupported", values: { provider: "OVH" } });
	assert.equal(alias({ name: "a.example.org", credentialId: 2, target: "x.example.net" }).target, undefined);
	const apex = check({ name: "example.net", credentialId: 4 });
	assert.deepEqual(apex.name, {
		id: "error.ddns-apex-unsupported",
		values: { provider: "OVH", name: "example.net" },
	});
	assert.deepEqual(check({ name: "home.example.net", credentialId: 4 }), {});
	// a typed zone makes the name its apex too, and a provider with apex records takes it
	assert.equal(
		check({ name: "x.example.io", credentialId: 4, zone: "x.example.io" }).name.id,
		"error.ddns-apex-unsupported",
	);
	assert.equal(check({ name: "example.com", credentialId: 1 }).name, undefined);
	// a stored record passes a save that keeps it, a rename or a credential change runs the rules again
	const stored = { ...STORED, name: "example.net", dnsCredentialId: 4, zone: "example.net" };
	assert.deepEqual(check({ name: "example.net", credentialId: 4 }, { stored }), {});
	assert.equal(
		check(
			{ name: "example.net", credentialId: 4, kind: "alias", target: "x.example.org", ipVersion: undefined },
			{ stored },
		).target.id,
		"error.ddns-alias-unsupported",
	);
});

it("keeps a zoneless provider's records under its fixed zone, with no zone to add and no TTL (the backend cases)", () => {
	const duck = (values, context) => check({ credentialId: 5, ...values }, context);
	// no domain of the credential exists and none is asked for
	assert.deepEqual(duck({ name: "home.duckdns.org" }), {});
	assert.deepEqual(duck({ name: "home.duckdns.org", ipVersion: "both", ipv6Suffix: "::1" }), {});
	for (const name of ["home.example.com", "duckdns.org", "a.b.duckdns.org"]) {
		assert.deepEqual(duck({ name }).name, {
			id: "error.ddns-zoneless-name",
			values: { provider: "DuckDNS", zone: "duckdns.org" },
		});
	}
	assert.equal(duck({ name: "*.home.duckdns.org" }).name.id, "error.ddns-wildcard-unsupported");
	assert.equal(duck({ name: "home.duckdns.org", ttl: "300" }).ttl.id, "error.ddns-ttl-unsupported");
	assert.equal(duck({ name: "home.duckdns.org", ttl: "" }).ttl, undefined);
	assert.equal(
		alias({ credentialId: 5, name: "home.duckdns.org", target: "x.example.net" }).target.id,
		"error.ddns-alias-unsupported",
	);
	assert.equal(
		duck({ name: "home.duckdns.org", ipVersion: "ipv4", ipv6Suffix: "::1" }).ipv6Suffix.id,
		"error.ddns-suffix-needs-ipv6",
	);
	assert.equal(
		duck({ name: "home.duckdns.org", ipVersion: "ipv6", ipv6Suffix: "1::1" }).ipv6Suffix.id,
		"error.ddns-suffix-invalid",
	);
	// a stored record passes a save that keeps its name, a rename or a credential change runs the rules again
	const stored = { ...STORED, name: "home.duckdns.org", dnsCredentialId: 5, zone: "duckdns.org" };
	assert.deepEqual(duck({ name: "home.duckdns.org" }, { stored }), {});
	assert.equal(duck({ name: "other.example.com" }, { stored }).name.id, "error.ddns-zoneless-name");
	assert.equal(duck({ name: "home.duckdns.org", ttl: "600" }, { stored }).ttl.id, "error.ddns-ttl-unsupported");
	// the kind and the IP version come from the stored record when the form leaves them out
	assert.deepEqual(ddnsRecordValidate({ name: "home.duckdns.org", credentialId: 5 }, { ...CONTEXT, stored }), {});
	const storedSuffix = { ...stored, ipVersion: "ipv4", ipv6Suffix: "::1" };
	assert.equal(
		ddnsRecordValidate(
			{ name: "home.duckdns.org", credentialId: 5, ipv6Suffix: "::2" },
			{ ...CONTEXT, stored: storedSuffix },
		).ipv6Suffix.id,
		"error.ddns-suffix-needs-ipv6",
	);
	// an alias that stays an alias passes, an address that becomes one is refused; an alias form has no suffix
	const storedAlias = { ...stored, kind: "alias", target: "x.example.net" };
	assert.equal(
		ddnsRecordValidate(
			{ name: "home.duckdns.org", credentialId: 5, kind: "alias", target: "x.example.net" },
			{ ...CONTEXT, stored: storedAlias },
		).target,
		undefined,
	);
	assert.equal(
		alias({ credentialId: 5, name: "home.duckdns.org", target: "x.example.net" }, { stored }).target.id,
		"error.ddns-alias-unsupported",
	);
	// a bad name is reported once, by the generic rule
	assert.equal(duck({ name: "*.duckdns.org" }).name.id, "error.ddns-wildcard-unsupported");
	assert.equal(duck({ name: "home.duckdns.org", ttl: "abc" }).ttl.id, "error.ddns-ttl-unsupported");
	const storedTtl = { ...stored, ttl: 600 };
	assert.equal(duck({ name: "home.duckdns.org", ttl: "600" }, { stored: storedTtl }).ttl, undefined);
});

it("a provider without min_ttl gets the generic TTL message under the schema floor", () => {
	assert.equal(check({ credentialId: 4, name: "home.example.net", ttl: 10 }).ttl.id, "ddns.error.ttl-range");
	assert.equal(check({ credentialId: 4, name: "home.example.net", ttl: 30 }).ttl, undefined);
	assert.equal(check({ ttl: 10 }).ttl.id, "error.ddns-ttl-min");
});

it("needs a zone when no domain covers the name, and a typed zone must cover it", () => {
	const none = check({ name: "home.example.net" });
	assert.deepEqual(none.zone, {
		id: "error.ddns-no-zone",
		values: { domain: "example.net", credential: "Cloudflare main" },
	});
	assert.deepEqual(check({ name: "home.example.net", zone: "example.net" }), {});
	assert.equal(check({ name: "home.example.net", zone: "example.org" }).zone.id, "error.ddns-zone-mismatch");
	assert.equal(check({ name: "home.example.net", zone: "bad zone" }).zone.id, "error.ddns-zone-mismatch");
});

it("does not ask for a zone again on a save that keeps the name and credential", () => {
	const stored = { ...STORED, name: "home.example.net", zone: "example.net" };
	assert.deepEqual(check({ name: "home.example.net" }, { stored }), {});
	assert.equal(
		check({ name: "home.example.net", zone: "other.org" }, { stored }).zone.id,
		"error.ddns-zone-mismatch",
	);
});

it("needs a target for an alias that is valid and not its own name", () => {
	assert.equal(alias({}).target.id, "error.ddns-alias-target-required");
	assert.equal(alias({ target: "bad target" }).target.id, "error.ddns-target-invalid");
	assert.deepEqual(alias({ target: "Home.Example.com." }).target, {
		id: "error.ddns-alias-self",
		values: { name: "home.example.com" },
	});
	assert.deepEqual(alias({ target: "lb.example.net" }), {});
});

it("refuses the suffix on an alias, and a target on an address record", () => {
	assert.equal(alias({ target: "lb.example.net", ipv6Suffix: "::1" }).ipv6Suffix.id, "error.ddns-alias-no-ip");
	assert.equal(check({ target: "lb.example.net" }).target.id, "error.ddns-address-no-target");
});

it("keeps a stored alias target and suffix state on a save that keeps them", () => {
	const stored = { ...STORED, kind: "alias", target: "lb.example.net", ipVersion: "ipv4" };
	assert.deepEqual(alias({ target: "lb.example.net", ttl: 300 }, { stored }), {});
	assert.equal(alias({ target: "home.example.com" }, { stored }).target.id, "error.ddns-alias-self");
});

it("checks the IPv6 suffix: only with IPv6 or both, valid, not zero", () => {
	assert.equal(check({ ipv6Suffix: "::1" }).ipv6Suffix.id, "error.ddns-suffix-needs-ipv6");
	assert.deepEqual(check({ ipVersion: "ipv6", ipv6Suffix: "1::1" }).ipv6Suffix, {
		id: "error.ddns-suffix-invalid",
		values: { suffix: "1::1" },
	});
	assert.equal(check({ ipVersion: "both", ipv6Suffix: "::" }).ipv6Suffix.id, "error.ddns-suffix-invalid");
	assert.deepEqual(check({ ipVersion: "ipv6", ipv6Suffix: "::a:b:c:d" }), {});
});

it("keeps a stored suffix that a newer check would refuse when the save keeps it", () => {
	const stored = { ...STORED, ipVersion: "ipv6", ipv6Suffix: "2a00::1" };
	assert.deepEqual(check({ ipVersion: "ipv6", ipv6Suffix: "2a00::1" }, { stored }), {});
	assert.equal(
		check({ ipVersion: "ipv6", ipv6Suffix: "2a00::2" }, { stored }).ipv6Suffix.id,
		"error.ddns-suffix-invalid",
	);
	// switching the family to IPv4 with the suffix kept runs the rule again
	assert.equal(
		check({ ipVersion: "ipv4", ipv6Suffix: "2a00::1" }, { stored }).ipv6Suffix.id,
		"error.ddns-suffix-needs-ipv6",
	);
});

it("accepts an empty TTL or the provider's minimum to 86400 and refuses the rest", () => {
	for (const ok of [undefined, null, "", 60, 86400, "300"])
		assert.equal(check({ ttl: ok }).ttl, undefined, String(ok));
	for (const bad of [86401, -1, 1.5, "abc", "1e3", "60.5"]) {
		assert.equal(check({ ttl: bad }).ttl?.id, "ddns.error.ttl-range", String(bad));
	}
	for (const low of [59, 0, 30]) {
		assert.deepEqual(check({ ttl: low }).ttl, {
			id: "error.ddns-ttl-min",
			values: { min: 60, provider: "Cloudflare" },
		});
	}
});

it("follows each provider's min_ttl: Gandi takes 300, a stored TTL passes a save that keeps it", () => {
	const gandi = { name: "home.example.org", credentialId: 2 };
	assert.deepEqual(check({ ...gandi, ttl: "120" }).ttl, {
		id: "error.ddns-ttl-min",
		values: { min: 300, provider: "Gandi" },
	});
	assert.equal(check({ ...gandi, ttl: "300" }).ttl, undefined);
	const stored = { ...STORED, name: "home.example.org", dnsCredentialId: 2, zone: "example.org", ttl: 120 };
	assert.equal(check({ ...gandi, ttl: "120" }, { stored }).ttl, undefined);
	assert.equal(check({ ...gandi, ttl: "180" }, { stored }).ttl.id, "error.ddns-ttl-min");
	// a move to another credential checks the stored TTL again
	const onCloudflare = { ...STORED, ttl: 30 };
	assert.equal(check({ ttl: "30" }, { stored: onCloudflare }).ttl, undefined);
	assert.equal(check({ ...gandi, ttl: "30" }, { stored: onCloudflare }).ttl.id, "error.ddns-ttl-min");
	assert.equal(minTtlOf({ minTtl: 300 }), 300);
	assert.equal(minTtlOf({ minTtl: 10 }), 30);
	assert.equal(minTtlOf(null), 30);
	assert.equal(minTtlOf({ minTtl: null }), 30);
});

it("an alias never carries the IP version the form shows, an IPv4 address no suffix", () => {
	const values = {
		name: "a.example.com",
		kind: "alias",
		target: "b.example.com",
		ipVersion: "ipv4",
		ipv6Suffix: "::1",
	};
	assert.deepEqual(ddnsRulesInput(values), { ...values, ipVersion: undefined, ipv6Suffix: "" });
	assert.deepEqual(ddnsRulesInput({ ...values, kind: "address" }), {
		...values,
		kind: "address",
		target: "",
		ipv6Suffix: "",
	});
	assert.equal(ddnsRulesInput({ ...values, kind: "address", ipVersion: "ipv6" }).ipv6Suffix, "::1");
	// a stored alias reads back ip_version null; the form shows IPv4 and the rules pass
	const storedAlias = { ...STORED, kind: "alias", target: "b.example.com", ipVersion: null };
	const form = { ...NEW, kind: "alias", target: "b.example.com", ipVersion: "ipv4", ipv6Suffix: "" };
	assert.deepEqual(ddnsRecordValidate(ddnsRulesInput(form), { ...CONTEXT, stored: storedAlias }), {});
});

it("the request of an edit that turns an address with a suffix into an alias clears the suffix", () => {
	const stored = { ...STORED, ipVersion: "ipv6", ipv6Suffix: "::1" };
	const form = {
		name: "home.example.com",
		credentialId: 1,
		zone: "example.com",
		kind: "alias",
		target: " lb.example.net ",
		ipVersion: "ipv6",
		ipv6Suffix: "::1",
		ttl: "",
		enabled: true,
	};
	assert.deepEqual(ddnsRulesInput(form).ipv6Suffix, "");
	assert.deepEqual(ddnsRecordValidate(ddnsRulesInput(form), { ...CONTEXT, stored }), {});
	assert.deepEqual(ddnsRecordPayload(form, stored, false), {
		id: 5,
		name: "home.example.com",
		dnsCredentialId: 1,
		kind: "alias",
		enabled: true,
		ttl: null,
		target: "lb.example.net",
		ipv6Suffix: null,
	});
	// a new alias sends neither, a new address its IP version and suffix, a typed zone only when asked
	const added = ddnsRecordPayload({ ...form, ttl: "300" }, null, true);
	assert.deepEqual(added, {
		id: undefined,
		name: "home.example.com",
		dnsCredentialId: 1,
		kind: "alias",
		enabled: true,
		ttl: 300,
		zone: "example.com",
		target: "lb.example.net",
	});
	const address = ddnsRecordPayload({ ...form, kind: "address" }, null, false);
	assert.deepEqual([address.ipVersion, address.ipv6Suffix, address.target], ["ipv6", "::1", undefined]);
	const ipv4 = ddnsRecordPayload({ ...form, kind: "address", ipVersion: "ipv4" }, stored, false);
	assert.deepEqual([ipv4.ipVersion, ipv4.ipv6Suffix], ["ipv4", null]);
});

it("formats the time of a cooldown in the message of a failed request", () => {
	const at = (iso) => `local ${iso.slice(11, 16)}`;
	const err = {
		payload: {
			error: {
				message: "x",
				message_i18n: "error.ddns-cooldown",
				message_values: { next_write_on: "2026-11-23T23:21:43.000Z" },
			},
		},
	};
	assert.deepEqual(ddnsApiErrorOf(err, at), {
		id: "error.ddns-cooldown",
		values: { next_write_on: "local 23:21" },
	});
	assert.deepEqual(ddnsApiErrorOf({ payload: { error: { message_i18n: "error.ddns-paused" } } }, at), {
		id: "error.ddns-paused",
		values: {},
	});
	assert.equal(ddnsApiErrorOf({ payload: { error: { message_i18n: "error.not-found" } } }, at), null);
	assert.equal(ddnsApiErrorOf(new Error("HTTP 502"), at), null);
	assert.deepEqual(ddnsMessageValues({ name: "a", next_write_on: 5 }, at), { name: "a", next_write_on: 5 });
});

it("shows the state of a record", () => {
	const now = Date.parse("2026-11-24T12:00:00.000Z");
	const base = { enabled: true, state: "ok", lastCheckedOn: "2026-11-24T11:59:00.000Z", proxied: null };
	assert.deepEqual(recordStateOf({ ...base, enabled: false, state: "disabled" }, now), {
		kind: "disabled",
		at: null,
		nextTry: null,
		proxied: false,
	});
	assert.equal(recordStateOf({ ...base, state: "pending" }, now).kind, "pending");
	const failed = recordStateOf({ ...base, state: "failed", nextTryOn: "2026-11-24T12:05:00.000Z" }, now);
	assert.deepEqual(failed, {
		kind: "failed",
		at: base.lastCheckedOn,
		nextTry: "2026-11-24T12:05:00.000Z",
		proxied: false,
	});
	assert.equal(recordStateOf({ ...base, state: "failed", nextTryOn: "2026-11-24T11:00:00.000Z" }, now).nextTry, null);
	const updated = recordStateOf({ ...base, lastChangedOn: "2026-11-24T10:00:00.000Z" }, now);
	assert.deepEqual([updated.kind, updated.at], ["updated", "2026-11-24T10:00:00.000Z"]);
	assert.equal(recordStateOf({ ...base, lastChangedOn: "2026-11-20T10:00:00.000Z" }, now).kind, "ok");
	assert.equal(recordStateOf({ ...base, lastChangedOn: "garbage" }, now).kind, "ok");
	assert.equal(recordStateOf({ ...base, proxied: true }, now).proxied, true);
});

it("shows a translated error when one is known, else the text", () => {
	assert.equal(ddnsErrorOf(null), null);
	assert.equal(ddnsErrorOf({ error: null, errorI18n: null }), null);
	assert.deepEqual(ddnsErrorOf({ error: "HTTP 403", errorI18n: null }), { text: "HTTP 403" });
	assert.deepEqual(
		ddnsErrorOf({
			error: "x",
			errorI18n: "error.ddns-cooldown",
			errorValues: { nextWriteOn: "2026-11-24T12:05:00.000Z" },
		}),
		{ id: "error.ddns-cooldown", values: { next_write_on: "2026-11-24T12:05:00.000Z" } },
	);
	assert.deepEqual(ddnsErrorOf({ error: "x", errorI18n: "error.ddns-ip-failed" }), {
		id: "error.ddns-ip-failed",
		values: {},
	});
});

it("every error id the rules return has a text in en.json", () => {
	const ids = new Set();
	const collect = (errors) => {
		for (const entry of Object.values(errors)) ids.add(entry.id);
	};
	collect(check({ credentialId: undefined }));
	collect(check({ credentialId: 3 }));
	collect(check({ name: "localhost" }));
	collect(check({ name: "*.example.org", credentialId: 2 }));
	collect(check({ name: "home.example.net" }));
	collect(check({ name: "home.example.net", zone: "example.org" }));
	collect(alias({}));
	collect(alias({ target: "bad target" }));
	collect(alias({ target: "home.example.com", ipv6Suffix: "::1" }));
	collect(check({ target: "lb.example.net", ipv6Suffix: "::1", ttl: 1 }));
	collect(check({ ipVersion: "ipv6", ipv6Suffix: "1::1" }));
	assert.ok(ids.size >= 10);
	assert.deepEqual(
		[...ids].filter((id) => !(id in en)),
		[],
	);
});

it("refuses an IP version on an alias unless a stored alias keeps it", () => {
	assert.equal(
		check({ kind: "alias", target: "lb.example.net", ipVersion: "ipv4" }).ipVersion.id,
		"error.ddns-alias-no-ip",
	);
	const stored = { ...STORED, kind: "alias", target: "lb.example.net", ipVersion: "ipv4" };
	assert.deepEqual(alias({ target: "lb.example.net", ipVersion: "ipv4" }, { stored }), {});
	assert.equal(
		alias({ target: "lb.example.net", ipVersion: "ipv6" }, { stored }).ipVersion.id,
		"error.ddns-alias-no-ip",
	);
	// switching an address record to an alias runs the rule again
	assert.equal(
		check({ kind: "alias", target: "lb.example.net", ipVersion: "ipv4" }, { stored: STORED }).ipVersion.id,
		"error.ddns-alias-no-ip",
	);
});

it("switches a stored record between alias and address", () => {
	const storedAlias = { ...STORED, kind: "alias", target: "lb.example.net" };
	assert.deepEqual(check({ kind: "address", ipVersion: "ipv4", target: "" }, { stored: storedAlias }), {});
	// the alias had no suffix: a suffix on the new address record needs IPv6
	assert.equal(
		check({ kind: "address", ipVersion: "ipv4", ipv6Suffix: "::1" }, { stored: storedAlias }).ipv6Suffix.id,
		"error.ddns-suffix-needs-ipv6",
	);
	assert.deepEqual(check({ kind: "address", ipVersion: "ipv6", ipv6Suffix: "::1" }, { stored: storedAlias }), {});
	const storedAddress = { ...STORED, ipVersion: "ipv6", ipv6Suffix: "::1" };
	assert.equal(
		alias({ target: "lb.example.net", ipv6Suffix: "::1" }, { stored: storedAddress }).ipv6Suffix.id,
		"error.ddns-alias-no-ip",
	);
	assert.equal(alias({ target: "" }, { stored: storedAddress }).target.id, "error.ddns-alias-target-required");
	assert.deepEqual(alias({ target: "lb.example.net" }, { stored: storedAddress }), {});
});

it("handles a stored alias with a stored suffix and a rename onto its target", () => {
	const stored = { ...STORED, kind: "alias", target: "lb.example.com", ipv6Suffix: "::1" };
	assert.deepEqual(alias({ target: "lb.example.com", ipv6Suffix: "::1" }, { stored }), {});
	assert.equal(
		alias({ target: "lb.example.com", ipv6Suffix: "::2" }, { stored }).ipv6Suffix.id,
		"error.ddns-alias-no-ip",
	);
	const renamed = alias({ name: "lb.example.com", target: "lb.example.com" }, { stored });
	assert.deepEqual(renamed.target, { id: "error.ddns-alias-self", values: { name: "lb.example.com" } });
});

it("every error key the backend raises has an English text in en.json", () => {
	const root = new URL("../../../backend/", import.meta.url);
	const KEY = /error\.(?:ddns-[a-z0-9-]+|dns-credential-in-use-ddns)/gu;
	const keys = new Set();
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".js"))
				for (const key of readFileSync(path, "utf8").match(KEY) ?? []) keys.add(key);
		}
	};
	for (const folder of ["internal/", "lib/", "routes/"]) walk(new URL(folder, root));
	assert.ok(keys.size >= 26, `found ${keys.size} keys`);
	assert.ok(keys.has("error.ddns-suffix-needs-ipv6"));
	assert.deepEqual(
		[...keys].filter((key) => !(key in en)),
		[],
	);
});
