import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	ddnsErrorOf,
	ddnsRecordValidate,
	isIpv6Suffix,
	normalizeRecordName,
	recordStateOf,
	suggestedZone,
	zoneFor,
} from "./DdnsForms.js";

const PROVIDERS = [
	{ id: "cloudflare", label: "Cloudflare", credentialProvider: "cloudflare", wildcards: true },
	{ id: "gandi", label: "Gandi", credentialProvider: "gandi", wildcards: false },
];
const CREDENTIALS = [
	{ id: 1, name: "Cloudflare main", provider: "cloudflare", ownerUserId: 1 },
	{ id: 2, name: "Gandi", provider: "gandi", ownerUserId: 1 },
	{ id: 3, name: "Other", provider: "route53", ownerUserId: 1 },
];
const ZONES = [
	{ name: "example.com", credentialId: 1, ownerUserId: 1 },
	{ name: "example.org", credentialId: 2, ownerUserId: 1 },
];
const CONTEXT = { providers: PROVIDERS, credentials: CREDENTIALS, zones: ZONES, stored: null };
const NEW = { name: "home.example.com", credentialId: 1, kind: "address", ipVersion: "ipv4" };
const check = (values, context = {}) => ddnsRecordValidate({ ...NEW, ...values }, { ...CONTEXT, ...context });
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
	assert.equal(check({ kind: "alias" }).target.id, "error.ddns-alias-target-required");
	assert.equal(check({ kind: "alias", target: "bad target" }).target.id, "error.ddns-target-invalid");
	assert.deepEqual(check({ kind: "alias", target: "Home.Example.com." }).target, {
		id: "error.ddns-alias-self",
		values: { name: "home.example.com" },
	});
	assert.deepEqual(check({ kind: "alias", target: "lb.example.net" }), {});
});

it("refuses the suffix on an alias, and a target on an address record", () => {
	assert.equal(
		check({ kind: "alias", target: "lb.example.net", ipv6Suffix: "::1" }).ipv6Suffix.id,
		"error.ddns-alias-no-ip",
	);
	assert.equal(check({ target: "lb.example.net" }).target.id, "error.ddns-address-no-target");
});

it("keeps a stored alias target and suffix state on a save that keeps them", () => {
	const stored = { ...STORED, kind: "alias", target: "lb.example.net", ipVersion: "ipv4" };
	assert.deepEqual(check({ kind: "alias", target: "lb.example.net", ttl: 300 }, { stored }), {});
	assert.equal(check({ kind: "alias", target: "home.example.com" }, { stored }).target.id, "error.ddns-alias-self");
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

it("accepts an empty TTL or 60 to 86400 and refuses the rest", () => {
	for (const ok of [undefined, null, "", 60, 86400, "300"])
		assert.equal(check({ ttl: ok }).ttl, undefined, String(ok));
	for (const bad of [59, 86401, 0, -1, 1.5, "abc", "1e3", "60.5"]) {
		assert.equal(check({ ttl: bad }).ttl?.id, "ddns.error.ttl-range", String(bad));
	}
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
	collect(check({ kind: "alias" }));
	collect(check({ kind: "alias", target: "bad target" }));
	collect(check({ kind: "alias", target: "home.example.com", ipv6Suffix: "::1" }));
	collect(check({ target: "lb.example.net", ipv6Suffix: "::1", ttl: 1 }));
	collect(check({ ipVersion: "ipv6", ipv6Suffix: "1::1" }));
	assert.ok(ids.size >= 10);
	assert.deepEqual(
		[...ids].filter((id) => !(id in en)),
		[],
	);
});
