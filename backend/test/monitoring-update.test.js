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

it("runs onShowIpsOn after saving show_ips as on, and only then", async () => {
	const store = fakeStore({ show_ips: false });
	const events = [];
	const update = createMonitoringUpdater({
		readStored: store.readStored,
		saveStored: async (next) => {
			await store.saveStored(next);
			events.push("save");
		},
		deleteIps: ok,
		env: {},
		hooks: {
			onTrafficEnabledChange: ok,
			onShowIpsOff: ok,
			onShowIpsOn: () => {
				events.push("on");
				return Promise.reject(new Error("only logged"));
			},
		},
	});
	await update({ show_ips: true });
	assert.deepEqual(events, ["save", "on"]);
	await update({ show_ips: true });
	await update({ retention_days: 60 });
	assert.deepEqual(events, ["save", "on", "save", "save"]);
	assert.deepEqual(store.get(), { show_ips: true, retention_days: 60 });
});

it("does not run onShowIpsOn when the env locks show_ips off", async () => {
	const store = fakeStore({ show_ips: false });
	let calls = 0;
	const update = createMonitoringUpdater({
		...store,
		deleteIps: ok,
		env: { TRAFFIC_SHOW_IPS: "false" },
		hooks: {
			onTrafficEnabledChange: ok,
			onShowIpsOff: ok,
			onShowIpsOn: () => {
				calls++;
				return ok();
			},
		},
	});
	await update({ show_ips: true });
	assert.equal(calls, 0);
});

it("runs onUniqueVisitorsOff before the save", async () => {
	const store = fakeStore({ unique_visitors: true });
	const events = [];
	const update = createMonitoringUpdater({
		readStored: store.readStored,
		saveStored: async (next) => {
			await store.saveStored(next);
			events.push("save");
		},
		deleteIps: ok,
		env: {},
		hooks: {
			onTrafficEnabledChange: ok,
			onShowIpsOff: ok,
			onUniqueVisitorsOff: async () => {
				events.push("off");
			},
		},
	});
	await update({ unique_visitors: false });
	assert.deepEqual(events, ["off", "save"]);
	assert.deepEqual(store.get(), { unique_visitors: false });
});

it("saves nothing when onUniqueVisitorsOff rejects", async () => {
	const store = fakeStore({ unique_visitors: true });
	const update = createMonitoringUpdater({
		...store,
		deleteIps: ok,
		env: {},
		hooks: {
			onTrafficEnabledChange: ok,
			onShowIpsOff: ok,
			onUniqueVisitorsOff: () => Promise.reject(new Error("disk full")),
		},
	});
	await assert.rejects(update({ unique_visitors: false }), {
		message: "Could not delete the stored visitor hashes, the setting was not changed: disk full",
	});
	assert.deepEqual(store.get(), { unique_visitors: true });
});

it("runs onUniqueVisitorsOn after saving, and only on false to true", async () => {
	const store = fakeStore({ unique_visitors: false });
	const events = [];
	const update = createMonitoringUpdater({
		readStored: store.readStored,
		saveStored: async (next) => {
			await store.saveStored(next);
			events.push("save");
		},
		deleteIps: ok,
		env: {},
		hooks: {
			onTrafficEnabledChange: ok,
			onShowIpsOff: ok,
			onUniqueVisitorsOff: ok,
			onUniqueVisitorsOn: () => {
				events.push("on");
				return Promise.reject(new Error("only logged"));
			},
		},
	});
	await update({ unique_visitors: true });
	await update({ unique_visitors: true });
	assert.deepEqual(events, ["save", "on", "save"]);
});

it("ignores unique_visitors when the env locks it", async () => {
	const store = fakeStore({ unique_visitors: true });
	let calls = 0;
	const count = () => {
		calls++;
		return ok();
	};
	const update = createMonitoringUpdater({
		...store,
		deleteIps: ok,
		env: { TRAFFIC_UNIQUE_VISITORS: "true" },
		hooks: { onTrafficEnabledChange: ok, onShowIpsOff: ok, onUniqueVisitorsOff: count, onUniqueVisitorsOn: count },
	});
	await update({ unique_visitors: false });
	assert.equal(calls, 0);
	assert.deepEqual(store.get(), { unique_visitors: true });
});

it("runs both off hooks before one save", async () => {
	const store = fakeStore({ show_ips: true, unique_visitors: true });
	const events = [];
	const update = createMonitoringUpdater({
		readStored: store.readStored,
		saveStored: async (next) => {
			await store.saveStored(next);
			events.push("save");
		},
		deleteIps: ok,
		env: {},
		hooks: {
			onTrafficEnabledChange: ok,
			onShowIpsOff: async () => {
				events.push("ips");
			},
			onUniqueVisitorsOff: async () => {
				events.push("visitors");
			},
		},
	});
	await update({ show_ips: false, unique_visitors: false });
	assert.deepEqual(events, ["ips", "visitors", "save"]);
});

it("saves visitors_cap unless the env locks it", async () => {
	const hooks = { onTrafficEnabledChange: ok, onShowIpsOff: ok, onUniqueVisitorsOff: ok, onUniqueVisitorsOn: ok };
	const store = fakeStore({});
	await createMonitoringUpdater({ ...store, deleteIps: ok, env: {}, hooks })({ visitors_cap: 50000 });
	assert.deepEqual(store.get(), { visitors_cap: 50000 });
	const locked = fakeStore({ visitors_cap: 2000 });
	await createMonitoringUpdater({ ...locked, deleteIps: ok, env: { TRAFFIC_VISITORS_CAP: "3000" }, hooks })({
		visitors_cap: 50000,
	});
	assert.deepEqual(locked.get(), { visitors_cap: 2000 });
});

const deleteStatsSetup = ({ initial = { traffic_enabled: true }, env = {}, deleteFails = false } = {}) => {
	const store = fakeStore(initial);
	const events = [];
	const update = createMonitoringUpdater({
		readStored: store.readStored,
		saveStored: async (next) => {
			await store.saveStored(next);
			events.push("save");
		},
		deleteIps: () => {
			events.push("ips-deleted");
			return Promise.resolve();
		},
		env,
		hooks: {
			onTrafficEnabledChange: (enabled) => {
				events.push(`traffic-${enabled}`);
				return Promise.resolve();
			},
			onDeleteStats: () => {
				events.push("stats");
				return deleteFails ? Promise.reject(new Error("db locked")) : Promise.resolve();
			},
			onShowIpsOff: ok,
			onUniqueVisitorsOff: () => {
				events.push("visitors");
				return Promise.resolve();
			},
		},
	});
	return { store, events, update };
};

it("deletes the statistics after stopping the reader and before the save", async () => {
	const t = deleteStatsSetup();
	const saved = await t.update({ traffic_enabled: false, delete_stats: true });
	assert.deepEqual(t.events, ["traffic-false", "stats", "save"]);
	// delete_stats is an action, never stored
	assert.deepEqual(saved, { traffic_enabled: false });
	assert.deepEqual(t.store.get(), { traffic_enabled: false });
});

it("combines the statistics delete with the IP and visitor off hooks in one update", async () => {
	const t = deleteStatsSetup({ initial: { traffic_enabled: true, show_ips: true, unique_visitors: true } });
	await t.update({ traffic_enabled: false, show_ips: false, unique_visitors: false, delete_stats: true });
	assert.deepEqual(t.events, ["traffic-false", "stats", "ips-deleted", "visitors", "save"]);
});

it("saves nothing and switches the access log back when the statistics delete fails", async () => {
	const t = deleteStatsSetup({ deleteFails: true });
	await assert.rejects(t.update({ traffic_enabled: false, delete_stats: true }), {
		name: "ValidationError",
		message: "Could not delete the stored statistics, the setting was not changed: db locked",
	});
	assert.deepEqual(t.events, ["traffic-false", "stats", "traffic-true"]);
	assert.deepEqual(t.store.get(), { traffic_enabled: true });
});

it("refuses delete_stats unless traffic_enabled goes from true to false", async () => {
	const cases = [
		[{ traffic_enabled: true }, { delete_stats: true }],
		[{ traffic_enabled: true }, { traffic_enabled: true, delete_stats: true }],
		[{ traffic_enabled: false }, { traffic_enabled: false, delete_stats: true }],
		[{ traffic_enabled: false }, { traffic_enabled: true, delete_stats: true }],
		[{}, { retention_days: 60, delete_stats: true }],
	];
	for (const [initial, body] of cases) {
		const t = deleteStatsSetup({ initial });
		await assert.rejects(t.update(body), {
			name: "ValidationError",
			message: "delete_stats can only be sent together with traffic_enabled switching from true to false",
		});
		assert.deepEqual(t.events, [], JSON.stringify(body));
		assert.deepEqual(t.store.get(), initial);
	}
});

it("refuses delete_stats while TRAFFIC_STATS locks traffic_enabled", async () => {
	const t = deleteStatsSetup({ env: { TRAFFIC_STATS: "true" } });
	await assert.rejects(t.update({ traffic_enabled: false, delete_stats: true }), {
		name: "ValidationError",
		message: "delete_stats cannot be used while an environment variable sets traffic_enabled",
	});
	assert.deepEqual(t.events, []);
});

it("ignores delete_stats: false", async () => {
	const t = deleteStatsSetup();
	await t.update({ retention_days: 60, delete_stats: false });
	assert.deepEqual(t.events, ["save"]);
	assert.deepEqual(t.store.get(), { traffic_enabled: true, retention_days: 60 });
});
