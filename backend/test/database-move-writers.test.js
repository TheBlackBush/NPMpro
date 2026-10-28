import assert from "node:assert/strict";
import { it } from "node:test";
import { geoipUpdateSettled, runConfiguredGeoipUpdate } from "../lib/geoip/run.js";
import { createGeoipService } from "../lib/geoip/service.js";
import { createTrafficService } from "../lib/traffic/service.js";

const silent = { error: () => {}, warn: () => {}, info: () => {} };
const turn = () => new Promise((resolve) => setImmediate(resolve));
const writerRunning = (name) => (error) =>
	error.code === "writer-running" && error.status === 409 && error.details === name;

const line = (host, ip = "203.0.113.7") =>
	`[24/Oct/2026:10:15:30 +0200] ${host} ${ip} 0.012 "GET / HTTP/2.0" 200 100 "-" "curl/8" "-" "text/html" TLSv1.3 TLS_AES_128_GCM_SHA256 X25519 -`;

const read = (lines, offset) => ({ lines, state: { inode: 1, offset }, missing: false, dropped: 0 });

const traffic = (results) => {
	const intervals = new Set();
	const store = {
		calls: [],
		flushed: [],
		gate: null,
		async flush(batch) {
			this.calls.push("flush");
			if (this.gate) await this.gate;
			this.flushed.push(batch.minutes.reduce((n, row) => n + row.requests, 0));
		},
		rollUpAndPrune() {
			this.calls.push("rollUp");
			return Promise.resolve();
		},
		deleteVisitors: () => Promise.resolve(),
		deleteIps: () => Promise.resolve(),
		visitorDayHashes: () => Promise.resolve([]),
	};
	const saved = [];
	const service = createTrafficService({
		store,
		geo: { available: () => ({ country: false, asn: false }), lookup: () => null },
		getConfig: () =>
			Promise.resolve({
				values: { traffic_enabled: true, retention_days: 30, show_ips: false, unique_visitors: false },
			}),
		loadState: () => Promise.resolve(null),
		saveState: (state) => {
			saved.push(state.offset);
			return Promise.resolve();
		},
		loadHosts: () => Promise.resolve([{ id: 1, type: "proxy", domain_names: ["example.com"] }]),
		createReader: () => ({
			read: () => Promise.resolve(results.shift() ?? read([], 0)),
		}),
		timers: {
			setInterval: (fn, ms) => {
				const timer = { fn, ms };
				intervals.add(timer);
				return timer;
			},
			clearInterval: (timer) => intervals.delete(timer),
		},
		log: silent,
	});
	return { service, store, saved, intervals: () => [...intervals].map((timer) => timer.ms).sort((a, b) => a - b) };
};

it("a traffic pause writes what was read, then writes nothing while the log is still counted", async () => {
	const t = traffic([read([line("example.com")], 100), read([line("example.com"), line("example.com")], 200)]);
	await t.service.start();
	await t.service.read();
	await t.service.pause();
	assert.deepEqual(t.store.flushed, [1]);
	assert.deepEqual(t.saved, [100]);
	const calls = t.store.calls.length;
	// the access log is read on during the pause; flushes and roll-ups skip
	await t.service.read();
	await t.service.flush();
	await t.service.maintain();
	assert.equal(t.store.calls.length, calls);
	assert.deepEqual(t.saved, [100]);
	// resume writes nothing at once, the next flush writes what was counted meanwhile and the newer position
	t.service.resume();
	assert.deepEqual(t.store.flushed, [1]);
	await t.service.flush();
	assert.deepEqual(t.store.flushed, [1, 2]);
	assert.deepEqual(t.saved, [100, 200]);
});

it("stopping while paused writes nothing, the lines are read again from the saved position", async () => {
	const t = traffic([read([line("example.com")], 100), read([line("example.com")], 200)]);
	await t.service.start();
	await t.service.read();
	await t.service.pause();
	await t.service.read();
	await t.service.stop();
	assert.deepEqual(t.store.flushed, [1]);
	assert.deepEqual(t.saved, [100]);
});

it("a traffic pause waits for a running flush and past its time limit stays unpaused", async () => {
	const t = traffic([read([line("example.com")], 100), read([line("example.com")], 200)]);
	await t.service.start();
	await t.service.read();
	let open;
	t.store.gate = new Promise((resolve) => {
		open = resolve;
	});
	const flushing = t.service.flush();
	await turn();
	await assert.rejects(t.service.pause({ timeoutMs: 20 }), writerRunning("Traffic statistics"));
	open();
	t.store.gate = null;
	await flushing;
	await turn();
	// not paused: the next flush writes
	await t.service.read();
	await t.service.flush();
	assert.deepEqual(t.store.flushed, [1, 1]);
	assert.deepEqual(t.saved, [100, 200]);
});

it("a traffic pause and resume with nothing counted write nothing and keep the timers", async () => {
	const t = traffic([]);
	await t.service.start();
	const timers = t.intervals();
	const calls = [...t.store.calls];
	await t.service.pause();
	t.service.resume();
	assert.deepEqual(t.store.calls, calls);
	assert.deepEqual(t.saved, []);
	assert.deepEqual(t.intervals(), timers);
});

it("the GeoIP checks start no update while paused and do again after resume", async () => {
	let runs = 0;
	const service = createGeoipService({
		geoip: { reload: () => Promise.resolve() },
		runUpdate: () => {
			runs++;
			return Promise.resolve({ ok: true, updated: [] });
		},
		getConfig: () => Promise.resolve({ values: { account_id: "1", license_key: "k", last_update: null } }),
		log: silent,
	});
	service.pause();
	assert.equal(await service.check(), null);
	assert.equal(runs, 0);
	service.resume();
	await service.check();
	assert.equal(runs, 1);
});

it("a GeoIP pause that comes while the settings are read starts no update", async () => {
	let runs = 0;
	let answer;
	const service = createGeoipService({
		geoip: { reload: () => Promise.resolve() },
		runUpdate: () => {
			runs++;
			return Promise.resolve({ ok: true, updated: [] });
		},
		getConfig: () =>
			new Promise((resolve) => {
				answer = resolve;
			}),
		log: silent,
	});
	const checking = service.check();
	await turn();
	service.pause();
	answer({ values: { account_id: "1", license_key: "k", last_update: null } });
	assert.equal(await checking, null);
	assert.equal(runs, 0);
});

it("the GeoIP wait covers a running update and the one queued after it, a failed one counts as done", async () => {
	assert.equal(await geoipUpdateSettled(), undefined);
	const recorded = [];
	const gates = [];
	const args = {
		geoip: { reload: () => Promise.resolve() },
		dir: "/x",
		getConfig: () => Promise.resolve({ values: { account_id: "1", license_key: "k", editions: ["GeoLite2-ASN"] } }),
		recordResult: (result) => {
			recorded.push(result.ok);
			return Promise.resolve();
		},
		update: () =>
			new Promise((resolve, reject) => {
				gates.push({ resolve, reject });
			}),
	};
	const first = runConfiguredGeoipUpdate(args).catch(() => null);
	const second = runConfiguredGeoipUpdate(args);
	let settled = false;
	const waiting = geoipUpdateSettled().then(() => {
		settled = true;
	});
	await turn();
	gates[0].reject(new Error("MaxMind is down"));
	await first;
	await turn();
	await turn();
	assert.equal(settled, false);
	gates[1].resolve({ ok: true, updated: [] });
	await second;
	await waiting;
	assert.equal(settled, true);
	assert.deepEqual(recorded, [true]);
});
