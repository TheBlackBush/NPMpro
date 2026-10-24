import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Ajv from "ajv/dist/2020.js";
import { createMonitoring } from "../internal/monitoring.js";
import { createCrowdsecService } from "../lib/crowdsec/service.js";
import { createGeoipService } from "../lib/geoip/service.js";
import { createCounter } from "../lib/traffic/counter.js";
import { createHostMapper, createTrafficHooks, createTrafficService } from "../lib/traffic/service.js";

const MINUTE = 60000;
const KEY = "bouncer-key";
const DB_LOCKED = /database is locked/u;
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
		flush(batch) {
			calls.push("flush");
			if (this.failing) return Promise.reject(new Error("database is locked"));
			this.flushed.push(structuredClone(batch));
			return Promise.resolve();
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
} = {}) => {
	let failures = configFails;
	let hostLoads = 0;
	let time = Date.UTC(2026, 9, 24, 8, 16, 0);
	const store = fakeStore();
	const reader = fakeReader(results);
	const timers = fakeTimers();
	const saved = [];
	const values = { traffic_enabled: true, retention_days: 30, show_ips: false, ...config };
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
			return Promise.resolve(hosts);
		},
		createReader: reader.create,
		now: () => time,
		timers,
		adminPort,
		log: silent,
	});
	return {
		service,
		store,
		reader,
		timers,
		saved,
		values,
		hostLoads: () => hostLoads,
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
			applyAccessLog: (enabled) => {
				applied.push(enabled);
				return Promise.resolve();
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
		top_hosts: [{ host: "example.com", requests: 3, bytes: 300 }],
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
	} = {}) => {
		const queries = [];
		const summaries = [];
		const api = createMonitoring({
			traffic: {
				status: () => ({ enabled: true, skipped_lines: 0, dropped_requests: 0, last_read: null, error: null }),
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
					return Promise.resolve(
						structuredClone(args.showIps ? trafficData : { ...trafficData, top_ips: [] }),
					);
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
		});
		return { api, queries, summaries };
	};

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
		});
		assert.ok(validSummary(off), JSON.stringify(validSummary.errors));

		const noGeo = await make({ available: { country: false, asn: false } }).api.getSummary(admin);
		assert.equal(noGeo.top_country_today, null);
		assert.equal(noGeo.requests_today, 3);
	});
});
