import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	badgeLines,
	createPoller,
	deletesOnSave,
	dnsRecordErrors,
	hasOrphans,
	nameRow,
	needsReachConfirm,
	pollDelay,
	reachBlocked,
	reachPending,
	reachText,
	recordsBadge,
	refusedTicks,
	stateLine,
	ticksOf,
	ttlFor,
	wantedFromForm,
	withChange,
	withoutTick,
	withReachChecks,
	withTick,
} from "./HostDnsRecords.js";

const plan = (extra = {}) => ({
	name: "app.example.com",
	available: true,
	reason: null,
	message: null,
	coveredBy: null,
	credential: { id: 1, name: "CF" },
	zone: "example.com",
	providerLabel: "Cloudflare",
	address: "203.0.113.7",
	ipv6Address: null,
	ttl: 300,
	proxiedAllowed: true,
	existing: null,
	...extra,
});
const rights = { canTick: true, readOnly: false };
const state = (value, extra = {}) => ({ name: "app.example.com", state: value, ...extra });

describe("ttlFor", () => {
	it("keeps the TTL of an existing record", () => assert.equal(ttlFor({ minTtl: 3600 }, { ttl: 120 }), 120));
	it("gives a new record 300, raised to the provider's lowest TTL", () => {
		assert.equal(ttlFor({ minTtl: 60 }, null), 300);
		assert.equal(ttlFor({ minTtl: 3600 }, null), 3600);
		assert.equal(ttlFor({ minTtl: null }, undefined), 300);
		assert.equal(ttlFor(undefined), 300);
		assert.equal(ttlFor({ minTtl: 3600 }, { ttl: null }), 3600);
	});
});

describe("the reach rule", () => {
	it("lets a reachable answer stand while the server remembers it", () => {
		assert.equal(needsReachConfirm({ result: "reachable", at: 1000 }), false);
		assert.equal(needsReachConfirm({ result: "reachable", at: 1000 }, 1000 + 8 * 60 * 1000), false);
	});
	it("asks again when a reachable answer is older than the server keeps it", () => {
		assert.equal(needsReachConfirm({ result: "reachable", at: 1000 }, 1000 + 9 * 60 * 1000), true);
		assert.equal(needsReachConfirm({ result: "reachable" }, 9 * 60 * 1000), true);
	});
	it("asks for the user's confirmation for every other answer", () => {
		for (const result of ["could-not-confirm", "router-answered", "overridden"]) {
			assert.equal(needsReachConfirm({ result }), true, result);
		}
		assert.equal(needsReachConfirm({ at: 5 }), true);
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
		assert.equal(reachText({ result: "could-not-confirm" }).id, "host-dns.reach.could-not-confirm");
		assert.equal(reachText({ result: "no-public-address" }).id, "error.host-dns-no-public-address");
		assert.equal(reachText(null).id, "host-dns.reach.failed");
		assert.deepEqual(reachText({ result: "reachable" }).values, { address: "", port: 80 });
	});
});

describe("nameRow of a free name", () => {
	it("offers a tick and promises what Save creates", () => {
		const row = nameRow(plan(), undefined, rights);
		assert.equal(row.tickable, true);
		assert.equal(row.managed, false);
		assert.equal(row.line, null);
		assert.equal(row.blocked, null);
		assert.equal(row.existing, null);
		assert.deepEqual(row.willCreate, {
			id: "host-dns.will-create",
			values: { address: "203.0.113.7", ipv6: "", ttl: 300, provider: "Cloudflare", zone: "example.com" },
		});
	});
	it("mentions the AAAA only when its box is ticked", () => {
		const base = { ...rights, ipv6Address: "2001:db8::1" };
		assert.equal(nameRow(plan(), null, base).showIpv6, true);
		assert.equal(nameRow(plan(), null, base).willCreate.id, "host-dns.will-create");
		const ticked = nameRow(plan(), null, { ...base, ipv6: true });
		assert.equal(ticked.willCreate.id, "host-dns.will-create-ipv6");
		assert.equal(ticked.willCreate.values.ipv6, "2001:db8::1");
		assert.equal(nameRow(plan(), null, { ...rights, ipv6: true }).willCreate.id, "host-dns.will-create");
	});
	it("shows the AAAA box from the plan's own IPv6 too, and none without one", () => {
		assert.equal(nameRow(plan({ ipv6Address: "2001:db8::2" }), null, rights).showIpv6, true);
		assert.equal(nameRow(plan(), null, rights).showIpv6, false);
	});
	it("shows Proxied only for a provider with the flag", () => {
		assert.equal(nameRow(plan(), null, rights).showProxied, true);
		assert.equal(nameRow(plan({ proxiedAllowed: false }), null, rights).showProxied, false);
	});
	it("promises nothing for a name that already holds a record", () => {
		const row = nameRow(plan({ existing: [{ type: "A", values: ["192.0.2.5"] }] }), null, rights);
		assert.equal(row.tickable, true);
		assert.equal(row.willCreate, null);
		assert.equal(row.showProxied, false);
		assert.deepEqual(row.existing.values, { type: "A", value: "192.0.2.5" });
		assert.equal(row.existing.id, "host-dns.exists");
	});
	it("cannot be ticked while the plan loads or in a View window", () => {
		assert.equal(nameRow(undefined, undefined, rights).tickable, false);
		assert.equal(nameRow(plan(), undefined, { canTick: true, readOnly: true }).tickable, false);
	});
	it("cannot be ticked when the plan refuses it, with the reason's line", () => {
		const cases = [
			["error.host-dns-wildcard", null, "error.host-dns-wildcard"],
			["error.host-dns-no-credential", null, "error.host-dns-no-credential"],
			["error.host-dns-name-taken", null, "error.host-dns-name-taken"],
			["host-dns.covered-by-record", "app.example.com", "host-dns.covered-by-record"],
			["host-dns.covered-by-wildcard", "*.example.com", "host-dns.covered-by-wildcard"],
			["host-dns.covered-by-other", null, "host-dns.covered-by-other"],
			["something-new", null, "host-dns.state.unavailable"],
		];
		for (const [reason, coveredBy, id] of cases) {
			const row = nameRow(plan({ available: false, reason, message: "text", coveredBy }), undefined, rights);
			assert.equal(row.tickable, false, reason);
			assert.equal(row.blocked.id, id, reason);
			assert.equal(row.willCreate, null);
		}
		const covered = nameRow(
			plan({ available: false, reason: "host-dns.covered-by-wildcard", coveredBy: "*.example.com" }),
			null,
			rights,
		);
		assert.deepEqual(covered.blocked.values, { name: "*.example.com" });
		const unknown = nameRow(plan({ available: false, reason: "something-new", message: "odd" }), null, rights);
		assert.equal(unknown.blocked.detail, "odd");
	});
	it("cannot be ticked on a disabled host", () => {
		const row = nameRow(plan(), undefined, { ...rights, hostDisabled: true });
		assert.equal(row.tickable, false);
		assert.equal(row.blocked.id, "error.host-dns-host-disabled");
	});
});

describe("nameRow of a name with a state", () => {
	const lineOfState = (value, extra = {}) => nameRow(plan(), state(value, extra), rights);
	it("maps every state to its text, tone and buttons", () => {
		const cases = [
			["ok", {}, "host-dns.state.ok", "success", []],
			["ok", { origin: "adopted" }, "host-dns.state.adopted", "success", []],
			["pending", {}, "host-dns.state.pending", "warning", []],
			["failed", { message: "boom" }, "host-dns.state.failed", "destructive", []],
			["paused", {}, "host-dns.state.paused", "warning", []],
			["orphan", { message: "x" }, "host-dns.state.orphan", "destructive", ["remove"]],
			[
				"covered",
				{ coveredBy: "*.example.com", reason: "host-dns.covered-by-wildcard" },
				"host-dns.covered-by-wildcard",
				"success",
				[],
			],
			[
				"covered",
				{ coveredBy: null, reason: "host-dns.covered-by-other" },
				"host-dns.covered-by-other",
				"success",
				[],
			],
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
			["unavailable", { reason: null, message: "odd" }, "host-dns.state.unavailable", "muted", []],
		];
		for (const [value, extra, id, tone, actions] of cases) {
			const row = lineOfState(value, extra);
			assert.equal(row.line.id, id, `${value} ${JSON.stringify(extra)}`);
			assert.equal(row.line.tone, tone, value);
			assert.deepEqual(row.actions, actions, value);
		}
	});
	it("shows the address that exists and the detail of a failure", () => {
		const exists = lineOfState("exists", { adoptAllowed: true, found: [{ type: "A", values: ["192.0.2.5"] }] });
		assert.deepEqual(exists.line.values, { type: "A", value: "192.0.2.5" });
		assert.deepEqual(lineOfState("exists", { adoptAllowed: true }).line.values, { type: "A", value: "" });
		assert.equal(lineOfState("failed", { message: "boom" }).line.detail, "boom");
		assert.equal(lineOfState("failed", {}).line.detail, null);
		assert.equal(lineOfState("unavailable", { reason: null, message: "odd" }).line.detail, "odd");
		assert.equal(lineOfState("unavailable", { reason: "error.host-dns-no-right", message: "x" }).line.detail, null);
	});
	it("shows another owner's row as managed by another user, whatever its state, without buttons or values", () => {
		for (const value of ["ok", "pending", "failed", "paused", "orphan", "exists", "unavailable"]) {
			const row = lineOfState(value, {
				reason: "host-dns.other-owner",
				message: "Managed by another user",
				adoptAllowed: true,
				found: [{ type: "A", values: ["192.0.2.5"] }],
			});
			assert.equal(row.line.id, "host-dns.other-owner", value);
			assert.deepEqual(row.line.values, {}, value);
			assert.deepEqual(row.actions, [], value);
		}
	});
	it("offers Adopt and update only with Certificates manage, and no button in a View window", () => {
		const exists = state("exists", { adoptAllowed: true, found: [] });
		assert.deepEqual(nameRow(plan(), exists, { canTick: false, readOnly: false }).actions, ["leave"]);
		assert.deepEqual(nameRow(plan(), state("orphan"), { canTick: false, readOnly: false }).actions, []);
		assert.deepEqual(nameRow(plan(), exists, { canTick: true, readOnly: true }).actions, []);
		assert.equal(nameRow(plan(), exists, { canTick: true, readOnly: true }).line.id, "host-dns.exists");
	});
	it("keeps a managed name ticked and untickable whatever the plan says", () => {
		const row = nameRow(plan({ available: false, reason: "error.host-dns-no-right" }), state("ok"), {
			canTick: false,
			readOnly: false,
		});
		assert.equal(row.tickable, true);
		assert.equal(row.managed, true);
		assert.equal(row.blocked, null);
		assert.equal(row.willCreate, null);
		assert.equal(row.showIpv6, false);
		assert.equal(nameRow(undefined, state("ok"), rights).tickable, true);
	});
	it("treats an off state like no state", () => {
		const row = nameRow(plan(), state("off"), rights);
		assert.equal(row.line, null);
		assert.equal(row.tickable, true);
	});
});

describe("ticks", () => {
	it("adds a name once, removes it and replaces its entry, by name without case", () => {
		const one = withTick([], "A.example.com");
		assert.deepEqual(one, [{ name: "A.example.com", proxied: false, ipv6: false, reachConfirmed: false }]);
		assert.equal(withTick(one, "a.example.com"), one);
		assert.deepEqual(withChange(one, { name: "a.example.com", ipv6: true }), [
			{ name: "a.example.com", ipv6: true },
		]);
		assert.deepEqual(withoutTick(one, "a.EXAMPLE.com"), []);
		assert.deepEqual(withoutTick(one, "b.example.com"), one);
	});
	it("starts from the names that hold a row and still belong to the host", () => {
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

describe("wantedFromForm", () => {
	it("leaves the field out until the card was touched", () => {
		assert.equal(wantedFromForm({ domainNames: ["a.example.com"] }), undefined);
		assert.equal(wantedFromForm(undefined), undefined);
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
		assert.deepEqual(wantedFromForm({ npmproDnsRecords: [{ name: "a.example.com" }] }), []);
	});
});

describe("recordsBadge and badgeLines", () => {
	it("is green for ok, amber for pending, exists or paused, red for failed or orphan", () => {
		assert.deepEqual(recordsBadge([{ state: "ok" }]), { state: "ok", tone: "success" });
		for (const value of ["pending", "exists", "paused"])
			assert.equal(recordsBadge([{ state: value }]).tone, "warning", value);
		for (const value of ["failed", "orphan"])
			assert.equal(recordsBadge([{ state: value }]).tone, "destructive", value);
	});
	it("shows the worst state of the host, and none without a managed row", () => {
		assert.equal(recordsBadge([{ state: "ok" }, { state: "pending" }, { state: "failed" }]).state, "failed");
		assert.equal(recordsBadge([{ state: "ok" }, { state: "paused" }]).state, "paused");
		assert.equal(recordsBadge(undefined), null);
		assert.equal(recordsBadge([{ state: "covered" }, { state: "unavailable" }, { state: "off" }]), null);
	});
	it("lists a line for each managed name only", () => {
		const lines = badgeLines([
			{ name: "a.example.com", state: "ok" },
			{ name: "b.example.com", state: "covered" },
			{ name: "c.example.com", state: "exists", adoptAllowed: true, found: [{ type: "A", values: ["1.2.3.4"] }] },
		]);
		assert.deepEqual(
			lines.map((one) => [one.name, one.line.id]),
			[
				["a.example.com", "host-dns.state.ok"],
				["c.example.com", "host-dns.exists"],
			],
		);
		assert.deepEqual(badgeLines(undefined), []);
	});
	it("gives a line for a state, none for a name without one", () => {
		assert.equal(stateLine({ state: "ok" }).id, "host-dns.state.ok");
		assert.equal(stateLine({ state: "off" }), null);
	});
});

describe("polling", () => {
	it("reads again every 3 seconds while a name is pending, at most 10 times", () => {
		assert.equal(pollDelay([{ state: "pending" }], 0), 3000);
		assert.equal(pollDelay([{ state: "ok" }, { state: "pending" }], 9), 3000);
		assert.equal(pollDelay([{ state: "pending" }], 10), false);
		assert.equal(pollDelay([{ state: "ok" }, { state: "failed" }], 0), false);
		assert.equal(pollDelay(undefined, 0), false);
	});
	it("counts across stops and starts over only after the window", () => {
		let time = 1_000_000;
		const next = createPoller(() => time);
		const pending = [{ state: "pending" }];
		for (let read = 0; read < 10; read += 1) assert.equal(next(pending), 3000);
		assert.equal(next(pending), false);
		// polling stopped (no name pending) and a later fetch finds one pending again: still the same window
		assert.equal(next([{ state: "ok" }]), false);
		assert.equal(next(pending), false);
		time += 2 * 60 * 1000;
		assert.equal(next(pending), 3000);
	});
});

describe("the save's reach check", () => {
	const NOW = 1_000_000_000;
	const MESSAGE = "Confirm that you checked from outside";
	const tick = (name, reach, extra = {}) => ({
		name,
		proxied: false,
		ipv6: false,
		reachConfirmed: false,
		reach,
		...extra,
	});
	const done = (result, at = NOW) => ({ status: "done", result: { result }, at });

	it("needs the confirmation while the probe runs, could not run, or did not find this server", () => {
		assert.equal(reachPending(tick("a", { status: "checking" }), NOW), true);
		assert.equal(reachPending(tick("a", { status: "failed", at: NOW }), NOW), true);
		assert.equal(reachPending(tick("a", done("could-not-confirm")), NOW), true);
		assert.equal(reachPending(tick("a", done("router-answered")), NOW), true);
		assert.equal(reachPending(tick("a", done("reachable")), NOW), false);
		// the server forgets a reachable answer: the confirmation is needed again
		assert.equal(reachPending(tick("a", done("reachable", NOW - 9 * 60 * 1000)), NOW), true);
		// confirmed, or a tick without a probe of this window (a name that has a row): nothing needed
		assert.equal(reachPending(tick("a", done("could-not-confirm"), { reachConfirmed: true }), NOW), false);
		assert.equal(reachPending({ name: "a", ipv6: false }, NOW), false);
	});

	it("puts the message on the box of each ticked name of the host that needs it", () => {
		const values = {
			domainNames: ["a.example.com", "B.example.com"],
			npmproDnsRecords: [
				tick("a.example.com", done("reachable")),
				tick("b.example.com", done("could-not-confirm")),
				// a name the host no longer has is not sent, so it refuses nothing
				tick("gone.example.com", { status: "checking" }),
			],
		};
		assert.deepEqual(dnsRecordErrors(values, MESSAGE, NOW), {
			npmproDnsRecords: [undefined, { reachConfirmed: MESSAGE }, undefined],
		});
		assert.deepEqual(dnsRecordErrors({ domainNames: ["a.example.com"] }, MESSAGE, NOW), {});
		const confirmed = { ...values, npmproDnsRecords: values.npmproDnsRecords.slice(0, 2) };
		confirmed.npmproDnsRecords[1] = { ...confirmed.npmproDnsRecords[1], reachConfirmed: true };
		assert.deepEqual(dnsRecordErrors(confirmed, MESSAGE, NOW), {});
	});

	it("adds the boxes' errors to a window's validate, also one that answers a promise", async () => {
		const values = {
			domainNames: ["a.example.com"],
			npmproDnsRecords: [tick("a.example.com", { status: "checking" })],
		};
		const own = () => ({ forwardHost: "Required" });
		assert.deepEqual(withReachChecks(own, () => MESSAGE)(values), {
			forwardHost: "Required",
			npmproDnsRecords: [{ reachConfirmed: MESSAGE }],
		});
		assert.deepEqual(
			await withReachChecks(
				() => Promise.resolve({}),
				() => MESSAGE,
			)(values),
			{
				npmproDnsRecords: [{ reachConfirmed: MESSAGE }],
			},
		);
		assert.deepEqual(withReachChecks(undefined, () => MESSAGE)({ domainNames: [] }), {});
		assert.deepEqual(
			withReachChecks(
				() => undefined,
				() => MESSAGE,
			)({ domainNames: [] }),
			{},
		);
	});
});

describe("after a save", () => {
	it("names each ticked name the answer refused or failed, with its reason", () => {
		const wanted = [
			{ name: "a.example.com" },
			{ name: "B.example.com" },
			{ name: "c.example.com" },
			{ name: "d.example.com" },
		];
		const states = [
			{ name: "a.example.com", state: "unavailable", reason: "error.host-dns-reach-unconfirmed", message: "x" },
			{ name: "b.example.com", state: "failed", reason: null, message: "HTTP 500 at the provider" },
			{ name: "c.example.com", state: "pending", reason: null, message: null },
			{ name: "d.example.com", state: "failed", reason: null, message: null },
			// not asked by this save
			{ name: "e.example.com", state: "unavailable", reason: "error.host-dns-no-right", message: null },
		];
		assert.deepEqual(refusedTicks(wanted, states), [
			{ name: "a.example.com", id: "error.host-dns-reach-unconfirmed", detail: null },
			{ name: "b.example.com", id: null, detail: "HTTP 500 at the provider" },
			{ name: "d.example.com", id: "host-dns.state.failed", detail: null },
		]);
		assert.deepEqual(refusedTicks(undefined, states), []);
		assert.deepEqual(refusedTicks(wanted, undefined), []);
	});

	it("says a save with the option off deletes records only for created records that are kept, and finds orphans", () => {
		assert.equal(deletesOnSave([{ state: "ok", origin: "created" }]), true);
		assert.equal(deletesOnSave([{ state: "orphan", origin: "created" }]), false);
		assert.equal(deletesOnSave([{ state: "ok", origin: "adopted" }]), false);
		assert.equal(deletesOnSave(undefined), false);
		assert.equal(hasOrphans([{ state: "ok" }, { state: "orphan" }]), true);
		assert.equal(hasOrphans([{ state: "ok" }]), false);
		assert.equal(hasOrphans(undefined), false);
	});
});
