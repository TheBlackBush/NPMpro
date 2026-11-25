import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDdnsEngine, HISTORY_LIMIT, REASSERT_MS, STALE_ANSWER_NOTE } from "../lib/ddns/engine.js";
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
const SUFFIX = /suffix/u;
const STARS = /\*\*\*/u;
const TOKEN_FOUND = /tok-secret/u;
const BADAUTH = /badauth/u;

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

const harness = ({
	records = [recordRow()],
	zone = {},
	resolver = () => null,
	ip = {},
	cooldownMs = 5 * MIN,
	zoneless = false,
	onState,
	log,
} = {}) => {
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
		zoneless,
		read: ({ type, meta }) => {
			calls.push({ op: "read", type, meta });
			if (zoneless) return null;
			if (dns.readError) throw dns.readError;
			const values = dns[key(type)];
			return values ? { values, ttl: 300, meta: { zone_id: "z1", record_id: `r-${type}`, ...dns.meta } } : null;
		},
		write: ({ type, ip: value, existing, meta }) => {
			calls.push({ op: "write", type, ip: value, existing, meta });
			if (dns.writeError && (!dns.writeErrorType || dns.writeErrorType === type)) throw dns.writeError;
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
			if (dns.historyError) throw new Error("history is down");
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
		onState,
		log,
	});
	return {
		engine,
		store,
		providers: { providerById: (id) => (id === "fake" ? provider : null) },
		publicIp: {
			detect: (family) => {
				detects.push(family);
				return Promise.resolve(states[family]);
			},
		},
		rows,
		row: (id = 1) => rows.get(id),
		historyRows,
		detects,
		resolves,
		calls,
		dns,
		clock,
		states,
	};
};

const writes = (h) => h.calls.filter((call) => call.op === "write");

describe("ddns engine: cycle", () => {
	it("does nothing and asks no service when no record is enabled", async () => {
		const h = harness({ records: [recordRow({ enabled: false })] });
		assert.deepEqual(await h.engine.cycle(), { ran: false, changed: 0, failed: 0, stopped: false });
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

	it("stops between records once a pause began; the others stay due", async () => {
		const h = harness({
			records: [recordRow(), recordRow({ id: 2, name: "two.example.com" })],
			zone: { A: [IP4_NEW] },
		});
		let checks = 0;
		// false before the first record, true before the second
		const result = await h.engine.cycle({ stopped: () => checks++ > 0 });
		assert.deepEqual(result, { ran: true, changed: 1, failed: 0, stopped: true });
		assert.equal(h.row(1).state, "ok");
		assert.equal(h.row(2).state, "pending");
		assert.equal(h.row(2).next_try_on, null);
	});

	it("logs one line per cycle that changed or failed something, counts only", async () => {
		const logged = [];
		const h = harness({
			records: [recordRow(), recordRow({ id: 2, name: "two.example.com", provider: "gone" })],
			zone: { A: [IP4_NEW] },
		});
		const engine = createDdnsEngine({
			store: h.store,
			publicIp: h.publicIp,
			providers: h.providers,
			resolveName: () => Promise.resolve(null),
			settings: () => ({ periodMs: 5 * MIN, cooldownMs: 5 * MIN }),
			clock: h.clock,
			log: { error: () => {}, info: (message) => logged.push(message) },
			makeFetch: () => () => Promise.resolve({}),
		});
		await engine.cycle();
		assert.deepEqual(logged, ["Dynamic DNS: 1 record(s) changed, 1 failed"]);
		await engine.cycle({ force: true, ids: [1] });
		assert.equal(logged.length, 1);
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
		const h = harness({ resolver: () => [IP4], records: [recordRow({ last_ipv4: IP4_NEW })] });
		await h.engine.cycle();
		assert.equal(h.calls.length, 0);
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().failures, 0);
		assert.ok(h.row().last_checked_on);
		assert.equal(h.row().last_ipv4, IP4);
		assert.equal(h.historyRows.length, 0);
		assert.deepEqual(h.resolves[0].servers, ["9.9.9.9"]);
	});

	it("reads through the provider while the record was never seen there, so a wildcard answer cannot hide it", async () => {
		const h = harness({ resolver: () => [IP4] });
		await h.engine.cycle();
		assert.equal(h.resolves.length, 0);
		assert.deepEqual(
			h.calls.map((call) => call.op),
			["read", "read", "write"],
		);
		assert.equal(writes(h)[0].existing, null);
		assert.equal(h.row().last_ipv4, IP4);
		// a one-type record with a stored provider record id is known too
		const known = harness({ resolver: () => [IP4], records: [recordRow({ meta: { record_id: "r-A" } })] });
		await known.engine.cycle();
		assert.equal(known.calls.length, 0);
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
		assert.equal(h.row().meta.proxied_a, true);
		assert.equal(writes(h).length, 0);
	});

	it("reads through the provider when the resolver differs or fails, and stores proxied as read", async () => {
		const h = harness({ resolver: () => null, zone: { A: [IP4], meta: { proxied: false } } });
		await h.engine.cycle();
		assert.equal(h.calls[0].op, "read");
		assert.equal(h.row().meta.proxied_a, false);
		assert.equal(h.row().meta.proxied, undefined);
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
		assert.equal(h.row().meta.proxied_a, true);
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
			records: [recordRow({ ip_version: "ipv6", ipv6_suffix: "::1", last_ipv6: "2a00:1450:4001:80b::1" })],
			resolver: () => ["2A00:1450:4001:080B:0:0:0:1"],
		});
		await h.engine.cycle();
		assert.equal(h.calls.length, 0);
		assert.equal(h.row().state, "ok");
	});

	it("keeps the proxied flag of A and AAAA apart, and a proxied AAAA never hides an A from DNS", async () => {
		const h = harness({
			records: [
				recordRow({
					ip_version: "both",
					last_ipv4: IP4,
					last_ipv6: IP6,
					meta: { proxied_a: false, proxied_aaaa: true },
				}),
			],
			resolver: (_name, type) => (type === "A" ? [IP4] : null),
			zone: { A: [IP4], AAAA: [IP6], meta: { proxied: true } },
		});
		await h.engine.cycle();
		assert.deepEqual(
			h.resolves.map((call) => call.type),
			["A"],
		);
		assert.deepEqual(
			h.calls.map((call) => [call.op, call.type]),
			[["read", "AAAA"]],
		);
		assert.equal(h.row().meta.proxied_a, false);
		assert.equal(h.row().meta.proxied_aaaa, true);
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

	it("keeps the meta a provider error carries, and hands it to the next read (a pending refresh)", async () => {
		const stale = Object.assign(new DdnsProviderError({ code: "failed", message: "refresh failed" }), {
			meta: { record_id: "r-A", refresh_pending: true },
		});
		const h = harness({ zone: { A: [IP4_NEW], writeError: stale } });
		await h.engine.cycle();
		assert.equal(h.row().state, "failed");
		assert.equal(h.row().meta.refresh_pending, true);
		// the zone shows the pending value: the next read gets the flag, clears it and the record is ok
		h.dns.writeError = null;
		h.dns.A = [IP4];
		h.dns.meta = { refresh_pending: false };
		h.clock.advance(5 * MIN);
		await h.engine.cycle();
		assert.equal(h.calls.filter((call) => call.op === "read").at(-1).meta.refresh_pending, true);
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().meta.refresh_pending, false);
		// only the failed write of the first cycle
		assert.equal(writes(h).length, 1);
	});

	it("takes meta only from a provider error", async () => {
		const plain = Object.assign(new Error("boom"), { meta: { refresh_pending: true } });
		const h = harness({ zone: { A: [IP4_NEW], writeError: plain } });
		await h.engine.cycle();
		assert.equal(h.row().state, "failed");
		assert.equal(h.row().meta.refresh_pending, undefined);
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

	it("runs Update now through the injected lock and returns the record", async () => {
		const h = harness({ zone: { A: [IP4] } });
		let held = 0;
		const engine = createDdnsEngine({
			store: h.store,
			publicIp: { detect: () => Promise.resolve(h.states[4]) },
			providers: h.providers,
			resolveName: () => Promise.resolve(null),
			settings: () => ({ periodMs: 5 * MIN, cooldownMs: 5 * MIN }),
			clock: h.clock,
			makeFetch: () => () => Promise.resolve({}),
			runNow: (fn) => {
				held += 1;
				return Promise.resolve(fn());
			},
		});
		const record = await engine.updateRecord(1, { now: true });
		assert.equal(held, 1);
		assert.equal(record.state, "ok");
		await assert.rejects(engine.updateRecord(99, { now: true }));
		assert.equal(held, 2);
	});
});

describe("ddns engine: edge cases", () => {
	it("fails a record with an invalid stored suffix, in the cycle and in Update now", async () => {
		const h = harness({ records: [recordRow({ ip_version: "ipv6", ipv6_suffix: "1::1" })] });
		await h.engine.cycle();
		assert.equal(h.row().state, "failed");
		assert.match(h.row().error, SUFFIX);
		assert.equal(h.row().meta.error_i18n, "error.ddns-bad-suffix");
		assert.equal(h.calls.length, 0);
		const record = await h.engine.updateRecord(1, { now: true });
		assert.equal(record.state, "failed");
	});

	it("recreates a record deleted at the provider on each due cycle, inside the cooldown too", async () => {
		const h = harness({ records: [recordRow({ last_changed_on: new Date(START - MIN), state: "ok" })] });
		await h.engine.cycle();
		assert.equal(writes(h).length, 1);
		assert.equal(h.historyRows.at(-1).kind, "created");
		delete h.dns.A;
		h.clock.advance(MIN);
		await h.engine.cycle();
		assert.equal(writes(h).length, 2);
		assert.deepEqual(
			h.historyRows.map((r) => r.kind),
			["created", "created"],
		);
	});

	it("skips a record disabled since the cycle began, and refuses Update now on it", async () => {
		const h = harness({ zone: { A: [IP4_NEW] } });
		const enabled = h.store.enabledRecords;
		h.store.enabledRecords = async () => {
			const list = await enabled();
			h.rows.get(1).enabled = false;
			return list;
		};
		await h.engine.cycle();
		assert.equal(h.calls.length, 0);
		await assert.rejects(h.engine.updateRecord(1, { now: true }), (err) => {
			assert.equal(err.message_i18n, "error.ddns-record-disabled");
			return true;
		});
		assert.equal(h.calls.length, 0);
	});

	it("answers Update now with the address error when no public address is known", async () => {
		const h = harness({
			ip: { 4: { address: null, error: "no service answered", error_i18n: "error.ddns-ip-failed" } },
		});
		await assert.rejects(h.engine.updateRecord(1, { now: true }), (err) => {
			assert.equal(err.message_i18n, "error.ddns-ip-failed");
			assert.equal(err.message, "no service answered");
			return true;
		});
		assert.equal(h.calls.length, 0);
	});

	it("saves the record before the history, and a history error never loses the patch", async () => {
		const logged = [];
		const h = harness({ zone: { A: [IP4_NEW] } });
		h.dns.historyError = true;
		const engine = createDdnsEngine({
			store: h.store,
			publicIp: h.publicIp,
			providers: h.providers,
			resolveName: () => Promise.resolve(null),
			settings: () => ({ periodMs: 5 * MIN, cooldownMs: 5 * MIN }),
			clock: h.clock,
			log: { error: (message) => logged.push(message) },
			makeFetch: () => () => Promise.resolve({}),
		});
		await engine.cycle();
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().last_ipv4, IP4);
		assert.ok(h.row().last_changed_on);
		assert.equal(logged.length, 1);
		assert.equal(h.historyRows.length, 0);
	});

	it("keeps a failed record's error key while it waits out the cooldown", async () => {
		const h = harness({
			records: [
				recordRow({
					state: "failed",
					error: "The record has 2 addresses",
					last_changed_on: new Date(START - MIN),
					meta: { error_i18n: "error.ddns-multi-value", error_values: { count: 2 } },
				}),
			],
			zone: { A: [IP4_NEW] },
		});
		await h.engine.cycle();
		assert.equal(writes(h).length, 0);
		assert.equal(h.row().state, "failed");
		assert.equal(h.row().meta.error_i18n, "error.ddns-multi-value");
		assert.deepEqual(h.row().meta.error_values, { count: 2 });
	});

	it("saves the first family's change when the second family fails", async () => {
		const h = harness({
			records: [recordRow({ ip_version: "both" })],
			zone: { A: [IP4_NEW], AAAA: ["2a00:1450:4001:80b::9"] },
		});
		h.dns.writeError = new DdnsProviderError({ code: "failed", message: "v6 refused" });
		h.dns.writeErrorType = "AAAA";
		await h.engine.cycle();
		const row = h.row();
		assert.equal(row.state, "failed");
		assert.equal(row.last_ipv4, IP4);
		assert.ok(row.last_changed_on);
		assert.deepEqual(
			h.historyRows.map((r) => [r.kind, r.ip_version]),
			[
				["changed", "ipv4"],
				["failed", undefined],
			],
		);
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

describe("ddns engine: zoneless provider", () => {
	const record = (over = {}) => recordRow({ name: "home.duckdns.org", zone: "duckdns.org", ...over });

	it("writes when the DNS answer differs, never reads the provider and never creates", async () => {
		const h = harness({ zoneless: true, records: [record()], resolver: () => [IP4_NEW] });
		await h.engine.cycle();
		assert.deepEqual(
			h.calls.map((call) => call.op),
			["write"],
		);
		assert.equal(writes(h)[0].ip, IP4);
		assert.equal(writes(h)[0].existing, null);
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().last_ipv4, IP4);
		assert.deepEqual(
			h.historyRows.map((row) => [row.kind, row.old_ip, row.new_ip]),
			[["changed", null, IP4]],
		);
		assert.equal(h.resolves.length, 1);
	});

	it("writes when the name does not resolve yet, and keeps the old address in the history", async () => {
		const h = harness({
			zoneless: true,
			records: [record({ last_ipv4: IP4_NEW })],
			resolver: () => null,
		});
		await h.engine.cycle();
		assert.equal(writes(h).length, 1);
		assert.equal(h.historyRows[0].old_ip, IP4_NEW);
	});

	it("does not write again within a day when the address is the one last written, and notes the DNS answer", async () => {
		const lastWrite = new Date(START - 2 * HOUR);
		const h = harness({
			zoneless: true,
			records: [record({ last_ipv4: IP4, last_changed_on: lastWrite })],
			resolver: () => [IP4_NEW],
		});
		await h.engine.cycle();
		assert.equal(writes(h).length, 0);
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().meta.note_i18n, STALE_ANSWER_NOTE);
		assert.equal(h.row().last_changed_on.getTime(), lastWrite.getTime());
		assert.equal(h.historyRows.length, 0);
		// still a day after the write: one cycle later, no write either
		h.clock.advance(21 * HOUR);
		await h.engine.cycle({ force: true });
		assert.equal(writes(h).length, 0);
	});

	it("re-asserts the address a day after the last write while the DNS answer differs, without a history row", async () => {
		const lastWrite = new Date(START - REASSERT_MS);
		const h = harness({
			zoneless: true,
			records: [record({ last_ipv4: IP4, last_changed_on: lastWrite, meta: { note_i18n: STALE_ANSWER_NOTE } })],
			resolver: () => null,
		});
		await h.engine.cycle();
		assert.equal(writes(h).length, 1);
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().meta.note_i18n, undefined);
		assert.equal(h.historyRows.length, 0);
		assert.equal(h.row().last_changed_on.getTime(), START);
	});

	it("writes at once when the wanted address differs from the one last written, and drops the note", async () => {
		const h = harness({
			zoneless: true,
			records: [
				record({
					last_ipv4: IP4_NEW,
					last_changed_on: new Date(START - HOUR),
					meta: { note_i18n: STALE_ANSWER_NOTE },
				}),
			],
			resolver: () => [IP4_NEW],
		});
		await h.engine.cycle();
		assert.equal(writes(h).length, 1);
		assert.equal(writes(h)[0].ip, IP4);
		assert.equal(h.row().meta.note_i18n, undefined);
		assert.deepEqual(
			h.historyRows.map((row) => [row.kind, row.old_ip, row.new_ip]),
			[["changed", IP4_NEW, IP4]],
		);
	});

	it("drops the note once the DNS answer is the address", async () => {
		const h = harness({
			zoneless: true,
			records: [
				record({
					last_ipv4: IP4,
					last_changed_on: new Date(START - HOUR),
					meta: { note_i18n: STALE_ANSWER_NOTE },
				}),
			],
			resolver: () => [IP4],
		});
		await h.engine.cycle();
		assert.equal(writes(h).length, 0);
		assert.equal(h.row().meta.note_i18n, undefined);
	});

	it("Update now writes the address last written although it was written within a day", async () => {
		const h = harness({
			zoneless: true,
			records: [record({ last_ipv4: IP4, last_changed_on: new Date(START - HOUR) })],
			resolver: () => [IP4_NEW],
		});
		await h.engine.updateRecord(1);
		assert.equal(writes(h).length, 1);
		assert.equal(h.row().meta.note_i18n, undefined);
	});

	it("does not write when the DNS answer is already the address, even for a record never written", async () => {
		const h = harness({ zoneless: true, records: [record()], resolver: () => [IP4] });
		await h.engine.cycle();
		assert.equal(h.calls.length, 0);
		assert.equal(h.row().state, "ok");
		assert.equal(h.historyRows.length, 0);
	});

	it("writes A and AAAA of a both record separately, with no provider read and no other-type check", async () => {
		const h = harness({ zoneless: true, records: [record({ ip_version: "both" })], resolver: () => null });
		await h.engine.cycle();
		assert.deepEqual(
			h.calls.map((call) => [call.op, call.type]),
			[
				["write", "A"],
				["write", "AAAA"],
			],
		);
	});

	it("holds the cooldown after a write, and Update now answers the cooldown error", async () => {
		const h = harness({ zoneless: true, records: [record()], resolver: () => [IP4_NEW] });
		await h.engine.cycle();
		h.clock.advance(MIN);
		await h.engine.cycle({ force: true });
		assert.equal(writes(h).length, 1);
		assert.equal(h.row().state, "ok");
		await assert.rejects(h.engine.updateRecord(1), (err) => err.message_i18n === "error.ddns-cooldown");
		h.clock.advance(10 * MIN);
		// a new public address after the cooldown is written at once
		h.states[4] = { address: "81.2.69.162", error: null, error_i18n: null };
		await h.engine.cycle({ force: true });
		assert.equal(writes(h).length, 2);
	});

	it("a failed write is a failure with the scrubbed message and the next try", async () => {
		const h = harness({ zoneless: true, records: [record()], resolver: () => null });
		h.dns.writeError = new DdnsProviderError({ code: "failed", message: `bad ${TOKEN}`, secrets: [TOKEN] });
		await h.engine.cycle();
		assert.equal(h.row().state, "failed");
		assert.match(h.row().error, STARS);
		assert.doesNotMatch(h.row().error, TOKEN_FOUND);
		assert.equal(h.row().failures, 1);
	});
});

describe("ddns engine: a provider that says to stop", () => {
	const refused = () => new DdnsProviderError({ code: "forbidden", message: "badauth", retry: false, stop: true });

	it("leaves the record failed with no next try, and no cycle tries it again, forced or not", async () => {
		const h = harness({ records: [recordRow()], zone: {} });
		h.dns.writeError = refused();
		await h.engine.cycle();
		assert.equal(h.row().state, "failed");
		assert.equal(h.row().meta.stopped, true);
		assert.equal(h.row().next_try_on, null);
		assert.match(h.row().error, BADAUTH);
		const tried = h.calls.length;
		h.clock.advance(7 * HOUR);
		await h.engine.cycle();
		await h.engine.cycle({ force: true });
		await h.engine.cycle({ force: true, ids: [1] });
		assert.equal(h.calls.length, tried);
	});

	it("Update now runs a stopped record, and a success ends the stop", async () => {
		const h = harness({ records: [recordRow()], zone: {} });
		h.dns.writeError = refused();
		await h.engine.cycle();
		h.dns.writeError = null;
		h.clock.advance(10 * MIN);
		await h.engine.updateRecord(1);
		assert.equal(h.row().state, "ok");
		assert.equal(h.row().meta.stopped, undefined);
		h.dns.A = null;
		h.clock.advance(10 * MIN);
		await h.engine.cycle();
		assert.equal(writes(h).length, 3);
	});

	it("a refusal without a stop keeps its retry floor and the next try", async () => {
		const h = harness({ records: [recordRow()], zone: {} });
		h.dns.writeError = new DdnsProviderError({ code: "forbidden", message: "no", retryAfterMs: 6 * HOUR });
		await h.engine.cycle();
		assert.equal(h.row().meta.stopped, undefined);
		assert.equal(h.row().next_try_on.getTime(), START + 6 * HOUR);
	});
});

describe("ddns engine: state callback", () => {
	it("is called after each save with the record and the patch", async () => {
		const seen = [];
		const h = harness({
			zone: { readError: new DdnsProviderError({ code: "failed", message: "down" }) },
			onState: (record, patch) => {
				seen.push({ id: record.id, name: record.name, state: patch.state, saved: h.row().state });
			},
		});
		await h.engine.cycle();
		h.dns.readError = null;
		h.clock.advance(5 * MIN);
		await h.engine.cycle();
		assert.deepEqual(
			seen.map((one) => [one.id, one.name, one.state, one.saved]),
			[
				[1, "home.example.com", "failed", "failed"],
				[1, "home.example.com", "ok", "ok"],
			],
		);
	});

	it("a callback that throws changes nothing in the run and is logged", async () => {
		const errors = [];
		const h = harness({
			zone: { A: [IP4_NEW] },
			log: { error: (line) => errors.push(line), info: () => {} },
			onState: () => {
				throw new Error("layer broke");
			},
		});
		const result = await h.engine.cycle();
		assert.equal(result.failed, 0);
		assert.equal(result.changed, 1);
		assert.equal(h.row().state, "ok");
		assert.equal(errors.length, 1);
		assert.match(errors[0], /layer broke/u);
	});
});
