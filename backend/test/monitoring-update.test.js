import assert from "node:assert/strict";
import { it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createMonitoringUpdater, createSerializer } from "../internal/monitoring-update.js";

const ok = () => Promise.resolve();

const fakeStore = (initial = {}) => {
	let meta = structuredClone(initial);
	return {
		get: () => meta,
		readStored: async () => {
			await sleep(5);
			return structuredClone(meta);
		},
		saveStored: async (next) => {
			await sleep(5);
			meta = structuredClone(next);
		},
	};
};

it("keeps both changes of two concurrent updates", async () => {
	const store = fakeStore({ traffic_enabled: false, retention_days: 30 });
	const switched = [];
	const update = createMonitoringUpdater({
		readStored: store.readStored,
		saveStored: store.saveStored,
		deleteIps: ok,
		env: {},
		hooks: {
			onTrafficEnabledChange: async (enabled) => {
				await sleep(20);
				switched.push(enabled);
			},
			onShowIpsOff: ok,
		},
	});
	await Promise.all([update({ traffic_enabled: true }), update({ retention_days: 90 })]);
	assert.deepEqual(store.get(), { traffic_enabled: true, retention_days: 90 });
	assert.deepEqual(switched, [true]);
});

it("does not save and keeps going after a failed hook", async () => {
	const store = fakeStore({ traffic_enabled: false });
	const update = createMonitoringUpdater({
		...store,
		deleteIps: ok,
		env: {},
		hooks: { onTrafficEnabledChange: () => Promise.reject(new Error("nginx bad")), onShowIpsOff: ok },
	});
	await assert.rejects(update({ traffic_enabled: true }), {
		name: "ValidationError",
		message: "Could not switch the access log: nginx bad",
	});
	assert.deepEqual(store.get(), { traffic_enabled: false });
	await update({ retention_days: 60 });
	assert.deepEqual(store.get(), { traffic_enabled: false, retention_days: 60 });
});

it("switches the access log back when the save fails", async () => {
	const switched = [];
	const update = createMonitoringUpdater({
		readStored: () => Promise.resolve({ traffic_enabled: false }),
		saveStored: () => Promise.reject(new Error("db down")),
		deleteIps: ok,
		env: {},
		hooks: {
			onTrafficEnabledChange: (enabled) => {
				switched.push(enabled);
				return Promise.resolve();
			},
			onShowIpsOff: ok,
		},
	});
	await assert.rejects(update({ traffic_enabled: true }), { message: "db down" });
	assert.deepEqual(switched, [true, false]);
});

it("switches the access log back when deleting the IPs fails", async () => {
	const store = fakeStore({ traffic_enabled: false, show_ips: true });
	const switched = [];
	const update = createMonitoringUpdater({
		...store,
		deleteIps: () => Promise.reject(new Error("db locked")),
		env: {},
		hooks: {
			onTrafficEnabledChange: (enabled) => {
				switched.push(enabled);
				return Promise.resolve();
			},
			onShowIpsOff: ok,
		},
	});
	await assert.rejects(update({ traffic_enabled: true, show_ips: false }), {
		name: "ValidationError",
		message: "Could not delete the stored IP addresses, the setting was not changed: db locked",
	});
	assert.deepEqual(switched, [true, false]);
	assert.deepEqual(store.get(), { traffic_enabled: false, show_ips: true });
});

it("rethrows the save error when switching back fails too", async () => {
	let calls = 0;
	const update = createMonitoringUpdater({
		readStored: () => Promise.resolve({}),
		saveStored: () => Promise.reject(new Error("db down")),
		deleteIps: ok,
		env: {},
		hooks: {
			onTrafficEnabledChange: () => {
				calls += 1;
				return calls === 1 ? Promise.resolve() : Promise.reject(new Error("revert failed"));
			},
			onShowIpsOff: ok,
		},
	});
	await assert.rejects(update({ traffic_enabled: true }), { message: "db down" });
	assert.equal(calls, 2);
});

it("ignores locked keys and does not call the hook for them", async () => {
	const store = fakeStore({});
	let calls = 0;
	const update = createMonitoringUpdater({
		...store,
		deleteIps: ok,
		env: { TRAFFIC_STATS: "true" },
		hooks: {
			onTrafficEnabledChange: () => {
				calls += 1;
				return Promise.resolve();
			},
			onShowIpsOff: ok,
		},
	});
	await update({ traffic_enabled: false, show_ips: true });
	assert.deepEqual(store.get(), { show_ips: true });
	assert.equal(calls, 0);
});

it("runs serialized functions in order, also after a failure", async () => {
	const serialize = createSerializer();
	const order = [];
	const a = serialize(async () => {
		await sleep(15);
		order.push("a");
		throw new Error("a failed");
	});
	const b = serialize(() => {
		order.push("b");
		return Promise.resolve("b");
	});
	await assert.rejects(a, { message: "a failed" });
	assert.equal(await b, "b");
	assert.deepEqual(order, ["a", "b"]);
});
