import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDdnsEngine, HISTORY_LIMIT } from "../lib/ddns/engine.js";
import { DdnsProviderError } from "../lib/ddns/errors.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = Date.parse("2026-11-24T10:00:00Z");
const IP4 = "81.2.69.160";
const IP4_NEW = "81.2.69.161";
const IP6 = "2a00:1450:4001:80b:1234:5678:9abc:def0";
const TOKEN = "tok-secret-1234";
const SINGLE = /2 addresses/u;
const ADDRESS_AT_NAME = /address record/u;
const CNAME_AT_NAME = /CNAME record/u;
const STARS = /\*\*\*/u;
const TOKEN_FOUND = /tok-secret/u;

const makeClock = () => {
	let time = START;
	return {
		now: () => time,
		advance: (ms) => {
			time += ms;
		},
	};
};

const recordRow = (over = {}) => ({
	id: 1,
	enabled: true,
	provider: "fake",
	name: "home.example.com",
	zone: "example.com",
	kind: "address",
	target: null,
	ip_version: "ipv4",
	ipv6_suffix: null,
	ttl: null,
	state: "pending",
	failures: 0,
	next_try_on: null,
	last_changed_on: null,
	meta: {},
	...over,
});

// the harness: an in-memory store, a fake public IP, a fake provider with a zone of records, a fake resolver
// the fakes are plain functions; the engine awaits them like the real asynchronous ones
const promisedFn =
	(fn) =>
	(...args) =>
		new Promise((resolve) => resolve(fn(...args)));
const promised = (object) =>
	Object.fromEntries(
		Object.entries(object).map(([key, fn]) => [key, typeof fn === "function" ? promisedFn(fn) : fn]),
	);

const harness = ({ records = [recordRow()], zone = {}, resolver = () => null, ip = {}, cooldownMs = 5 * MIN } = {}) => {
	const clock = makeClock();
	const rows = new Map(records.map((row) => [row.id, structuredClone(row)]));
	const historyRows = [];
	const detects = [];
	const resolves = [];
	const calls = [];
	const dns = { ...zone };
	const states = {
		4: { address: IP4, error: null, error_i18n: null },
		6: { address: IP6, error: null, error_i18n: null },
		...ip,
	};
	const key = (type) => `${type}`;
	const provider = promised({
		id: "fake",
		read: ({ type, meta }) => {
			calls.push({ op: "read", type, meta });
			if (dns.readError) throw dns.readError;
			const values = dns[key(type)];
			return values ? { values, ttl: 300, meta: { zone_id: "z1", record_id: `r-${type}`, ...dns.meta } } : null;
		},
		write: ({ type, ip: value, existing, meta }) => {
			calls.push({ op: "write", type, ip: value, existing, meta });
			if (dns.writeError) throw dns.writeError;
			dns[key(type)] = [value];
			return { meta: { zone_id: "z1", record_id: `r-${type}`, ...meta }, created: existing === null };
		},
	});
	const store = promised({
		enabledRecords: () => [...rows.values()].filter((row) => row.enabled).map((row) => structuredClone(row)),
		getRecord: (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
		saveRecord: (id, patch) => {
			Object.assign(rows.get(id), patch);
		},
		addHistory: (id, row) => {
			historyRows.push({ ddns_record_id: id, created_on: clock.now(), ...row });
		},
		trimHistory: (id, keep) => {
			const own = historyRows.filter((row) => row.ddns_record_id === id);
			for (const row of own.slice(0, Math.max(own.length - keep, 0)))
				historyRows.splice(historyRows.indexOf(row), 1);
		},
		openCredential: () => ({ fields: { token: TOKEN }, secrets: [TOKEN] }),
	});
	const engine = createDdnsEngine({
		store,
		publicIp: promised({
			detect: (family) => {
				detects.push(family);
				return states[family];
			},
		}),
		providers: { providerById: (id) => (id === "fake" ? provider : null) },
		resolveName: promisedFn((name, type, servers) => {
			resolves.push({ name, type, servers });
			return resolver(name, type);
		}),
		settings: () => ({ periodMs: 5 * MIN, cooldownMs, resolvers: ["9.9.9.9"] }),
		clock,
		makeFetch: () => () => Promise.resolve({}),
	});
	return { engine, rows, row: (id = 1) => rows.get(id), historyRows, detects, resolves, calls, dns, clock, states };
};

const writes = (h) => h.calls.filter((call) => call.op === "write");

describe("ddns engine: cycle", () => {
	it("does nothing and asks no service when no record is enabled", async () => {
		const h = harness({ records: [recordRow({ enabled: false })] });
		assert.deepEqual(await h.engine.cycle(), { ran: false });
		assert.deepEqual(h.detects, []);
		assert.equal(h.calls.length, 0);
	});

	it("detects only the families the enabled address records need", async () => {
		const h = harness({ records: [recordRow()], zone: { A: [IP4] } });
		await h.engine.cycle();
		assert.deepEqual(h.detects, [4]);
		const v6 = harness({ records: [recordRow({ ip_version: "ipv6" })], zone: { AAAA: [IP6] } });
		await v6.engine.cycle();
		assert.deepEqual(v6.detects, [6]);
		const both = harness({ records: [recordRow({ ip_version: "both" })], zone: { A: [IP4], AAAA: [IP6] } });
		await both.engine.cycle();
		assert.deepEqual(both.detects, [4, 6]);
	});

	it("asks no public IP service for alias records", async () => {
		const h = harness({
			records: [recordRow({ kind: "alias", target: "target.example.net" })],
			zone: { CNAME: ["target.example.net"] },
		});
		await h.engine.cycle();
		assert.deepEqual(h.detects, []);
		assert.equal(h.row().state, "ok");
	});

	it("skips a record that is not due and runs it with force", async () => {
		const later = new Date(START + HOUR);
		const h = harness({ records: [recordRow({ next_try_on: later })], zone: { A: [IP4] } });
		await h.engine.cycle();
		assert.equal(h.calls.length, 0);
		assert.deepEqual(h.detects, []);
		await h.engine.cycle({ force: true });
		assert.equal(h.row().state, "ok");
	});
});

describe("ddns engine: address records", () => {
	it("counts an answer equal to the public address as up to date, with no API call and no history", async () => {
		const h = harness({ resolver: () => [IP4] });
		await h.engine.cycle();
		assert.equal(h.calls.length, 0);
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().failures, 0);
		assert.ok(h.row().last_checked_on);
		assert.equal(h.row().last_ipv4, IP4);
		assert.equal(h.historyRows.length, 0);
		assert.deepEqual(h.resolves[0].servers, ["9.9.9.9"]);
	});

	it("never uses the resolver for a proxied record", async () => {
		const h = harness({
			records: [recordRow({ meta: { proxied: true, zone_id: "z1" } })],
			resolver: () => [IP4],
			zone: { A: [IP4], meta: { proxied: true } },
		});
		await h.engine.cycle();
		assert.equal(h.resolves.length, 0);
		assert.equal(h.calls[0].op, "read");
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().meta.proxied, true);
		assert.equal(writes(h).length, 0);
	});

	it("reads through the provider when the resolver differs or fails, and stores proxied as read", async () => {
		const h = harness({ resolver: () => null, zone: { A: [IP4], meta: { proxied: false } } });
		await h.engine.cycle();
		assert.equal(h.calls[0].op, "read");
		assert.equal(h.row().meta.proxied, false);
		assert.equal(h.historyRows.length, 0);
	});

	it("creates a missing record (A10) and writes a history row", async () => {
		const h = harness({});
		await h.engine.cycle();
		assert.equal(writes(h).length, 1);
		assert.equal(writes(h)[0].existing, null);
		assert.equal(h.row().state, "ok");
		assert.deepEqual(
			h.historyRows.map(({ kind, ip_version, old_ip, new_ip }) => ({ kind, ip_version, old_ip, new_ip })),
			[{ kind: "created", ip_version: "ipv4", old_ip: null, new_ip: IP4 }],
		);
	});

	it("never touches a record set with more than one value (A11)", async () => {
		const h = harness({ zone: { A: [IP4, IP4_NEW] } });
		await h.engine.cycle();
		assert.equal(writes(h).length, 0);
		const row = h.row();
		assert.equal(row.state, "failed");
		assert.match(row.error, SINGLE);
		assert.equal(row.meta.error_i18n, "error.ddns-multi-value");
		assert.deepEqual(row.meta.error_values, { count: 2 });
		assert.equal(row.failures, 1);
		assert.deepEqual(
			h.historyRows.map((r) => r.kind),
			["failed"],
		);
	});

	it("writes a different address, passing the read meta, and records old and new", async () => {
		const h = harness({ zone: { A: [IP4_NEW], meta: { proxied: true } }, records: [recordRow({ meta: {} })] });
		await h.engine.cycle();
		const [write] = writes(h);
		assert.equal(write.ip, IP4);
		assert.equal(write.meta.record_id, "r-A");
		assert.equal(write.meta.zone_id, "z1");
		assert.equal(h.row().last_changed_on.getTime(), START);
		assert.deepEqual(
			h.historyRows.map(({ kind, old_ip, new_ip }) => ({ kind, old_ip, new_ip })),
			[{ kind: "changed", old_ip: IP4_NEW, new_ip: IP4 }],
		);
		assert.equal(h.row().meta.proxied, true);
	});

	it("keeps the write waiting inside the cooldown and writes after it", async () => {
		const wrote = new Date(START - MIN);
		const h = harness({ zone: { A: [IP4_NEW] }, records: [recordRow({ last_changed_on: wrote, state: "ok" })] });
		await h.engine.cycle();
		assert.equal(writes(h).length, 0);
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().next_try_on.getTime(), START - MIN + 5 * MIN);
		assert.equal(h.row().failures, 0);
		h.clock.advance(5 * MIN);
		await h.engine.cycle();
		assert.equal(writes(h).length, 1);
		assert.equal(h.row().next_try_on, null);
	});

	it("answers Update now inside the cooldown with error.ddns-cooldown and the time", async () => {
		const wrote = new Date(START - MIN);
		const h = harness({ zone: { A: [IP4_NEW] }, records: [recordRow({ last_changed_on: wrote })] });
		await assert.rejects(h.engine.updateRecord(1, { now: true }), (err) => {
			assert.equal(err.message_i18n, "error.ddns-cooldown");
			assert.equal(err.message_values.next_write_on, new Date(START + 4 * MIN).toISOString());
			return true;
		});
		assert.equal(writes(h).length, 0);
	});

	it("touches no record while the public address is unknown, failed or unconfirmed", async () => {
		for (const state of [
			{ address: null, error_i18n: "error.ddns-ip-failed" },
			{ address: IP4_NEW, error_i18n: "error.ddns-ip-disagree" },
			{ address: IP4_NEW, error_i18n: "error.ddns-ip-unconfirmed" },
		]) {
			const h = harness({ ip: { 4: state }, zone: { A: [IP4] } });
			await h.engine.cycle();
			assert.equal(h.calls.length, 0);
			assert.equal(h.resolves.length, 0);
			assert.equal(h.row().state, "pending");
			assert.equal(h.row().failures, 0);
			assert.equal(h.historyRows.length, 0);
		}
	});

	it("does not touch a record whose family has no public address while the other has", async () => {
		const h = harness({
			records: [recordRow({ ip_version: "both" })],
			ip: { 6: { address: null, error_i18n: "error.ddns-ip-failed" } },
			zone: { A: [IP4_NEW], AAAA: [IP6] },
		});
		await h.engine.cycle();
		assert.equal(h.calls.length, 0);
		assert.equal(h.row().state, "pending");
	});

	it("writes IPv6 with the suffix over the detected prefix", async () => {
		const h = harness({
			records: [recordRow({ ip_version: "ipv6", ipv6_suffix: "::1" })],
			zone: { AAAA: ["2a00:1450:4001:80b::2"] },
		});
		await h.engine.cycle();
		assert.equal(writes(h)[0].ip, "2a00:1450:4001:80b::1");
		assert.equal(h.row().last_ipv6, "2a00:1450:4001:80b::1");
	});

	it("compares IPv6 spellings by value", async () => {
		const h = harness({
			records: [recordRow({ ip_version: "ipv6", ipv6_suffix: "::1" })],
			resolver: () => ["2A00:1450:4001:080B:0:0:0:1"],
		});
		await h.engine.cycle();
		assert.equal(h.calls.length, 0);
		assert.equal(h.row().state, "ok");
	});

	it("keeps both families of a both-record apart", async () => {
		const h = harness({ records: [recordRow({ ip_version: "both" })], zone: { A: [IP4_NEW], AAAA: [IP6] } });
		await h.engine.cycle();
		assert.deepEqual(
			writes(h).map((w) => w.type),
			["A"],
		);
		assert.equal(writes(h)[0].meta.record_id, "r-A");
		assert.equal(h.row().last_ipv4, IP4);
		assert.equal(h.row().last_ipv6, IP6);
	});

	it("refuses to create next to a CNAME and leaves it", async () => {
		const h = harness({ zone: { CNAME: ["other.example.net"] } });
		await h.engine.cycle();
		assert.equal(writes(h).length, 0);
		assert.equal(h.row().state, "failed");
		assert.match(h.row().error, CNAME_AT_NAME);
		assert.equal(h.row().meta.error_i18n, "error.ddns-name-has-cname");
	});
});

describe("ddns engine: alias records", () => {
	const alias = (over = {}) => recordRow({ kind: "alias", target: "target.example.net", ...over });

	it("creates a missing CNAME through the API and never uses the resolver", async () => {
		const h = harness({ records: [alias()], resolver: () => ["target.example.net"] });
		await h.engine.cycle();
		assert.equal(h.resolves.length, 0);
		assert.equal(writes(h)[0].type, "CNAME");
		assert.equal(writes(h)[0].ip, "target.example.net");
		assert.deepEqual(
			h.historyRows.map((r) => [r.kind, r.ip_version, r.new_ip]),
			[["created", null, "target.example.net"]],
		);
	});

	it("compares a target without case and trailing dot, and rewrites a different one", async () => {
		const h = harness({ records: [alias()], zone: { CNAME: ["TARGET.example.net."] } });
		await h.engine.cycle();
		assert.equal(writes(h).length, 0);
		assert.equal(h.row().state, "ok");
		h.dns.CNAME = ["old.example.net"];
		await h.engine.cycle();
		assert.equal(writes(h).length, 1);
		assert.equal(h.historyRows.at(-1).old_ip, "old.example.net");
	});

	it("keeps the cooldown for a CNAME rewrite", async () => {
		const h = harness({
			records: [alias({ last_changed_on: new Date(START - MIN) })],
			zone: { CNAME: ["old.example.net"] },
		});
		await h.engine.cycle();
		assert.equal(writes(h).length, 0);
	});

	it("is Failed when an address record is at the name", async () => {
		for (const type of ["A", "AAAA"]) {
			const h = harness({ records: [alias()], zone: { [type]: [IP4] } });
			await h.engine.cycle();
			assert.equal(writes(h).length, 0);
			assert.equal(h.row().state, "failed");
			assert.match(h.row().error, ADDRESS_AT_NAME);
			assert.equal(h.row().meta.error_i18n, "error.ddns-name-has-address");
		}
	});

	it("refuses a CNAME set with more than one value", async () => {
		const h = harness({ records: [alias()], zone: { CNAME: ["a.example.net", "b.example.net"] } });
		await h.engine.cycle();
		assert.equal(h.row().state, "failed");
		assert.equal(writes(h).length, 0);
	});
});

describe("ddns engine: failure, backoff and recovery", () => {
	it("backs off period x 2^(failures-1), capped at 6 hours, and logs one failed row", async () => {
		const h = harness({ zone: { readError: new DdnsProviderError({ code: "failed", message: "down" }) } });
		const delays = [];
		for (let attempt = 0; attempt < 9; attempt++) {
			await h.engine.cycle({ force: true });
			delays.push(h.row().next_try_on.getTime() - h.clock.now());
			assert.equal(h.row().failures, attempt + 1);
		}
		assert.deepEqual(delays.slice(0, 4), [5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN]);
		assert.equal(delays.at(-1), 6 * HOUR);
		assert.equal(h.row().state, "failed");
		assert.deepEqual(
			h.historyRows.map((r) => r.kind),
			["failed"],
		);
	});

	it("recovers: failures 0, no next try, no error, a recovered row", async () => {
		const h = harness({
			zone: { A: [IP4], readError: new DdnsProviderError({ code: "failed", message: "down" }) },
		});
		await h.engine.cycle();
		assert.equal(h.row().state, "failed");
		h.dns.readError = null;
		h.clock.advance(5 * MIN);
		await h.engine.cycle();
		const row = h.row();
		assert.equal(row.state, "ok");
		assert.equal(row.failures, 0);
		assert.equal(row.next_try_on, null);
		assert.equal(row.error, null);
		assert.equal(row.meta.error_i18n, undefined);
		assert.deepEqual(
			h.historyRows.map((r) => r.kind),
			["failed", "recovered"],
		);
	});

	it("stores a provider message with the token scrubbed", async () => {
		const h = harness({ zone: { readError: new Error(`bad token ${TOKEN} refused`) } });
		await h.engine.cycle();
		assert.doesNotMatch(h.row().error, TOKEN_FOUND);
		assert.match(h.row().error, STARS);
		assert.doesNotMatch(h.historyRows[0].message, TOKEN_FOUND);
	});

	it("fails a record whose provider is unknown or credential cannot be opened", async () => {
		const h = harness({ records: [recordRow({ provider: "gone" })] });
		await h.engine.cycle();
		assert.equal(h.row().state, "failed");
	});

	it("Update now tries at once, ignoring next_try_on, and a failure does not count as a scheduled try", async () => {
		const later = new Date(START + HOUR);
		const h = harness({
			records: [recordRow({ next_try_on: later, failures: 2, state: "failed" })],
			zone: { readError: new DdnsProviderError({ code: "failed", message: "still down" }) },
		});
		const record = await h.engine.updateRecord(1, { now: true });
		assert.equal(record.failures, 2);
		assert.equal(record.next_try_on.getTime(), later.getTime());
		assert.equal(record.error, "still down");
		assert.equal(h.historyRows.length, 0);
		h.dns.readError = null;
		h.dns.A = [IP4];
		const healed = await h.engine.updateRecord(1, { now: true });
		assert.equal(healed.state, "ok");
		assert.equal(healed.failures, 0);
		assert.equal(healed.next_try_on, null);
		assert.deepEqual(
			h.historyRows.map((r) => r.kind),
			["recovered"],
		);
	});

	it("runs Update now through the timer's lock", async () => {
		let ran = 0;
		const h = harness({ zone: { A: [IP4] } });
		const engine = createDdnsEngine({
			store: { getRecord: async () => null },
			publicIp: {},
			providers: {},
			resolveName: async () => null,
			settings: () => ({}),
			runNow: (fn) => {
				ran += 1;
				return Promise.resolve(fn());
			},
		});
		await assert.rejects(engine.updateRecord(5, { now: true }));
		assert.equal(ran, 1);
		assert.ok(h);
	});
});

describe("ddns engine: history", () => {
	it("keeps the newest 50 rows per record: the 51st removes the oldest", async () => {
		const h = harness({
			records: [recordRow({ kind: "alias", target: "t0.example.net" })],
			cooldownMs: MIN,
			zone: { CNAME: ["start.example.net"] },
		});
		for (let step = 0; step <= HISTORY_LIMIT; step++) {
			h.rows.get(1).target = `t${step}.example.net`;
			h.clock.advance(2 * MIN);
			await h.engine.cycle();
		}
		const own = h.historyRows.filter((row) => row.ddns_record_id === 1);
		assert.equal(own.length, HISTORY_LIMIT);
		assert.equal(own[0].new_ip, "t1.example.net");
		assert.equal(own.at(-1).new_ip, `t${HISTORY_LIMIT}.example.net`);
	});
});
