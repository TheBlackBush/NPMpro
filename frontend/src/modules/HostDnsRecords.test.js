import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	nameRow,
	needsReachConfirm,
	planOf,
	pollDelay,
	reachBlocked,
	reachText,
	recordsBadge,
	stateLine,
	ticksOf,
	ttlFor,
	wantedFromForm,
} from "./HostDnsRecords.js";

const cloudflare = {
	id: "cloudflare",
	label: "Cloudflare",
	credentialProvider: "cloudflare",
	proxied: true,
	ipv6: true,
	minTtl: 60,
};
const desec = { id: "desec", label: "deSEC", credentialProvider: "desec", proxied: false, ipv6: true, minTtl: 3600 };
const duck = {
	id: "duckdns",
	label: "DuckDNS",
	credentialProvider: "duckdns",
	zoneless: true,
	ipv6: true,
	minTtl: null,
};
const providers = [cloudflare, desec, duck];
const domains = [
	{
		name: "example.com",
		dnsCredentialId: 1,
		credential: { id: 1, name: "CF", provider: "cloudflare", ownerUserId: 7 },
	},
	{ name: "desec.test", dnsCredentialId: 2, credential: { id: 2, name: "DS", provider: "desec", ownerUserId: 7 } },
	{
		name: "duckdns.org",
		dnsCredentialId: 3,
		credential: { id: 3, name: "Duck", provider: "duckdns", ownerUserId: 7 },
	},
	{
		name: "twice.test",
		dnsCredentialId: 4,
		credential: { id: 4, name: "A", provider: "cloudflare", ownerUserId: 8 },
	},
	{
		name: "twice.test",
		dnsCredentialId: 5,
		credential: { id: 5, name: "B", provider: "cloudflare", ownerUserId: 9 },
	},
];
const plan = (name, extra = {}) =>
	planOf({
		name,
		domains,
		providers,
		userId: 7,
		canManage: true,
		address: "203.0.113.7",
		ipv6Address: null,
		...extra,
	});
const rights = { canTick: true, readOnly: false };

describe("ttlFor", () => {
	it("keeps the TTL of an existing record", () => assert.equal(ttlFor(desec, { ttl: 120 }), 120));
	it("gives a new record 300", () => assert.equal(ttlFor(cloudflare, null), 300));
	it("raises 300 to the provider's lowest TTL", () => {
		assert.equal(ttlFor(desec, null), 3600);
		assert.equal(ttlFor({ minTtl: null }, undefined), 300);
		assert.equal(ttlFor(undefined), 300);
	});
	it("ignores an existing record without a TTL", () => assert.equal(ttlFor(desec, { ttl: null }), 3600));
});

describe("the reach rule", () => {
	it("lets a reachable answer stand", () => assert.equal(needsReachConfirm({ result: "reachable" }), false));
	it("asks for the user's confirmation for every other answer", () => {
		for (const result of ["could-not-confirm", "router-answered", "overridden"]) {
			assert.equal(needsReachConfirm({ result }), true, result);
		}
		assert.equal(needsReachConfirm(null), true);
		assert.equal(needsReachConfirm(undefined), true);
	});
	it("blocks, never confirms, a name without a public address", () => {
		assert.equal(reachBlocked({ result: "no-public-address" }), true);
		assert.equal(needsReachConfirm({ result: "no-public-address" }), false);
		assert.equal(reachBlocked({ result: "reachable" }), false);
		assert.equal(reachBlocked(null), false);
	});
	it("names the text of each answer", () => {
		assert.deepEqual(reachText({ result: "reachable", address: "203.0.113.7", port: 80 }), {
			id: "host-dns.reach.reachable",
			values: { address: "203.0.113.7", port: 80 },
		});
		assert.equal(
			reachText({ result: "router-answered", address: "a", port: 80 }).id,
			"host-dns.reach.router-answered",
		);
		assert.equal(reachText({ result: "overridden" }).id, "host-dns.reach.overridden");
		assert.equal(reachText({ result: "no-public-address" }).id, "error.host-dns-no-public-address");
		assert.equal(reachText(null).id, "host-dns.reach.failed");
	});
});

describe("planOf", () => {
	it("finds the credential, zone, provider and TTL", () => {
		const found = plan("app.example.com");
		assert.equal(found.blocked, null);
		assert.equal(found.zone, "example.com");
		assert.equal(found.provider.id, "cloudflare");
		assert.equal(found.credential.id, 1);
		assert.equal(found.ttl, 300);
		assert.equal(plan("a.desec.test").ttl, 3600);
	});
	it("blocks the names the option cannot take, with the server's reason keys", () => {
		assert.equal(plan("*.example.com").blocked, "error.host-dns-wildcard");
		assert.equal(plan("~^a\\.example\\.com$").blocked, "error.host-dns-pattern");
		assert.equal(plan("app.example.com", { canManage: false }).blocked, "error.host-dns-no-right");
		assert.equal(plan("app.nowhere.test").blocked, "error.host-dns-no-credential");
		assert.equal(plan("a.twice.test").blocked, "error.host-dns-many-credentials");
		assert.equal(plan("a.duckdns.org").blocked, "error.host-dns-provider-unsupported");
	});
	it("takes the user's own credential on a zone two users listed", () => {
		const own = plan("a.twice.test", { userId: 8 });
		assert.equal(own.blocked, null);
		assert.equal(own.credential.id, 4);
	});
});

describe("nameRow", () => {
	it("offers a free name with the line of what Save will create", () => {
		const row = nameRow(plan("app.example.com"), undefined, rights);
		assert.equal(row.tickable, true);
		assert.equal(row.managed, false);
		assert.equal(row.line, null);
		assert.equal(row.blocked, null);
		assert.deepEqual(row.willCreate, {
			id: "host-dns.will-create",
			values: { ttl: 300, provider: "Cloudflare", zone: "example.com", address: "203.0.113.7", ipv6: "" },
		});
	});
	it("says so when the address is not known yet", () => {
		const row = nameRow(plan("app.example.com", { address: null }), null, rights);
		assert.equal(row.willCreate.id, "host-dns.will-create-unknown");
	});
	it("shows Proxied only for a provider with the flag, and the AAAA box only with a public IPv6", () => {
		assert.equal(nameRow(plan("app.example.com"), null, rights).showProxied, true);
		assert.equal(nameRow(plan("a.desec.test"), null, rights).showProxied, false);
		assert.equal(nameRow(plan("app.example.com"), null, rights).showIpv6, false);
		assert.equal(nameRow(plan("app.example.com", { ipv6Address: "2001:db8::1" }), null, rights).showIpv6, true);
		assert.equal(nameRow(plan("a.desec.test", { ipv6Address: "2001:db8::1" }), null, rights).showIpv6, true);
		assert.equal(
			nameRow(plan("app.example.com", { ipv6Address: "2001:db8::1" }), { name: "x", state: "ok" }, rights)
				.showIpv6,
			false,
		);
	});
	it("cannot tick a blocked name and gives the reason", () => {
		const row = nameRow(plan("*.example.com"), undefined, rights);
		assert.equal(row.tickable, false);
		assert.equal(row.blocked, "error.host-dns-wildcard");
		assert.equal(row.willCreate, null);
	});
	it("cannot tick in a View window, but shows the states", () => {
		const view = { canTick: true, readOnly: true };
		assert.equal(nameRow(plan("app.example.com"), undefined, view).tickable, false);
		const row = nameRow(
			plan("app.example.com"),
			{
				name: "app.example.com",
				state: "exists",
				adoptAllowed: true,
				found: [{ type: "A", values: ["192.0.2.5"] }],
			},
			view,
		);
		assert.deepEqual(row.actions, []);
		assert.equal(row.line.id, "host-dns.exists");
	});
	const lineOfState = (state, extra = {}) =>
		nameRow(plan("app.example.com"), { name: "app.example.com", state, ...extra }, rights);
	it("maps every state to its text, tone and buttons", () => {
		const cases = [
			["ok", {}, "host-dns.state.ok", "success", []],
			["ok", { origin: "adopted" }, "host-dns.state.adopted", "success", []],
			["pending", {}, "host-dns.state.pending", "warning", []],
			["failed", { message: "boom" }, "host-dns.state.failed", "destructive", []],
			["paused", {}, "host-dns.state.paused", "warning", []],
			["orphan", { message: "x" }, "host-dns.state.orphan", "destructive", ["remove"]],
			["covered", { coveredBy: "*.example.com" }, "host-dns.covered-by-wildcard", "success", []],
			["covered", { coveredBy: null }, "host-dns.covered-by-other", "success", []],
			["covered", { reason: "host-dns.covered-by-record" }, "host-dns.covered-by-record", "success", []],
			[
				"exists",
				{ adoptAllowed: true, found: [{ type: "A", values: ["192.0.2.5"] }] },
				"host-dns.exists",
				"warning",
				["adopt", "leave"],
			],
			[
				"exists",
				{ adoptAllowed: false, found: [{ type: "CNAME", values: ["x.test"] }] },
				"host-dns.exists-remove-first",
				"warning",
				["leave"],
			],
			["unavailable", { reason: "error.host-dns-no-right" }, "error.host-dns-no-right", "muted", []],
			["unavailable", { reason: "host-dns.other-owner" }, "host-dns.other-owner", "muted", []],
			["unavailable", { reason: null, message: "odd" }, "host-dns.state.unavailable", "muted", []],
		];
		for (const [state, extra, id, tone, actions] of cases) {
			const row = lineOfState(state, extra);
			assert.equal(row.line.id, id, `${state} ${JSON.stringify(extra)}`);
			assert.equal(row.line.tone, tone, state);
			assert.deepEqual(row.actions, actions, state);
		}
	});
	it("shows the address that exists and the detail of a failure", () => {
		const exists = lineOfState("exists", { adoptAllowed: true, found: [{ type: "A", values: ["192.0.2.5"] }] });
		assert.deepEqual(exists.line.values, { type: "A", value: "192.0.2.5" });
		assert.equal(lineOfState("failed", { message: "boom" }).line.detail, "boom");
		assert.equal(lineOfState("unavailable", { reason: null, message: "odd" }).line.detail, "odd");
	});
	it("offers Adopt and update only with Certificates manage", () => {
		const row = nameRow(
			plan("app.example.com"),
			{ name: "app.example.com", state: "exists", adoptAllowed: true, found: [] },
			{ canTick: false, readOnly: false },
		);
		assert.deepEqual(row.actions, ["leave"]);
		const orphan = nameRow(
			plan("app.example.com"),
			{ name: "app.example.com", state: "orphan" },
			{ canTick: false, readOnly: false },
		);
		assert.deepEqual(orphan.actions, []);
	});
	it("keeps a managed name ticked, so it can be unticked, whatever the plan says", () => {
		const row = nameRow(
			plan("app.example.com", { canManage: false }),
			{ name: "app.example.com", state: "ok" },
			{ canTick: false, readOnly: false },
		);
		assert.equal(row.tickable, true);
		assert.equal(row.blocked, null);
		assert.equal(row.willCreate, null);
	});
	it("treats an off state like no state", () => {
		const row = nameRow(plan("app.example.com"), { name: "app.example.com", state: "off" }, rights);
		assert.equal(row.line, null);
		assert.equal(row.tickable, true);
	});
});

describe("wantedFromForm", () => {
	it("leaves the field out until the card was touched", () => {
		assert.equal(wantedFromForm({ domainNames: ["a.example.com"] }), undefined);
		assert.equal(wantedFromForm({ npmproDnsRecords: undefined, domainNames: ["a.example.com"] }), undefined);
	});
	it("sends an empty list when everything is unticked", () => {
		assert.deepEqual(wantedFromForm({ npmproDnsRecords: [], domainNames: ["a.example.com"] }), []);
	});
	it("sends only the ticked names the host still has, once, with the boxes that are on", () => {
		const values = {
			domainNames: ["a.example.com", "B.example.com"],
			npmproDnsRecords: [
				{ name: "a.example.com", proxied: true, ipv6: false, reachConfirmed: true },
				{ name: "b.example.com", ipv6: true },
				{ name: "b.example.com" },
				{ name: "gone.example.com" },
			],
		};
		assert.deepEqual(wantedFromForm(values), [
			{ name: "a.example.com", proxied: true, reachConfirmed: true },
			{ name: "b.example.com", ipv6: true },
		]);
	});
	it("sends nothing for a name that is not ticked", () => {
		assert.deepEqual(
			wantedFromForm({
				domainNames: ["a.example.com", "b.example.com"],
				npmproDnsRecords: [{ name: "a.example.com" }],
			}),
			[{ name: "a.example.com" }],
		);
	});
});

describe("ticksOf", () => {
	it("ticks the names that hold a row and still belong to the host", () => {
		const records = [
			{ name: "a.example.com", state: "ok", ipv6: true },
			{ name: "b.example.com", state: "exists", ipv6: false },
			{ name: "c.example.com", state: "orphan" },
			{ name: "d.example.com", state: "covered" },
			{ name: "gone.example.com", state: "ok" },
		];
		assert.deepEqual(ticksOf(records, ["A.example.com", "b.example.com", "c.example.com", "d.example.com"]), [
			{ name: "a.example.com", ipv6: true },
			{ name: "b.example.com", ipv6: false },
		]);
		assert.deepEqual(ticksOf(undefined, undefined), []);
	});
});

describe("recordsBadge", () => {
	it("is green for ok, amber for pending, exists or paused, red for failed or orphan", () => {
		assert.deepEqual(recordsBadge([{ state: "ok" }]), { state: "ok", tone: "success" });
		for (const state of ["pending", "exists", "paused"])
			assert.equal(recordsBadge([{ state }]).tone, "warning", state);
		for (const state of ["failed", "orphan"]) assert.equal(recordsBadge([{ state }]).tone, "destructive", state);
	});
	it("shows the worst state of the host", () => {
		assert.equal(recordsBadge([{ state: "ok" }, { state: "pending" }, { state: "failed" }]).state, "failed");
		assert.equal(recordsBadge([{ state: "ok" }, { state: "paused" }]).state, "paused");
	});
	it("has no badge without a managed row", () => {
		assert.equal(recordsBadge(undefined), null);
		assert.equal(recordsBadge([]), null);
		assert.equal(recordsBadge([{ state: "covered" }, { state: "unavailable" }, { state: "off" }]), null);
	});
});

describe("pollDelay", () => {
	it("reads again every 3 seconds while a name is pending, at most 10 times", () => {
		assert.equal(pollDelay([{ state: "pending" }], 0), 3000);
		assert.equal(pollDelay([{ state: "ok" }, { state: "pending" }], 9), 3000);
		assert.equal(pollDelay([{ state: "pending" }], 10), false);
	});
	it("stops when no name is pending", () => {
		assert.equal(pollDelay([{ state: "ok" }, { state: "failed" }], 0), false);
		assert.equal(pollDelay(undefined, 0), false);
	});
});

describe("stateLine", () => {
	it("gives the line of a state, none for a name without one", () => {
		assert.equal(stateLine({ state: "ok" }).id, "host-dns.state.ok");
		assert.equal(stateLine({ state: "off" }), null);
	});
});
