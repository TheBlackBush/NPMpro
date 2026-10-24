import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Ajv from "ajv/dist/2020.js";
import knexFactory from "knex";
import { createMonitoring, parseTrafficQuery } from "../internal/monitoring.js";
import { createCrowdsecService } from "../lib/crowdsec/service.js";
import errs from "../lib/error.js";
import { createGeoipService } from "../lib/geoip/service.js";
import { createCounter } from "../lib/traffic/counter.js";
import { createHostResolver } from "../lib/traffic/host-resolver.js";
import { createHostMapper, createStateMeta, createTrafficHooks, createTrafficService } from "../lib/traffic/service.js";
import { createStore } from "../lib/traffic/store.js";
import { loadVisitorKey } from "../lib/traffic/visitor-hash.js";
import { up as upMonitoring } from "../migrations/20261024120000_monitoring.js";
import { up as upVisitors } from "../migrations/20261024200000_monitoring_visitors.js";

const MINUTE = 60000;
const KEY = "bouncer-key";
const DB_LOCKED = /database is locked/u;
const HASH = /^[0-9a-f]{32}$/u;
const NOT_FOUND = /not found/u;
const NGINX_FAILED = /nginx -t failed/u;
const REFUSED = /ECONNREFUSED/u;
const PERMISSION = /Permission/u;
const silent = { error: () => {}, warn: () => {}, info: () => {} };

const line = (host, ip = "203.0.113.7", status = 200, bytes = 100) =>
	`[24/Oct/2026:10:15:30 +0200] ${host} ${ip} 0.012 "GET / HTTP/2.0" ${status} ${bytes} "-" "curl/8" "-" "text/html" TLSv1.3 TLS_AES_128_GCM_SHA256 X25519 -`;

const fakeTimers = () => {
	const intervals = new Set();
	const timeouts = new Set();
	return {
		setInterval: (fn, ms) => {
			const t = { fn, ms };
			intervals.add(t);
			return t;
		},
		clearInterval: (t) => intervals.delete(t),
		setTimeout: (fn, ms) => {
			const t = { fn, ms };
			timeouts.add(t);
			return t;
		},
		clearTimeout: (t) => timeouts.delete(t),
		count: () => intervals.size + timeouts.size,
		has: (ms) => [...intervals].some((t) => t.ms === ms),
		fire: (ms) => {
			for (const t of [...intervals, ...timeouts]) if (t.ms === ms) t.fn();
		},
	};
};

const fakeStore = () => {
	const calls = [];
	return {
		calls,
		failing: false,
		flushed: [],
		// a promise that holds the next flush until it resolves
		gate: null,
		async flush(batch) {
			calls.push("flush");
			const copy = structuredClone(batch);
			if (this.gate) await this.gate;
			calls.push("flushed");
			if (this.failing) throw new Error("database is locked");
			this.flushed.push(copy);
		},
		deleteVisitors() {
			calls.push("deleteVisitors");
			return Promise.resolve();
		},
		dayHashes: [],
		visitorDayHashes(args) {
			calls.push(["visitorDayHashes", args]);
			return Promise.resolve(this.dayHashes);
		},
		rollUpAndPrune(args) {
			calls.push(["rollUp", args]);
			return Promise.resolve();
		},
		deleteIps() {
			calls.push("deleteIps");
			return Promise.resolve();
		},
	};
};

const fakeReader = (results) => {
	const states = [];
	return {
		states,
		create: (state) => {
			states.push(state);
			return {
				read: () =>
					Promise.resolve(
						results.shift() ?? { lines: [], state: { inode: 1, offset: 0 }, missing: false, dropped: 0 },
					),
			};
		},
	};
};

const geo = {
	available: () => ({ country: true, asn: true }),
	lookup: () => ({ country: "DE", asn: 3320, asnName: "DTAG" }),
};

const setup = ({
	results = [],
	config = {},
	hosts = ["example.com"],
	state = null,
	configFails = 0,
	adminPort = "81",
	visitorKey = { key: Buffer.alloc(32, 7), created: false },
	store: givenStore = null,
} = {}) => {
	let hostList = hosts;
	let failures = configFails;
	let hostLoads = 0;
	let time = Date.UTC(2026, 9, 24, 8, 16, 0);
	const store = givenStore ?? fakeStore();
	const reader = fakeReader(results);
	const timers = fakeTimers();
	const saved = [];
	const errors = [];
	let keyLoads = 0;
	const values = { traffic_enabled: true, retention_days: 30, show_ips: false, unique_visitors: false, ...config };
	const service = createTrafficService({
		store,
		geo,
		getConfig: () => {
			if (failures > 0) {
				failures--;
				return Promise.reject(new Error("settings table missing"));
			}
			return Promise.resolve({ values });
		},
		loadState: () => Promise.resolve(state),
		saveState: (s) => {
			saved.push(s);
			return Promise.resolve();
		},
		loadHosts: () => {
			hostLoads++;
			if (hostList instanceof Error) return Promise.reject(hostList);
			// plain names become one proxy host each
			return Promise.resolve(
				hostList.map((h, i) => (typeof h === "string" ? { id: i + 1, type: "proxy", domain_names: [h] } : h)),
			);
		},
		loadVisitorKey: () => {
			keyLoads++;
			return visitorKey instanceof Error ? Promise.reject(visitorKey) : Promise.resolve(visitorKey);
		},
		createReader: reader.create,
		now: () => time,
		timers,
		adminPort,
		log: { ...silent, error: (message) => errors.push(message) },
	});
	return {
		service,
		store,
		reader,
		timers,
		saved,
		values,
		errors,
		keyLoads: () => keyLoads,
		hostLoads: () => hostLoads,
		setHosts: (next) => {
			hostList = next;
		},
		advance: (ms) => {
			time += ms;
		},
	};
};

const read = (lines, offset = 100) => ({ lines, state: { inode: 1, offset }, missing: false, dropped: 0 });

describe("traffic service", () => {
	it("flush passes the counter output to the store and saves the reader position", async () => {
		const t = setup({ results: [read([line("example.com"), line("example.com", "203.0.113.8", 404)])] });
		await t.service.start();
		await t.service.read();
		await t.service.flush();
		assert.equal(t.store.flushed.length, 1);
		const batch = t.store.flushed[0];
		assert.deepEqual(
			batch.minutes
				.map((r) => [r.host, r.status_class, r.requests, r.bytes])
				.sort((a, b) => String(a).localeCompare(String(b))),
			[
				["example.com", "2xx", 1, 100],
				["example.com", "4xx", 1, 100],
			],
		);
		assert.deepEqual(batch.countries, [
			{
				bucket: Math.floor(Date.UTC(2026, 9, 24, 8, 15, 30) / 3600000),
				host: "example.com",
				country: "DE",
				requests: 2,
			},
		]);
		assert.equal(batch.asns[0].asn, 3320);
		assert.deepEqual(batch.ips, []);
		assert.deepEqual(t.saved, [{ inode: 1, offset: 100 }]);
	});

	it("runs on its timers: read every 5 s, flush every minute, roll-up hourly; stop clears them", async () => {
		const t = setup({ results: [read([line("example.com")])] });
		await t.service.start();
		assert.ok(t.timers.has(5000) && t.timers.has(60000) && t.timers.has(3600000));
		t.timers.fire(5000);
		await new Promise((r) => setImmediate(r));
		t.timers.fire(60000);
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));
		assert.equal(t.store.flushed.length, 1);
		assert.ok(t.store.calls.some((c) => Array.isArray(c) && c[0] === "rollUp" && c[1].retentionDays === 30));
		await t.service.stop();
		assert.equal(t.timers.count(), 0);
	});

	it("keeps counts while the store fails, up to 10 minutes, then drops the oldest and counts them", async () => {
		const t = setup({ results: [read([line("example.com")], 10), read([line("example.com")], 20)] });
		await t.service.start();
		t.store.failing = true;
		await t.service.read();
		await t.service.flush(); // batch 1 at minute 0
		assert.match(t.service.status().error, DB_LOCKED);
		t.advance(5 * MINUTE);
		await t.service.read();
		await t.service.flush(); // batch 2 at minute 5
		t.advance(5 * MINUTE);
		await t.service.flush(); // minute 10: batch 1 is 10 minutes old
		assert.equal(t.service.status().dropped_requests, 1);
		assert.deepEqual(t.saved, [], "the position is not saved while the counts are not stored");
		t.store.failing = false;
		t.advance(MINUTE);
		await t.service.flush();
		assert.equal(t.store.flushed.length, 1);
		assert.equal(
			t.store.flushed[0].minutes.reduce((n, r) => n + r.requests, 0),
			1,
		);
		assert.equal(t.service.status().error, null);
		assert.deepEqual(t.saved, [{ inode: 1, offset: 20 }]);
	});

	it("a missing access log sets the status error and retries after a minute", async () => {
		const t = setup({
			results: [{ lines: [], state: null, missing: true }, read([line("example.com")])],
		});
		await t.service.start();
		await t.service.read();
		assert.match(t.service.status().error, NOT_FOUND);
		await t.service.read(); // too early, not read
		assert.match(t.service.status().error, NOT_FOUND);
		t.advance(MINUTE);
		await t.service.read();
		assert.equal(t.service.status().error, null);
		assert.ok(t.service.status().last_read);
	});

	it("maps unmanaged hosts to _other and refreshes the host list on each flush", async () => {
		const hosts = ["example.com", "*.wild.test"];
		const t = setup({
			hosts,
			results: [
				read([line("example.com"), line("random.invalid"), line("10.0.0.1"), line("a.wild.test")]),
				read([line("new.test")]),
			],
		});
		await t.service.start();
		await t.service.read();
		hosts.push("new.test");
		await t.service.flush();
		const keys = new Set(t.store.flushed[0].minutes.map((r) => r.host));
		assert.deepEqual(keys, new Set(["*.wild.test", "_other", "example.com"]));
		await t.service.read();
		await t.service.flush();
		assert.deepEqual(
			t.store.flushed[1].minutes.map((r) => r.host),
			["new.test"],
		);
	});

	it("does not count the health check and admin UI requests, and does not report them as skipped", async () => {
		const health = line("127.0.0.1:81").replace('"curl/8"', '"NPMpro/healthcheck"');
		const t = setup({
			results: [
				read([
					health,
					line("192.168.1.10:81"),
					line("[::1]:81"),
					line("example.com"),
					line("example.com:8443"),
					line("10.0.0.5:181"),
				]),
			],
		});
		await t.service.start();
		await t.service.read();
		await t.service.flush();
		const total = t.store.flushed[0].minutes.reduce((n, r) => n + r.requests, 0);
		assert.equal(total, 3);
		assert.equal(t.service.status().skipped_lines, 0);
	});

	it("still counts host ports when the admin port is 443", async () => {
		const t = setup({ results: [read([line("example.com:443"), line("example.com")])], adminPort: "443" });
		await t.service.start();
		await t.service.read();
		await t.service.flush();
		assert.equal(
			t.store.flushed[0].minutes.reduce((n, r) => n + r.requests, 0),
			2,
		);
	});

	it("counts unparsable lines as skipped", async () => {
		const t = setup({ results: [{ ...read(["garbage", "", line("example.com")]), dropped: 1 }] });
		await t.service.start();
		await t.service.read();
		assert.equal(t.service.status().skipped_lines, 2);
	});

	it("deletes stored IPs at start when show_ips is off, not when it is on", async () => {
		const off = setup({ config: { show_ips: false } });
		await off.service.start();
		assert.ok(off.store.calls.includes("deleteIps"));
		const on = setup({ config: { show_ips: true } });
		await on.service.start();
		assert.ok(!on.store.calls.includes("deleteIps"));
	});

	it("never records IPs while show_ips is off", async () => {
		const seen = [];
		const t = setup({ results: [read([line("example.com")])] });
		const lookup = geo.lookup;
		geo.lookup = (ip) => {
			seen.push(ip);
			return lookup(ip);
		};
		try {
			await t.service.start();
			await t.service.read();
			await t.service.flush();
		} finally {
			geo.lookup = lookup;
		}
		assert.deepEqual(t.store.flushed[0].ips, []);
		assert.deepEqual(seen, ["203.0.113.7"], "the IP is only used for the GeoIP lookup");
	});

	it("showIpsOff stops recording at once, drops undrained IPs and deletes again", async () => {
		const t = setup({
			config: { show_ips: true },
			results: [read([line("example.com")]), read([line("example.com")])],
		});
		await t.service.start();
		await t.service.read();
		await t.service.showIpsOff();
		assert.equal(t.store.calls.at(-1), "deleteIps");
		// the stored setting still says true until the settings save finishes: it must not switch IPs back on
		await t.service.read();
		await t.service.flush();
		assert.deepEqual(t.store.flushed[0].ips, []);
		assert.equal(
			t.store.flushed[0].minutes.reduce((n, r) => n + r.requests, 0),
			2,
		);
	});

	it("showIpsOn clears the pin, so IPs switched back on are recorded at the next read", async () => {
		const t = setup({
			config: { show_ips: true },
			results: [read([line("example.com")]), read([line("example.com", "203.0.113.9")])],
		});
		await t.service.start();
		await t.service.showIpsOff();
		await t.service.read();
		await t.service.flush();
		assert.deepEqual(t.store.flushed[0].ips, [], "pinned off within 5 minutes");
		createTrafficHooks({ applyAccessLog: () => Promise.resolve(), traffic: t.service }).onShowIpsOn();
		await t.service.read();
		await t.service.flush();
		assert.deepEqual(
			t.store.flushed[1].ips.map((r) => r.ip),
			["203.0.113.9"],
		);
	});

	it("records IPs when show_ips is on", async () => {
		const t = setup({ config: { show_ips: true }, results: [read([line("example.com")])] });
		await t.service.start();
		await t.service.read();
		await t.service.flush();
		assert.equal(t.store.flushed[0].ips[0].ip, "203.0.113.7");
	});

	it("resumes from the saved reader position", async () => {
		const t = setup({ state: { inode: 7, offset: 4096 } });
		await t.service.start();
		await t.service.read();
		assert.deepEqual(t.reader.states, [{ inode: 7, offset: 4096 }]);
	});

	it("does not read while disabled; the hook switches the access log and the reader", async () => {
		const t = setup({ config: { traffic_enabled: false }, results: [read([line("example.com")])] });
		await t.service.start();
		assert.ok(!t.timers.has(5000));
		const applied = [];
		const hooks = createTrafficHooks({
			applyAccessLog: async (enabled, after) => {
				applied.push(enabled);
				await after();
			},
			traffic: t.service,
		});
		await hooks.onTrafficEnabledChange(true);
		assert.deepEqual(applied, [true]);
		assert.ok(t.timers.has(5000));
		assert.equal(t.service.status().enabled, true);
		await hooks.onTrafficEnabledChange(false);
		assert.ok(!t.timers.has(5000));
		assert.equal(t.service.status().enabled, false);
	});

	it("does not start the reader when switching the access log fails", async () => {
		const t = setup({ config: { traffic_enabled: false } });
		await t.service.start();
		const hooks = createTrafficHooks({
			applyAccessLog: () => Promise.reject(new Error("nginx -t failed")),
			traffic: t.service,
		});
		await assert.rejects(hooks.onTrafficEnabledChange(true), NGINX_FAILED);
		assert.equal(t.service.status().enabled, false);
	});

	it("does not delete IPs when the settings cannot be read at start, but after they are read as off", async () => {
		const t = setup({ configFails: 1, results: [read([line("example.com")])] });
		await t.service.start();
		assert.ok(!t.store.calls.includes("deleteIps"));
		assert.equal(t.service.status().enabled, false);
		await t.service.flush();
		assert.ok(t.store.calls.includes("deleteIps"));
		assert.equal(t.service.status().enabled, true, "the enabled state from the settings is applied late");
		assert.ok(t.timers.has(5000));
	});

	it("does not delete IPs after a late settings read that says show_ips is on", async () => {
		const t = setup({ configFails: 1, config: { show_ips: true } });
		await t.service.start();
		await t.service.flush();
		assert.ok(!t.store.calls.includes("deleteIps"));
	});

	it("yields while parsing many lines and a flush waits for the running read", async () => {
		const lines = Array.from({ length: 12001 }, () => line("example.com"));
		const t = setup({ results: [read(lines, 999)] });
		await t.service.start();
		const reading = t.service.read();
		const flushed = t.service.flush();
		await Promise.all([reading, flushed]);
		assert.equal(
			t.store.flushed[0].minutes.reduce((n, r) => n + r.requests, 0),
			12001,
		);
		assert.deepEqual(t.saved, [{ inode: 1, offset: 999 }]);
	});

	it("skips the host list refresh while traffic statistics are off", async () => {
		const t = setup({ config: { traffic_enabled: false } });
		await t.service.start();
		await t.service.flush();
		await t.service.flush();
		assert.equal(t.hostLoads(), 0);
		await t.service.setEnabled(true);
		assert.equal(t.hostLoads(), 1);
		await t.service.flush();
		assert.equal(t.hostLoads(), 2);
	});

	it("maps hosts by exact name, wildcard and dot prefix", () => {
		const map = createHostMapper(["Example.com", "*.a.test", ".b.test"]);
		assert.equal(map("example.com"), "example.com");
		assert.equal(map("x.a.test"), "*.a.test");
		assert.equal(map("a.test"), "_other");
		assert.equal(map("b.test"), ".b.test");
		assert.equal(map("y.b.test"), ".b.test");
		assert.equal(map(""), "_other");
		assert.equal(map("evil-a.test"), "_other");
	});
});

describe("traffic service: unique visitors", () => {
	const on = { unique_visitors: true };
	const tick = () => new Promise((r) => setImmediate(r));

	it("two lines from the same IP on one host give one visitor row, never the raw IP", async () => {
		const t = setup({
			config: on,
			results: [read([line("example.com"), line("example.com"), line("example.com", "::ffff:203.0.113.7")])],
		});
		await t.service.start();
		await t.service.read();
		await t.service.flush();
		const { visitors } = t.store.flushed[0];
		assert.equal(visitors.length, 1, "the IPv4-mapped form is the same visitor");
		assert.equal(visitors[0].host, "example.com");
		assert.equal(visitors[0].day, Math.floor(Date.UTC(2026, 9, 24, 8, 15, 30) / 86400000));
		assert.match(visitors[0].hash, HASH);
		assert.ok(!JSON.stringify(t.store.flushed).includes("203.0.113"), "no raw IP in any flushed row");
		assert.equal(t.keyLoads(), 1);
	});

	it("counts no visitors while the switch is off", async () => {
		const off = setup({ results: [read([line("example.com")])] });
		await off.service.start();
		await off.service.read();
		await off.service.flush();
		assert.deepEqual(off.store.flushed[0].visitors, []);
	});

	it("uniqueVisitorsOff during a running flush deletes after it and writes no visitor rows afterwards", async () => {
		const t = setup({
			config: on,
			results: [read([line("example.com")]), read([line("example.com", "198.51.100.1")])],
		});
		await t.service.start();
		await t.service.read();
		let release;
		t.store.gate = new Promise((r) => {
			release = r;
		});
		const flushing = t.service.flush();
		await tick();
		const off = createTrafficHooks({
			applyAccessLog: () => Promise.resolve(),
			traffic: t.service,
		}).onUniqueVisitorsOff();
		await t.service.read();
		release();
		t.store.gate = null;
		await Promise.all([flushing, off]);
		const startCalls = t.store.calls.indexOf("flush");
		assert.deepEqual(
			t.store.calls.slice(startCalls).filter((c) => typeof c === "string"),
			["flush", "flushed", "deleteVisitors"],
		);
		// the stored setting still says true until the save finishes: it must not switch counting back on
		await t.service.flush();
		await t.service.read();
		await t.service.flush();
		for (const batch of t.store.flushed.slice(1)) assert.deepEqual(batch.visitors, []);
		assert.equal(
			t.store.flushed.reduce((n, b) => n + b.minutes.reduce((m, r) => m + r.requests, 0), 0),
			2,
		);
	});

	it("uniqueVisitorsOff clears visitor rows kept in pending batches", async () => {
		const t = setup({ config: on, results: [read([line("example.com")])] });
		await t.service.start();
		t.store.failing = true;
		await t.service.read();
		await t.service.flush();
		await t.service.uniqueVisitorsOff();
		t.store.failing = false;
		await t.service.flush();
		assert.deepEqual(t.store.flushed[0].visitors, []);
		assert.equal(t.store.flushed[0].minutes[0].requests, 1);
	});

	it("uniqueVisitorsOn counts from the next line", async () => {
		const t = setup({ results: [read([line("example.com")]), read([line("example.com")])] });
		await t.service.start();
		await t.service.read();
		createTrafficHooks({ applyAccessLog: () => Promise.resolve(), traffic: t.service }).onUniqueVisitorsOn();
		await t.service.read();
		await t.service.flush();
		assert.equal(t.store.flushed[0].visitors.length, 1);
	});

	it("a created key deletes the stored hashes once at start, a loaded key does not", async () => {
		const created = setup({ config: on, visitorKey: { key: Buffer.alloc(32, 1), created: true } });
		await created.service.start();
		assert.equal(created.store.calls.filter((c) => c === "deleteVisitors").length, 1);
		const loaded = setup({ config: on });
		await loaded.service.start();
		assert.ok(!loaded.store.calls.includes("deleteVisitors"));
		await loaded.service.start();
		assert.equal(loaded.keyLoads(), 1, "the key is loaded once per start");
	});

	it("deletes stored hashes once at start when the setting is off, late when the settings could not be read", async () => {
		const off = setup({ visitorKey: { key: Buffer.alloc(32, 1), created: true } });
		await off.service.start();
		assert.equal(off.store.calls.filter((c) => c === "deleteVisitors").length, 1);
		const late = setup({ configFails: 1 });
		await late.service.start();
		assert.ok(!late.store.calls.includes("deleteVisitors"));
		await late.service.flush();
		assert.equal(late.store.calls.filter((c) => c === "deleteVisitors").length, 1);
		const lateOn = setup({ configFails: 1, config: on });
		await lateOn.service.start();
		await lateOn.service.flush();
		assert.ok(!lateOn.store.calls.includes("deleteVisitors"));
	});

	it("a failing key load leaves unique visitors off, logs once and still counts traffic", async () => {
		const t = setup({
			config: on,
			visitorKey: new Error("database is locked"),
			results: [read([line("example.com")]), read([line("example.com")])],
		});
		await t.service.start();
		await t.service.read();
		await t.service.flush();
		await t.service.read();
		await t.service.flush();
		assert.equal(t.errors.filter((m) => m.includes("visitor key")).length, 1);
		assert.deepEqual(
			t.store.flushed.map((b) => [b.visitors.length, b.minutes[0].requests]),
			[
				[0, 1],
				[0, 1],
			],
		);
	});

	it("a failing flush keeps the visitor rows and writes them with the next successful one", async () => {
		const t = setup({ config: on, results: [read([line("example.com")])] });
		await t.service.start();
		t.store.failing = true;
		await t.service.read();
		await t.service.flush();
		t.store.failing = false;
		t.advance(MINUTE);
		await t.service.flush();
		assert.equal(t.store.flushed.length, 1);
		assert.equal(t.store.flushed[0].visitors.length, 1);
	});

	it("visitor rows of a batch older than 10 minutes are dropped with it", async () => {
		const t = setup({ config: on, results: [read([line("example.com")])] });
		await t.service.start();
		t.store.failing = true;
		await t.service.read();
		await t.service.flush();
		t.advance(10 * MINUTE);
		await t.service.flush();
		t.store.failing = false;
		await t.service.flush();
		assert.equal(t.store.flushed.length, 0, "nothing left to write");
		assert.equal(t.service.status().dropped_requests, 1);
	});

	it("returning visitors after a restart do not fill the cap: 800 stored, 300 back and 100 new under cap 1000", async () => {
		const knex = knexFactory({
			client: "better-sqlite3",
			connection: { filename: ":memory:" },
			useNullAsDefault: true,
		});
		await upMonitoring(knex);
		await upVisitors(knex);
		const store = createStore(knex);
		const ip = (n) => `198.51.${Math.floor(n / 256)}.${n % 256}`;
		const lines = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => line("example.com", ip(from + i)));
		const config = { ...on, visitors_cap: 1000 };
		try {
			const first = setup({ store, config, results: [read(lines(1, 800))] });
			await first.service.start();
			await first.service.read();
			await first.service.stop();
			const second = setup({ store, config, results: [read(lines(501, 900))] });
			await second.service.start();
			await second.service.read();
			await second.service.stop();
			assert.deepEqual(await store.countVisitors({ startDay: 0, hosts: ["example.com"] }), {
				visitors: 900,
				capped: false,
			});
		} finally {
			await knex.destroy();
		}
	});

	it("seeds the stored hashes at start: after a restart the same IP counts once and a capped day stays capped", async () => {
		const knex = knexFactory({
			client: "better-sqlite3",
			connection: { filename: ":memory:" },
			useNullAsDefault: true,
		});
		await upMonitoring(knex);
		await upVisitors(knex);
		const store = createStore(knex);
		const visitorRows = () => knex("traffic_visitor").orderBy("id").select("host", "hash");
		try {
			const config = { ...on, visitors_cap: 3 };
			const first = setup({
				store,
				config,
				results: [
					read([
						line("example.com"),
						line("example.com", "198.51.100.1"),
						line("example.com", "198.51.100.2"),
						line("example.com", "198.51.100.3"),
						line("other.test"),
					]),
				],
				hosts: ["example.com", "other.test"],
			});
			await first.service.start();
			await first.service.read();
			await first.service.stop();
			const before = await visitorRows();
			assert.deepEqual(
				before.map((r) => r.hash === ""),
				[false, false, false, true, false],
				"three visitors and the marker, one visitor of other.test",
			);
			const second = setup({
				store,
				config,
				results: [
					read([
						line("example.com"),
						line("example.com", "198.51.100.9"),
						line("other.test"),
						line("other.test", "198.51.100.9"),
					]),
				],
				hosts: ["example.com", "other.test"],
			});
			await second.service.start();
			await second.service.read();
			await second.service.stop();
			const after = await visitorRows();
			assert.equal(after.length, 6, "only the new visitor of other.test is added");
			assert.deepEqual(await store.countVisitors({ startDay: 0, hosts: ["other.test"] }), {
				visitors: 2,
				capped: false,
			});
			assert.deepEqual(await store.countVisitors({ startDay: 0, hosts: ["example.com"] }), {
				visitors: 3,
				capped: true,
			});
			// the cap is raised above the stored count: after the next restart new visitors are admitted again
			const third = setup({
				store,
				config: { ...on, visitors_cap: 5 },
				results: [read([line("example.com", "198.51.100.20"), line("example.com", "198.51.100.21")])],
			});
			await third.service.start();
			await third.service.read();
			await third.service.stop();
			assert.deepEqual(await store.countVisitors({ startDay: 0, hosts: ["example.com"] }), {
				visitors: 5,
				capped: true,
			});
			assert.equal((await visitorRows()).filter((r) => r.hash === "").length, 1, "no second marker");
		} finally {
			await knex.destroy();
		}
	});

	it("reads the stored hashes for today and yesterday once at start", async () => {
		const t = setup({ config: on });
		await t.service.start();
		const today = Math.floor(Date.UTC(2026, 9, 24, 8, 16, 0) / 86400000);
		assert.deepEqual(
			t.store.calls.filter((c) => Array.isArray(c) && c[0] === "visitorDayHashes"),
			[["visitorDayHashes", { days: [today - 1, today] }]],
		);
		const created = setup({ config: on, visitorKey: { key: Buffer.alloc(32, 1), created: true } });
		await created.service.start();
		assert.ok(!created.store.calls.some((c) => Array.isArray(c) && c[0] === "visitorDayHashes"), "all deleted");
	});

	it("applies visitors_cap from the settings at each refresh", async () => {
		const t = setup({
			config: { ...on, visitors_cap: 1 },
			results: [
				read([line("example.com"), line("example.com", "198.51.100.1")]),
				read([line("example.com", "198.51.100.1")]),
			],
		});
		await t.service.start();
		await t.service.read();
		await t.service.flush();
		assert.deepEqual(
			t.store.flushed[0].visitors.map((r) => r.hash === ""),
			[false, true],
		);
		t.values.visitors_cap = 2;
		await t.service.flush();
		await t.service.read();
		await t.service.flush();
		assert.equal(t.store.flushed.at(-1).visitors.length, 1, "a raised cap counts new visitors again");
	});

	it("visitors dropped by the 10-minute rule are counted again the same day", async () => {
		const t = setup({ config: on, results: [read([line("example.com")]), read([line("example.com")])] });
		await t.service.start();
		t.store.failing = true;
		await t.service.read();
		await t.service.flush();
		t.advance(10 * MINUTE);
		await t.service.flush();
		t.store.failing = false;
		await t.service.read();
		await t.service.flush();
		assert.equal(t.store.flushed.length, 1);
		assert.equal(t.store.flushed[0].visitors.length, 1);
	});

	it("reports a failed key load in the status only while the setting is on", async () => {
		const t = setup({ config: on, visitorKey: new Error("database is locked") });
		await t.service.start();
		assert.equal(t.service.status().visitors_error, "Visitor counting is unavailable: the key could not be loaded");
		assert.ok(!t.service.status().visitors_error.includes("locked"));
		const off = setup({ visitorKey: new Error("database is locked") });
		await off.service.start();
		assert.equal(off.service.status().visitors_error, null);
		const ok = setup({ config: on });
		await ok.service.start();
		assert.equal(ok.service.status().visitors_error, null);
	});

	it("logs once that an unreadable key was replaced, without the key", async () => {
		const key = Buffer.alloc(32, 9);
		const t = setup({ config: on, visitorKey: { key, created: true, replaced: true } });
		await t.service.start();
		assert.deepEqual(t.errors, [
			"Traffic statistics: The visitor key could not be read; a new key was created and stored visitor hashes were deleted",
		]);
		assert.ok(t.store.calls.includes("deleteVisitors"));
		const first = setup({ config: on, visitorKey: { key, created: true, replaced: false } });
		await first.service.start();
		assert.deepEqual(first.errors, [], "a first key is not reported");
	});

	it("off and then on again within the 5-minute pin counts from the next line", async () => {
		const t = setup({ config: on, results: [read([line("example.com")]), read([line("example.com")])] });
		await t.service.start();
		const hooks = createTrafficHooks({ applyAccessLog: () => Promise.resolve(), traffic: t.service });
		await hooks.onUniqueVisitorsOff();
		await t.service.read();
		await t.service.flush();
		assert.deepEqual(t.store.flushed[0].visitors, []);
		t.advance(MINUTE);
		hooks.onUniqueVisitorsOn();
		await t.service.read();
		await t.service.flush();
		assert.equal(t.store.flushed[1].visitors.length, 1);
	});
});

describe("traffic service: recent requests", () => {
	const request = (host, ip, path) => line(host, ip).replace('"GET / HTTP/2.0"', `"POST ${path} HTTP/2.0"`);

	it("records parsed requests newest first with method, path without query, host key and country", async () => {
		const t = setup({
			hosts: ["example.com"],
			results: [read([request("example.com", "203.0.113.7", "/a?token=secret"), line("random.test")])],
		});
		await t.service.start();
		await t.service.read();
		const list = t.service.recent();
		assert.deepEqual(list, [
			{
				time: Date.UTC(2026, 9, 24, 8, 15, 30),
				host: "_other",
				method: "GET",
				path: "/",
				status: 200,
				bytes: 100,
				country: "DE",
			},
			{
				time: Date.UTC(2026, 9, 24, 8, 15, 30),
				host: "example.com",
				method: "POST",
				path: "/a",
				status: 200,
				bytes: 100,
				country: "DE",
			},
		]);
		assert.equal(JSON.stringify(list).includes("secret"), false);
		assert.deepEqual(
			t.service.recent({ keys: ["example.com"] }).map((e) => e.path),
			["/a"],
		);
	});

	it("does not record NPMpro's own requests", async () => {
		const health = line("127.0.0.1:81").replace('"curl/8"', '"NPMpro/healthcheck"');
		const t = setup({ results: [read([health, line("192.168.1.10:81"), line("example.com")])] });
		await t.service.start();
		await t.service.read();
		assert.deepEqual(
			t.service.recent().map((e) => e.host),
			["example.com"],
		);
	});

	it("keeps no IP while show_ips is off, and the IP while it is on", async () => {
		const off = setup({ results: [read([line("example.com")])] });
		await off.service.start();
		await off.service.read();
		assert.equal("ip" in off.service.recent()[0], false);

		const on = setup({ config: { show_ips: true }, results: [read([line("example.com")])] });
		await on.service.start();
		await on.service.read();
		assert.equal(on.service.recent()[0].ip, "203.0.113.7");
	});

	it("showIpsOff removes the kept IPs at once and keeps none within the pin", async () => {
		const t = setup({
			config: { show_ips: true },
			results: [read([line("example.com")]), read([line("example.com", "203.0.113.9")])],
		});
		await t.service.start();
		await t.service.read();
		const off = t.service.showIpsOff();
		// synchronous: before the stored IPs are deleted
		assert.equal("ip" in t.service.recent()[0], false);
		await off;
		await t.service.read();
		await t.service.flush();
		assert.equal(t.service.recent().length, 2);
		assert.equal(JSON.stringify(t.service.recent()).includes("203.0.113"), false);
	});

	it("drops the kept IPs when a settings read says show_ips is off", async () => {
		const t = setup({ config: { show_ips: true }, results: [read([line("example.com")])] });
		await t.service.start();
		await t.service.read();
		t.values.show_ips = false;
		await t.service.flush();
		assert.equal("ip" in t.service.recent()[0], false);
	});

	it("switching traffic statistics off clears the list", async () => {
		const t = setup({ results: [read([line("example.com")])] });
		await t.service.start();
		await t.service.read();
		assert.equal(t.service.recent().length, 1);
		await t.service.setEnabled(false);
		assert.deepEqual(t.service.recent(), []);
	});
});

describe("traffic service: host resolver", () => {
	it("builds the resolver from the host list with id and type, still maps hosts for counting", async () => {
		const t = setup({
			hosts: [{ id: 5, type: "redirection", domain_names: ["example.com", "www.example.com"] }],
			results: [read([line("www.example.com"), line("unknown.test")])],
		});
		await t.service.start();
		const resolver = await t.service.hostResolver();
		assert.deepEqual(resolver.keysFor("redirection", 5), ["example.com", "www.example.com"]);
		assert.equal(t.hostLoads(), 1, "the list loaded at start is reused");
		await t.service.read();
		await t.service.flush();
		assert.deepEqual(t.store.flushed[0].minutes.map((m) => m.host).sort(), ["_other", "www.example.com"]);
	});

	it("reloads the host list for the API when it is older than a minute, also while traffic is off", async () => {
		const t = setup({ config: { traffic_enabled: false } });
		await t.service.start();
		assert.equal(t.hostLoads(), 0);
		assert.deepEqual((await t.service.hostResolver()).keysFor("proxy", 1), ["example.com"]);
		await t.service.hostResolver();
		assert.equal(t.hostLoads(), 1);
		t.advance(60000);
		t.setHosts(["example.org"]);
		assert.deepEqual((await t.service.hostResolver()).keysFor("proxy", 1), ["example.org"]);
		assert.equal(t.hostLoads(), 2);
	});

	it("a host saved shortly before its first request is counted under its own key, not _other", async () => {
		const t = setup({
			results: [read([line("example.com")]), read([line("new.test")]), read([line("newer.test")])],
		});
		await t.service.start();
		t.advance(4000);
		t.setHosts(["example.com", "new.test"]);
		t.advance(1000);
		await t.service.read();
		await t.service.read();
		// a flush reloads the list, then a host is saved 1 s later and requested 1 s after that
		await t.service.flush();
		t.advance(1000);
		t.setHosts(["example.com", "new.test", "newer.test"]);
		t.advance(1000);
		await t.service.read();
		await t.service.flush();
		const keys = t.store.flushed.flatMap((b) => b.minutes.map((m) => m.host));
		assert.deepEqual(keys, ["example.com", "new.test", "newer.test"]);
	});

	it("reloads the host list at most once per read and not for a read without lines", async () => {
		const t = setup({ results: [read([]), read([line("example.com")]), read([line("example.com")])] });
		await t.service.start();
		assert.equal(t.hostLoads(), 1);
		t.advance(5000);
		await t.service.read();
		assert.equal(t.hostLoads(), 1, "no lines, no reload");
		t.advance(5000);
		await t.service.read();
		assert.equal(t.hostLoads(), 2);
		await t.service.read();
		assert.equal(t.hostLoads(), 2, "loaded at the time of this read already");
	});

	it("a failed host load is retried by the next read and the API, and logged once", async () => {
		const t = setup({ results: [read([line("example.com")]), read([line("example.com")])] });
		await t.service.start();
		t.setHosts(new Error("no such table: proxy_host"));
		t.advance(5000);
		await t.service.read();
		t.setHosts(["example.com"]);
		await t.service.read();
		await t.service.flush();
		assert.equal(t.errors.filter((e) => e.includes("could not read the host list")).length, 1);
		assert.deepEqual(
			t.store.flushed[0].minutes.map((m) => [m.host, m.requests]),
			[["example.com", 2]],
		);
		t.setHosts(new Error("no such table: proxy_host"));
		await t.service.flush();
		t.setHosts([{ id: 7, type: "proxy", domain_names: ["example.org"] }]);
		const loads = t.hostLoads();
		assert.equal(
			(await t.service.hostResolver()).ownerOf("example.org").host_id,
			7,
			"no 60 s wait after a failure",
		);
		assert.equal(t.hostLoads(), loads + 1);
	});

	it("a host reload drops the recent per host lists of keys that are gone", async () => {
		const t = setup({ hosts: ["example.com", "old.test"], results: [read([line("old.test")])] });
		await t.service.start();
		await t.service.read();
		assert.equal(t.service.recent({ keys: ["old.test"] }).length, 1);
		t.setHosts(["example.com"]);
		await t.service.flush();
		assert.deepEqual(t.service.recent({ keys: ["old.test"] }), []);
		assert.equal(t.service.recent().length, 1, "the overall list keeps it");
	});

	it("a failed refresh keeps the previous resolver and logs the error", async () => {
		const t = setup();
		await t.service.start();
		t.setHosts(new Error("no such table: proxy_host"));
		await t.service.flush();
		assert.equal(t.errors.filter((e) => e.includes("could not read the host list")).length, 1);
		assert.equal((await t.service.hostResolver()).ownerOf("example.com").host_id, 1);
	});

	it("without any loaded host list every key resolves as its own deleted entry", async () => {
		const t = setup({ hosts: new Error("no such table: proxy_host") });
		await t.service.start();
		const resolver = await t.service.hostResolver();
		assert.deepEqual(resolver.ownerOf("example.com"), {
			host_id: null,
			host_type: "deleted",
			name: "example.com",
			domain_names: ["example.com"],
		});
		assert.ok(t.errors.some((e) => e.includes("could not read the host list")));
	});

	it("a late settings read that deletes the visitor hashes also forgets the counts seeded at start", async () => {
		const store = fakeStore();
		const today = Math.floor(Date.UTC(2026, 9, 24, 8, 16, 0) / 86400000);
		store.dayHashes = [{ day: today, host: "example.com", hashes: ["1".padStart(32, "0")], capped: true }];
		const t = setup({
			store,
			configFails: 1,
			config: { unique_visitors: false, visitors_cap: 1 },
			results: [read([line("example.com")])],
		});
		await t.service.start();
		await t.service.flush();
		assert.ok(store.calls.includes("deleteVisitors"));
		t.values.unique_visitors = true;
		t.service.uniqueVisitorsOn();
		await t.service.read();
		await t.service.flush();
		const rows = store.flushed.flatMap((b) => b.visitors);
		assert.ok(
			rows.some((r) => r.host === "example.com" && r.hash !== ""),
			"the deleted day does not count against the cap",
		);
	});
});

describe("traffic state meta", () => {
	const fakeRow = (initial) => {
		let meta = initial;
		return {
			read: () => Promise.resolve(meta === undefined ? undefined : structuredClone(meta)),
			write: (next) => {
				meta = structuredClone(next);
				return Promise.resolve();
			},
			get: () => meta,
		};
	};
	const box = { encrypt: (v) => `enc:${v}`, decrypt: (v) => v.slice(4) };

	it("saving the reader position keeps the visitor key, writing the key keeps the position", async () => {
		const row = fakeRow(undefined);
		const meta = createStateMeta(row);
		assert.equal(await meta.loadState(), null);
		await meta.saveState({ inode: 3, offset: 10 });
		const first = await loadVisitorKey({ readMeta: meta.readMeta, writeMeta: meta.writeMeta, box });
		assert.equal(first.created, true);
		assert.equal(row.get().inode, 3);
		assert.equal(row.get().offset, 10);
		const stored = row.get().visitor_key;
		assert.equal(typeof stored, "string");
		await meta.saveState({ inode: 3, offset: 20 });
		assert.deepEqual(row.get(), { inode: 3, offset: 20, visitor_key: stored });
		assert.deepEqual(await meta.loadState(), { inode: 3, offset: 20 });
		const again = await loadVisitorKey({ readMeta: meta.readMeta, writeMeta: meta.writeMeta, box });
		assert.equal(again.created, false);
		assert.ok(again.key.equals(first.key));
	});

	it("the key write only takes visitor_key and reads the current meta first", async () => {
		const row = fakeRow({ inode: 1, offset: 5 });
		const meta = createStateMeta(row);
		await meta.writeMeta({ inode: 0, offset: 0, visitor_key: "k" });
		assert.deepEqual(row.get(), { inode: 1, offset: 5, visitor_key: "k" });
	});
});

describe("counter", () => {
	it("forgetIps drops undrained IPs and the per hour admission sets", () => {
		const counter = createCounter({ maxPerKey: 1 });
		const entry = (ip) => ({ time: 0, host: "a", ip, status: 200, bytes: 1 });
		counter.add(entry("192.0.2.1"), null, { showIps: true });
		counter.forgetIps();
		counter.add(entry("192.0.2.2"), null, { showIps: true });
		const out = counter.drain();
		assert.deepEqual(
			out.ips.map((r) => r.ip),
			["192.0.2.2"],
			"the cap starts again instead of counting the new IP as other",
		);
		assert.equal(out.minutes[0].requests, 2);
	});
});

describe("CrowdSec service", () => {
	const conf = ["ENABLED=true", "API_URL=http://crowdsec:8080", `API_KEY=${KEY}`].join("\n");
	const disabledConf = ["ENABLED=false", "API_URL=http://x", "API_KEY=k"].join("\n");
	const decision = (id) => ({
		id,
		scope: "Ip",
		value: `192.0.2.${id}`,
		scenario: "s",
		origin: "o",
		type: "ban",
		duration: "1h",
	});

	it("seeds the first poll so old decisions are not new, then adds and drops ids", async () => {
		let time = 1_000_000_000_000;
		let list = [decision(1), decision(2)];
		const svc = createCrowdsecService({
			readConf: () => Promise.resolve(conf),
			fetch: () => Promise.resolve(list),
			now: () => time,
			log: silent,
		});
		await svc.poll();
		assert.equal(svc.result().total, 2);
		assert.equal(svc.result().added_24h, 0);
		time += MINUTE;
		list = [decision(2), decision(3)];
		await svc.poll();
		assert.equal(svc.result().total, 2);
		assert.equal(svc.result().added_24h, 1);
		// 1 was dropped: when it comes back it is new
		time += MINUTE;
		list = [decision(1), decision(2), decision(3)];
		await svc.poll();
		assert.equal(svc.result().added_24h, 2);
		time += 25 * 3600000;
		await svc.poll();
		assert.equal(svc.result().added_24h, 0);
	});

	it("does not poll while not configured and reports configured false", async () => {
		let fetched = 0;
		const svc = createCrowdsecService({
			readConf: () => Promise.resolve(disabledConf),
			fetch: () => {
				fetched++;
				return Promise.resolve([]);
			},
			log: silent,
		});
		await svc.poll();
		assert.equal(fetched, 0);
		assert.equal(svc.result().configured, false);
		assert.equal(svc.result().reachable, false);
	});

	it("keeps the last list on an error and exposes the error without the key", async () => {
		let fail = false;
		const svc = createCrowdsecService({
			readConf: () => Promise.resolve(conf),
			fetch: () => (fail ? Promise.reject(new Error("connect ECONNREFUSED")) : Promise.resolve([decision(1)])),
			log: silent,
		});
		await svc.poll();
		fail = true;
		await svc.poll();
		const r = svc.result();
		assert.equal(r.reachable, false);
		assert.equal(r.total, 1);
		assert.match(r.error, REFUSED);
		assert.ok(!JSON.stringify(r).includes(KEY));
	});

	it("reports why the bouncer config could not be read", async () => {
		const svc = createCrowdsecService({
			readConf: () => Promise.reject(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })),
			fetch: () => Promise.reject(new Error("must not fetch")),
			log: silent,
		});
		await svc.poll();
		const r = svc.result();
		assert.equal(r.configured, false);
		assert.equal(r.reachable, false);
		assert.equal(r.error, "Could not read the CrowdSec config: EACCES: permission denied");
	});

	it("polls every minute and stops", () => {
		const timers = fakeTimers();
		const svc = createCrowdsecService({ readConf: () => Promise.resolve(""), timers, log: silent });
		svc.start();
		assert.ok(timers.has(60000));
		svc.stop();
		assert.equal(timers.count(), 0);
	});
});

describe("GeoIP service", () => {
	const make = (values) => {
		let runs = 0;
		let reloads = 0;
		let time = Date.UTC(2026, 9, 24);
		const timers = fakeTimers();
		const svc = createGeoipService({
			geoip: {
				reload: () => {
					reloads++;
					return Promise.resolve();
				},
			},
			runUpdate: () => {
				runs++;
				return Promise.resolve({ ok: false, updated: [], error: "401" });
			},
			getConfig: () => Promise.resolve({ values }),
			now: () => time,
			timers,
			log: silent,
		});
		return {
			svc,
			timers,
			runs: () => runs,
			reloads: () => reloads,
			advance: (ms) => {
				time += ms;
			},
		};
	};

	it("updates when credentials exist and the last update is missing, then waits a day after a failure", async () => {
		const g = make({ account_id: "1", license_key: "k", last_update: null });
		await g.svc.check();
		assert.equal(g.runs(), 1);
		g.advance(3600000);
		await g.svc.check();
		assert.equal(g.runs(), 1);
		g.advance(24 * 3600000);
		await g.svc.check();
		assert.equal(g.runs(), 2);
	});

	it("does not update without credentials or with a recent update", async () => {
		const none = make({ account_id: "", license_key: "", last_update: null });
		await none.svc.check();
		assert.equal(none.runs(), 0);
		const recent = make({
			account_id: "1",
			license_key: "k",
			last_update: new Date(Date.UTC(2026, 9, 22)).toISOString(),
		});
		await recent.svc.check();
		assert.equal(recent.runs(), 0);
		const old = make({
			account_id: "1",
			license_key: "k",
			last_update: new Date(Date.UTC(2026, 9, 20)).toISOString(),
		});
		await old.svc.check();
		assert.equal(old.runs(), 1);
	});

	it("reloads every 10 minutes, checks soon after start and hourly, and stops", async () => {
		const g = make({ account_id: "", license_key: "" });
		g.svc.start();
		assert.ok(g.timers.has(600000) && g.timers.has(3600000));
		g.timers.fire(600000);
		await new Promise((r) => setImmediate(r));
		assert.equal(g.reloads(), 1);
		g.svc.stop();
		assert.equal(g.timers.count(), 0);
	});
});

describe("monitoring API", () => {
	const schema = (name) =>
		JSON.parse(readFileSync(new URL(`../schema/components/${name}.json`, import.meta.url), "utf8"));
	const ajv = new Ajv({ strict: false, allErrors: true });
	ajv.addFormat("date-time", true);
	const validTraffic = ajv.compile(schema("monitoring-traffic-object"));
	const validCrowdsec = ajv.compile(schema("monitoring-crowdsec-object"));
	const validSummary = ajv.compile(schema("monitoring-summary-object"));

	const admin = { canAdmin: () => true };
	const user = {
		canAdmin: () => {
			throw new Error("Permission Denied");
		},
	};

	const trafficData = {
		totals: { requests: 3, bytes: 300, error_rate: 0 },
		series: [{ bucket: 1, by_class: { "2xx": 3, "3xx": 0, "4xx": 0, "5xx": 0 } }],
		hosts: [{ host: "example.com", requests: 3, bytes: 300 }],
		top_countries: [{ country: "DE", requests: 3 }],
		top_asns: [{ asn: 3320, asn_name: "DTAG", requests: 3 }],
		top_ips: [{ ip: "203.0.113.7", requests: 3 }],
		countries: { DE: 3, "--": 1, US: 5 },
	};

	const make = ({
		values = {},
		crowdsec = {},
		available = { country: true, asn: true },
		now = () => 0,
		crowdsecResult = null,
		failSummary = false,
		data = trafficData,
		resolver = createHostResolver([{ id: 1, type: "proxy", domain_names: ["example.com"] }]),
		visitorsError = null,
		failVisitors = false,
		traffic = null,
		recent = [],
	} = {}) => {
		const queries = [];
		const recentQueries = [];
		const summaries = [];
		const visitorQueries = [];
		const errors = [];
		const api = createMonitoring({
			traffic: {
				status: () => ({
					enabled: true,
					skipped_lines: 0,
					dropped_requests: 0,
					last_read: null,
					error: null,
					visitors_error: visitorsError,
				}),
				hostResolver: () => (traffic ? traffic.hostResolver() : Promise.resolve(resolver)),
				recent: (args) => {
					recentQueries.push(args);
					return structuredClone(recent);
				},
			},
			crowdsec: {
				result: () =>
					crowdsecResult ?? {
						configured: true,
						reachable: true,
						error: null,
						fetched_at: "2026-10-24T10:00:00.000Z",
						total: 4,
						added_24h: 1,
						by_scenario: [],
						by_origin: [],
						by_type: [],
						newest: [],
						countries: [],
						...crowdsec,
					},
			},
			geoip: { available: () => available },
			store: {
				queryTraffic: (args) => {
					queries.push(args);
					return Promise.resolve(structuredClone(args.showIps ? data : { ...data, top_ips: [] }));
				},
				countVisitors: (args) => {
					visitorQueries.push(args);
					if (failVisitors) return Promise.reject(new Error("database is locked"));
					const hosts = args.hosts ?? ["*"];
					return Promise.resolve({ visitors: hosts.length * 10, capped: hosts.includes("capped.test") });
				},
				summary: (args) => {
					summaries.push(args);
					if (failSummary) return Promise.reject(new Error("database is locked"));
					return Promise.resolve({
						requests_today: 3,
						series_24h: [{ bucket: 1, requests: 3 }],
						error_rate_today: 0,
						top_country_today: "DE",
					});
				},
			},
			getConfig: () => Promise.resolve({ values: { traffic_enabled: true, show_ips: false, ...values } }),
			now,
			log: { ...silent, error: (message) => errors.push(message) },
		});
		return { api, queries, summaries, visitorQueries, recentQueries, errors };
	};

	const groupedData = {
		...trafficData,
		hosts: [
			{ host: "example.com", requests: 5, bytes: 50 },
			{ host: "_other", requests: 4, bytes: 40 },
			{ host: "www.example.com", requests: 3, bytes: 30 },
			{ host: "removed.test", requests: 2, bytes: 20 },
			{ host: "moved.test", requests: 1, bytes: 10 },
		],
	};
	const groupedResolver = createHostResolver([
		{ id: 1, type: "proxy", domain_names: ["example.com", "www.example.com"] },
		{ id: 2, type: "dead", domain_names: ["moved.test"] },
	]);

	it("groups top_hosts per NPMpro host and omits visitor fields while unique visitors are off", async () => {
		const { api, visitorQueries } = make({ data: groupedData, resolver: groupedResolver });
		const out = await api.getTraffic(admin, { range: "24h", host: "" });
		assert.ok(validTraffic(out), JSON.stringify(validTraffic.errors));
		assert.deepEqual(out.top_hosts, [
			{
				host_id: 1,
				host_type: "proxy",
				name: "example.com",
				domain_names: ["example.com", "www.example.com"],
				requests: 8,
				bytes: 80,
			},
			{ host_id: null, host_type: "other", name: "_other", domain_names: [], requests: 4, bytes: 40 },
			{
				host_id: null,
				host_type: "deleted",
				name: "removed.test",
				domain_names: ["removed.test"],
				requests: 2,
				bytes: 20,
			},
			{ host_id: 2, host_type: "dead", name: "moved.test", domain_names: ["moved.test"], requests: 1, bytes: 10 },
		]);
		assert.equal("visitors" in out.totals, false);
		assert.equal(out.status.unique_visitors, false);
		assert.equal(visitorQueries.length, 0);
	});

	it("a moved name counts once, under its new owner", async () => {
		const moved = createHostResolver([
			{ id: 1, type: "proxy", domain_names: ["example.com", "www.example.com"] },
			{ id: 4, type: "redirection", domain_names: ["moved.test"] },
		]);
		const { api } = make({ data: groupedData, resolver: moved });
		const out = await api.getTraffic(admin, { range: "24h", host: "" });
		const owners = out.top_hosts.filter((h) => h.domain_names.includes("moved.test"));
		assert.deepEqual(
			owners.map((h) => [h.host_type, h.host_id, h.requests]),
			[["redirection", 4, 1]],
		);
	});

	it("keeps the ten hosts with the most requests after grouping", async () => {
		const hosts = Array.from({ length: 12 }, (_, i) => ({ host: `h${i}.test`, requests: 20 - i, bytes: 1 }));
		hosts.push(
			{ host: "www.example.com", requests: 15, bytes: 1 },
			{ host: "example.com", requests: 15, bytes: 1 },
		);
		const { api } = make({ data: { ...trafficData, hosts }, resolver: groupedResolver });
		const out = await api.getTraffic(admin, { range: "24h", host: "" });
		assert.equal(out.top_hosts.length, 10);
		assert.deepEqual(out.top_hosts[0], {
			host_id: 1,
			host_type: "proxy",
			name: "example.com",
			domain_names: ["example.com", "www.example.com"],
			requests: 30,
			bytes: 2,
		});
		assert.ok(validTraffic(out), JSON.stringify(validTraffic.errors));
	});

	it("adds visitor counts per entry and in the totals while unique visitors are on", async () => {
		const now = Date.UTC(2026, 9, 24, 10, 0, 0);
		const today = Math.floor(now / 86400000);
		const data = { ...groupedData, hosts: [...groupedData.hosts, { host: "capped.test", requests: 1, bytes: 1 }] };
		const { api, visitorQueries } = make({
			data,
			resolver: groupedResolver,
			values: { unique_visitors: true },
			now: () => now,
		});
		const out = await api.getTraffic(admin, { range: "7d", host: "" });
		assert.ok(validTraffic(out), JSON.stringify(validTraffic.errors));
		assert.equal(out.status.unique_visitors, true);
		assert.deepEqual(visitorQueries[0], { startDay: today - 7, hosts: null });
		assert.deepEqual(out.totals.visitors, 10);
		assert.equal(out.totals.visitors_capped, false);
		const byName = Object.fromEntries(out.top_hosts.map((h) => [h.name, h]));
		assert.equal(byName["example.com"].visitors, 20, "both keys of the host are counted together");
		assert.deepEqual(
			visitorQueries.find((q) => q.hosts?.includes("www.example.com")),
			{ startDay: today - 7, hosts: ["example.com", "www.example.com"] },
		);
		assert.equal(byName._other.visitors, 10);
		assert.equal(byName["capped.test"].visitors_capped, true);
		assert.equal(byName["example.com"].visitors_capped, false);

		const hour = make({ resolver: groupedResolver, values: { unique_visitors: true }, now: () => now });
		await hour.api.getTraffic(admin, { range: "1h", host: "" });
		await hour.api.getTraffic(admin, { range: "24h", host: "" });
		assert.equal(hour.visitorQueries[0].startDay, today, "1h counts the current UTC day");
		assert.equal(hour.visitorQueries.at(-1).startDay, today - 1, "24h starts on the day the range starts");
	});

	it("host_id and host_type select the keys of that host, an unknown host is not found", async () => {
		const { api, queries, visitorQueries } = make({
			data: groupedData,
			resolver: groupedResolver,
			values: { unique_visitors: true },
		});
		const out = await api.getTraffic(admin, { range: "24h", host: "ignored.test", host_id: 1, host_type: "proxy" });
		assert.deepEqual(queries[0].host, ["example.com", "www.example.com"]);
		assert.deepEqual(visitorQueries[0].hosts, ["example.com", "www.example.com"]);
		assert.equal(out.totals.visitors, 20);
		await api.getTraffic(admin, { range: "24h", host: "", host_id: 2, host_type: "dead" });
		assert.deepEqual(queries[1].host, ["moved.test"]);
		const before = visitorQueries.length;
		await api.getTraffic(admin, { range: "24h", host: "_other" });
		assert.equal(queries[2].host, "_other");
		assert.deepEqual(visitorQueries[before].hosts, ["_other"], "the totals count the selected key");
		await assert.rejects(
			api.getTraffic(admin, { range: "24h", host: "", host_id: 9, host_type: "proxy" }),
			(err) => err instanceof errs.ItemNotFoundError,
		);
		await assert.rejects(
			api.getTraffic(admin, { range: "24h", host: "", host_id: 1, host_type: "dead" }),
			(err) => err instanceof errs.ItemNotFoundError,
		);
		assert.equal(queries.length, 3);
	});

	it("caches per host filter and per unique visitors switch", async () => {
		const values = { unique_visitors: false };
		const { api, queries } = make({ data: groupedData, resolver: groupedResolver, values });
		await api.getTraffic(admin, { range: "24h", host: "", host_id: 1, host_type: "proxy" });
		await api.getTraffic(admin, { range: "24h", host: "", host_id: 1, host_type: "proxy" });
		assert.equal(queries.length, 1);
		await api.getTraffic(admin, { range: "24h", host: "", host_id: 2, host_type: "dead" });
		await api.getTraffic(admin, { range: "24h", host: "" });
		assert.equal(queries.length, 3);
		values.unique_visitors = true;
		const out = await api.getTraffic(admin, { range: "24h", host: "" });
		assert.equal(queries.length, 4);
		assert.equal(typeof out.totals.visitors, "number");
	});

	it("passes visitors_error through in the status", async () => {
		const error = "Visitor counting is unavailable: the key could not be loaded";
		const { api } = make({ values: { unique_visitors: true }, visitorsError: error });
		const out = await api.getTraffic(admin, { range: "24h", host: "" });
		assert.equal(out.status.visitors_error, error);
		assert.ok(validTraffic(out), JSON.stringify(validTraffic.errors));
	});

	it("summary has visitors_today while unique visitors are on", async () => {
		const now = Date.UTC(2026, 9, 24, 10, 0, 0);
		const { api, visitorQueries } = make({ values: { unique_visitors: true }, now: () => now });
		const out = await api.getSummary(admin);
		assert.equal(out.visitors_today, 10);
		assert.deepEqual(visitorQueries, [{ startDay: Math.floor(now / 86400000), hosts: null }]);
		assert.ok(validSummary(out), JSON.stringify(validSummary.errors));
		const off = await make({ values: { unique_visitors: true, traffic_enabled: false } }).api.getSummary(admin);
		assert.equal(off.visitors_today, null);
	});

	it("concurrent first calls wait for the first host list load, so a valid host_id is found", async () => {
		const t = setup({ config: { traffic_enabled: false } });
		await t.service.start();
		const [a, b] = await Promise.all([t.service.hostResolver(), t.service.hostResolver()]);
		assert.deepEqual(a.keysFor("proxy", 1), ["example.com"]);
		assert.deepEqual(b.keysFor("proxy", 1), ["example.com"]);
		assert.equal(t.hostLoads(), 1);

		const fresh = setup({ config: { traffic_enabled: false } });
		await fresh.service.start();
		const { api } = make({ traffic: fresh.service });
		const outs = await Promise.all([
			api.getTraffic(admin, { range: "24h", host: "", host_id: 1, host_type: "proxy" }),
			api.getTraffic(admin, { range: "1h", host: "", host_id: 1, host_type: "proxy" }),
		]);
		assert.equal(outs.length, 2);
	});

	it("counts the visitors of a host over all its names, also those without requests in the range", async () => {
		const now = Date.UTC(2026, 9, 24, 10, 0, 0);
		const resolver = createHostResolver([
			{ id: 1, type: "proxy", domain_names: ["example.com", "www.example.com"] },
		]);
		// only example.com had requests in the last hour, www.example.com had visitors earlier today
		const data = { ...trafficData, hosts: [{ host: "example.com", requests: 3, bytes: 30 }] };
		const all = make({ data, resolver, values: { unique_visitors: true }, now: () => now });
		const out = await all.api.getTraffic(admin, { range: "1h", host: "" });
		assert.deepEqual(all.visitorQueries[1].hosts, ["example.com", "www.example.com"]);
		const filtered = await all.api.getTraffic(admin, { range: "1h", host: "", host_id: 1, host_type: "proxy" });
		assert.equal(out.top_hosts[0].visitors, 20);
		assert.equal(out.top_hosts[0].visitors, filtered.totals.visitors);
		assert.equal(filtered.top_hosts[0].visitors, filtered.totals.visitors);
	});

	it("ignores host in the cache key when host_id and host_type select the host", async () => {
		const { api, queries } = make({ data: groupedData, resolver: groupedResolver });
		await api.getTraffic(admin, { range: "24h", host: "a.test", host_id: 1, host_type: "proxy" });
		await api.getTraffic(admin, { range: "24h", host: "b.test", host_id: 1, host_type: "proxy" });
		assert.equal(queries.length, 1);
	});

	it("summary returns visitors_today null and logs when the visitor count fails", async () => {
		const { api, errors } = make({ values: { unique_visitors: true }, failVisitors: true });
		const out = await api.getSummary(admin);
		assert.equal(out.visitors_today, null);
		assert.equal(out.requests_today, 3);
		assert.ok(validSummary(out), JSON.stringify(validSummary.errors));
		assert.equal(errors.length, 1);
		assert.ok(errors[0].includes("database is locked"));
	});

	it("parses the traffic query: host_id is coerced, host_id and host_type only together", () => {
		assert.deepEqual(parseTrafficQuery({ range: "7d", host_id: " 3 ", host_type: "proxy" }), {
			range: "7d",
			host: "",
			host_id: 3,
			host_type: "proxy",
		});
		assert.deepEqual(parseTrafficQuery({ host: " Example.COM " }), { range: "24h", host: "example.com" });
		const invalid = () => (err) => err instanceof errs.ValidationError && err.status === 400;
		assert.throws(() => parseTrafficQuery({ host_id: "3" }), invalid());
		assert.throws(() => parseTrafficQuery({ host_type: "proxy" }), invalid());
		assert.throws(() => parseTrafficQuery({ host_id: "x", host_type: "proxy" }), invalid());
		assert.throws(() => parseTrafficQuery({ host_id: "0", host_type: "proxy" }), invalid());
		assert.throws(() => parseTrafficQuery({ host_id: "3", host_type: "stream" }), invalid());
	});

	it("caches the traffic query per range and host for 30 s", async () => {
		let time = 0;
		const { api, queries } = make({ now: () => time });
		await api.getTraffic(admin, { range: "24h", host: "" });
		await api.getTraffic(admin, { range: "24h", host: "" });
		assert.equal(queries.length, 1);
		await api.getTraffic(admin, { range: "7d", host: "" });
		await api.getTraffic(admin, { range: "24h", host: "example.com" });
		assert.equal(queries.length, 3);
		time += 30000;
		await api.getTraffic(admin, { range: "24h", host: "" });
		assert.equal(queries.length, 4);
	});

	it("caches the dashboard summary for 30 s and does not cache a failure", async () => {
		let time = 0;
		const { api, summaries } = make({ now: () => time });
		await api.getSummary(admin);
		time += 29999;
		await api.getSummary(admin);
		assert.equal(summaries.length, 1);
		time += 1;
		await api.getSummary(admin);
		assert.equal(summaries.length, 2);

		const failing = make({ failSummary: true });
		await assert.rejects(failing.api.getSummary(admin), DB_LOCKED);
		await assert.rejects(failing.api.getSummary(admin), DB_LOCKED);
		assert.equal(failing.summaries.length, 2);
	});

	it("fills every newest field of a CrowdSec decision that lacks some", async () => {
		const svc = createCrowdsecService({
			readConf: () =>
				Promise.resolve(["ENABLED=true", "API_URL=http://crowdsec:8080", `API_KEY=${KEY}`].join("\n")),
			fetch: () => Promise.resolve([{ id: 5, value: "192.0.2.5", scope: "Ip", type: "ban" }]),
			log: silent,
		});
		await svc.poll();
		const { api } = make({ crowdsecResult: svc.result() });
		const out = api.getCrowdsec(admin);
		assert.equal(out.newest[0].scenario, "");
		assert.ok(validCrowdsec(out), JSON.stringify(validCrowdsec.errors));
	});

	const recentEntries = [
		{
			time: Date.UTC(2026, 9, 24, 8, 15, 30),
			host: "www.example.com",
			method: "GET",
			path: "/a",
			status: 404,
			bytes: 12,
			country: "DE",
			ip: "203.0.113.7",
		},
		{ time: 0, host: "_other", method: "-", path: "", status: 400, bytes: 0, country: null },
		{ time: 0, host: "removed.test", method: "POST", path: "/b", status: 502, bytes: 3, country: null },
	];

	it("returns recent requests with host names, uncached, and the IP only while IPs are shown", async () => {
		for (const showIps of [false, true]) {
			const { api, recentQueries } = make({
				values: { show_ips: showIps },
				resolver: groupedResolver,
				recent: recentEntries,
			});
			const out = await api.getTraffic(admin, { range: "24h", host: "" });
			assert.ok(validTraffic(out), JSON.stringify(validTraffic.errors));
			assert.deepEqual(recentQueries, [{ keys: null, limit: 100 }]);
			assert.deepEqual(out.recent, [
				{
					time: "2026-10-24T08:15:30.000Z",
					host_id: 1,
					host_type: "proxy",
					name: "example.com",
					method: "GET",
					path: "/a",
					status: 404,
					bytes: 12,
					country: "DE",
					...(showIps ? { ip: "203.0.113.7" } : {}),
				},
				{
					time: "1970-01-01T00:00:00.000Z",
					host_id: null,
					host_type: "other",
					name: "_other",
					method: "-",
					path: "",
					status: 400,
					bytes: 0,
					country: null,
				},
				{
					time: "1970-01-01T00:00:00.000Z",
					host_id: null,
					host_type: "deleted",
					name: "removed.test",
					method: "POST",
					path: "/b",
					status: 502,
					bytes: 3,
					country: null,
				},
			]);
			// the traffic numbers are cached, the recent requests are read on every call
			await api.getTraffic(admin, { range: "24h", host: "" });
			assert.equal(recentQueries.length, 2);
		}
	});

	it("selects the recent requests of the filtered host's keys", async () => {
		const { api, recentQueries } = make({ data: groupedData, resolver: groupedResolver });
		await api.getTraffic(admin, { range: "7d", host: "", host_id: 1, host_type: "proxy" });
		await api.getTraffic(admin, { range: "1h", host: "_other" });
		assert.deepEqual(recentQueries, [
			{ keys: ["example.com", "www.example.com"], limit: 100 },
			{ keys: ["_other"], limit: 100 },
		]);
	});

	it("requires an administrator on every endpoint", async () => {
		const { api } = make();
		await assert.rejects(api.getTraffic(user, { range: "24h", host: "" }), PERMISSION);
		assert.throws(() => api.getCrowdsec(user), PERMISSION);
		await assert.rejects(api.getSummary(user), PERMISSION);
	});

	it("omits IP fields when show_ips is off", async () => {
		const { api, queries } = make();
		const out = await api.getTraffic(admin, { range: "24h", host: "" });
		assert.equal("top_ips" in out, false);
		assert.equal(queries[0].showIps, false);
		assert.deepEqual(out.countries, [
			{ country: "US", requests: 5 },
			{ country: "DE", requests: 3 },
			{ country: "--", requests: 1 },
		]);
		assert.ok(validTraffic(out), JSON.stringify(validTraffic.errors));
		assert.deepEqual(out.status, {
			enabled: true,
			geoip: true,
			skipped_lines: 0,
			dropped_requests: 0,
			last_read: null,
			error: null,
			visitors_error: null,
			unique_visitors: false,
		});
	});

	it("includes top_ips when show_ips is on", async () => {
		const { api } = make({ values: { show_ips: true } });
		const out = await api.getTraffic(admin, { range: "7d", host: "example.com" });
		assert.deepEqual(out.top_ips, [{ ip: "203.0.113.7", requests: 3 }]);
		assert.ok(validTraffic(out), JSON.stringify(validTraffic.errors));
	});

	it("returns the CrowdSec result in the schema shape", () => {
		const { api } = make();
		assert.ok(validCrowdsec(api.getCrowdsec(admin)), JSON.stringify(validCrowdsec.errors));
	});

	it("summary nulls the fields whose source is off or unavailable", async () => {
		const full = await make().api.getSummary(admin);
		assert.deepEqual(full, {
			requests_today: 3,
			series_24h: [{ bucket: 1, requests: 3 }],
			error_rate_today: 0,
			active_bans: 4,
			top_country_today: "DE",
			visitors_today: null,
		});
		assert.ok(validSummary(full), JSON.stringify(validSummary.errors));

		const off = await make({
			values: { traffic_enabled: false },
			crowdsec: { reachable: false },
		}).api.getSummary(admin);
		assert.deepEqual(off, {
			requests_today: null,
			series_24h: null,
			error_rate_today: null,
			active_bans: null,
			top_country_today: null,
			visitors_today: null,
		});
		assert.ok(validSummary(off), JSON.stringify(validSummary.errors));

		const noGeo = await make({ available: { country: false, asn: false } }).api.getSummary(admin);
		assert.equal(noGeo.top_country_today, null);
		assert.equal(noGeo.requests_today, 3);
	});
});
