import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createNotifyService } from "../lib/notify/service.js";
import { createSweep } from "../lib/notify/sweep.js";
import { migratedSqlite } from "./support/database.js";

const DELIVERY = "npmpro_notification_delivery";
const STATE = "npmpro_notification_state";
const START = Date.parse("2026-11-26T10:00:00Z");
const HOUR = 3_600_000;
const BOOM = /sweep reminders failed: broken/u;
const SECRETS = /hunter2|abc/u;
const WRITER_RUNNING = /still running/u;

let db;
const clock = { at: START, now: () => clock.at };
const turn = () => new Promise((resolve) => setImmediate(resolve));
const logOf = () => {
	const lines = [];
	return { lines, warn: (line) => lines.push(line), debug: () => {}, error: (line) => lines.push(line) };
};
const timers = () => {
	const list = [];
	return {
		list,
		setTimeout: (fn, ms) => {
			const timer = { fn, ms, cleared: false, unref: () => {} };
			list.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			timer.cleared = true;
		},
	};
};

before(async () => {
	db = await migratedSqlite();
});
beforeEach(async () => {
	clock.at = START;
	await db.knex(DELIVERY).delete();
	await db.knex(STATE).delete();
});
after(() => db.cleanup());

const fakes = (calls) => ({
	stateStore: {
		dueReminders: () => {
			calls.push("reminders");
			return Promise.resolve([{ type: "certificate.expiring", data: { id: 5, reminder: true } }]);
		},
		prune: async () => calls.push("prune"),
	},
	queue: {
		pruneMail: async (days) => calls.push(`pruneMail ${days}`),
		pruneWebhooks: async (keep, days) => calls.push(`pruneWebhooks ${keep} ${days}`),
		clearOldPayloads: async (days) => calls.push(`payloads ${days}`),
	},
	notify: { deliver: async (type, data, object) => calls.push(`deliver ${type} ${data.reminder} ${object}`) },
});

describe("the sweep", () => {
	it("runs the checks, then the reminders, then the prunes", async () => {
		const calls = [];
		const sweep = createSweep({
			...fakes(calls),
			checks: [async () => calls.push("check 1"), async () => calls.push("check 2")],
		});
		await sweep.runOnce();
		assert.deepEqual(calls, [
			"check 1",
			"check 2",
			"reminders",
			"deliver certificate.expiring true 5",
			"prune",
			"pruneMail 30",
			"pruneWebhooks 100 30",
			"payloads 7",
		]);
	});

	it("a check that throws does not stop the reminders and is logged without a secret", async () => {
		const calls = [];
		const log = logOf();
		const sweep = createSweep({
			...fakes(calls),
			checks: [
				() => {
					throw new Error("failed at https://user:hunter2@example.test/x?token=abc");
				},
			],
			log,
		});
		await sweep.runOnce();
		assert.ok(calls.includes("reminders"));
		assert.ok(calls.includes("payloads 7"));
		assert.equal(log.lines.length, 1);
		assert.doesNotMatch(log.lines[0], SECRETS);
	});

	it("a failing reminder read still prunes", async () => {
		const calls = [];
		const log = logOf();
		const base = fakes(calls);
		const sweep = createSweep({
			...base,
			stateStore: {
				...base.stateStore,
				dueReminders: () => Promise.reject(new Error("broken")),
			},
			log,
		});
		await sweep.runOnce();
		assert.deepEqual(calls, ["prune", "pruneMail 30", "pruneWebhooks 100 30", "payloads 7"]);
		assert.match(log.lines[0], BOOM);
	});

	it("starts with a first pass after 2 minutes, then every hour, and stops", async () => {
		const calls = [];
		const clk = timers();
		const sweep = createSweep({ ...fakes(calls), clock: clk });
		assert.equal(sweep.start(), true);
		assert.equal(sweep.start(), false);
		assert.deepEqual(
			clk.list.map((timer) => timer.ms),
			[120_000],
		);
		await clk.list[0].fn();
		assert.deepEqual(
			clk.list.map((timer) => timer.ms),
			[120_000, HOUR],
		);
		assert.ok(calls.includes("prune"));
		sweep.stop();
		assert.equal(clk.list[1].cleared, true);
	});

	it("skips passes while paused, waits for a running one, and runs again after resume", async () => {
		const calls = [];
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		const sweep = createSweep({ ...fakes(calls), checks: [() => gate] });
		const running = sweep.runOnce();
		let paused = false;
		const pausing = sweep.pause().then(() => {
			paused = true;
		});
		await turn();
		assert.equal(paused, false);
		release();
		await pausing;
		await running;
		const callsBefore = calls.length;
		await sweep.runOnce();
		assert.equal(calls.length, callsBefore);
		sweep.resume();
		await sweep.runOnce();
		assert.ok(calls.length > callsBefore);
	});
});

describe("the notify service", () => {
	const serviceOf = (extra = {}) => {
		const log = logOf();
		return { log, ...createNotifyService({ knex: db.knex, log, clock, ...extra }) };
	};

	it("emit queues a row before the worker starts, and initNotify puts sending rows back", async () => {
		const service = serviceOf();
		service.notify.registerChannel({
			id: "mail",
			accepts: () => true,
			targets: async () => [{ recipient: "a@example.test" }],
			send: async (rows) => rows.map((row) => ({ id: row.id, ok: true })),
		});
		await service.notify.emit("host.created", { id: 1, type: "proxy_host" });
		const [queued] = await db.knex(DELIVERY);
		assert.equal(queued.status, "pending");
		await db.knex(DELIVERY).update({ status: "sending" });
		await service.initNotify();
		try {
			assert.equal((await db.knex(DELIVERY).first()).status, "pending");
		} finally {
			service.worker.stop();
			service.sweep.stop();
		}
	});

	it("a second initNotify leaves a row that is being sent alone and starts nothing again", async () => {
		const service = serviceOf();
		const sent = [];
		service.notify.registerChannel({
			id: "mail",
			accepts: () => true,
			targets: async () => [{ recipient: "a@example.test" }],
			send: (rows) => {
				sent.push(rows.length);
				return Promise.resolve(rows.map((row) => ({ id: row.id, ok: true })));
			},
		});
		await service.initNotify();
		try {
			await service.worker.runOnce();
			await service.notify.emit("host.created", { id: 1, type: "proxy_host" });
			await db.knex(DELIVERY).update({ status: "sending" });
			await service.initNotify();
			assert.equal((await db.knex(DELIVERY).first()).status, "sending");
			await service.worker.runOnce();
			assert.deepEqual(sent, []);
		} finally {
			service.worker.stop();
			service.sweep.stop();
		}
	});

	it("an event queued before initNotify is sent once after it, and nothing before it", async () => {
		const service = serviceOf();
		const sent = [];
		service.notify.registerChannel({
			id: "mail",
			accepts: () => true,
			targets: async () => [{ recipient: "a@example.test" }],
			send: (rows) => {
				sent.push(rows.map((row) => row.id));
				return Promise.resolve(rows.map((row) => ({ id: row.id, ok: true })));
			},
		});
		await service.notify.emit("host.created", { id: 1, type: "proxy_host" });
		await service.worker.runOnce();
		await turn();
		assert.deepEqual(sent, []);
		assert.equal((await db.knex(DELIVERY).first()).status, "pending");
		await service.initNotify();
		try {
			await service.worker.runOnce();
			await service.worker.runOnce();
			assert.equal(sent.length, 1);
			assert.equal((await db.knex(DELIVERY).first()).status, "sent");
		} finally {
			service.worker.stop();
			service.sweep.stop();
		}
	});

	it("cleanupAfterRestore removes the states of objects that no longer exist and keeps the others", async () => {
		const service = serviceOf();
		const [certificate] = await db
			.knex("certificate")
			.insert({
				owner_user_id: 1,
				provider: "other",
				created_on: new Date(),
				modified_on: new Date(),
				expires_on: new Date(),
				domain_names: "[]",
				meta: "{}",
			})
			.returning("id");
		const certId = certificate.id ?? certificate;
		const bad = { event: "certificate.expiring", state: "soon", data: {} };
		for (const id of [certId, 99_999]) await service.stateStore.report({ ...bad, objectId: id });
		await service.stateStore.report({ event: "geoip.failed", objectId: "geoip", state: "bad", data: {} });
		await service.stateStore.report({ event: "host.config_error", objectId: "proxy_host:424242", state: "bad" });
		await service.cleanupAfterRestore();
		const keys = (await db.knex(STATE).orderBy("key")).map((row) => row.key);
		assert.deepEqual(keys, [`certificate.expiring:${certId}`, "geoip.failed:geoip"]);
		await db.knex("certificate").where({ id: certId }).delete();
	});

	it("clearReplacedStates removes the states of the replaced types only, silently", async () => {
		const service = serviceOf();
		const bad = (event, objectId) => service.stateStore.report({ event, objectId, state: "bad", data: {} });
		await bad("host.config_error", "proxy_host:7");
		await bad("host.config_error", "proxy_host:7:location");
		await bad("host.config_error", "stream:7");
		await bad("certificate.expiring", 3);
		await bad("certificate.renewal_failed", 3);
		await bad("ddns.record_failed", 5);
		await bad("ddns.record_stopped", 5);
		await bad("backup.failed", 2);
		await bad("geoip.failed", "geoip");
		await service.clearReplacedStates(["proxy_hosts", "certificates", "ddns", "backup_schedules", "users"]);
		assert.deepEqual(
			(await db.knex(STATE).orderBy("key")).map((row) => row.key),
			["geoip.failed:geoip", "host.config_error:stream:7"],
		);
		assert.deepEqual(await db.knex(DELIVERY), []);
	});

	it("clearReplacedStates logs a failure and never throws", async () => {
		const service = serviceOf();
		service.stateStore.clearMatching = () => Promise.reject(new Error("store broke"));
		await service.clearReplacedStates(["streams"]);
		assert.ok(service.log.lines.some((line) => line.includes("store broke")));
	});

	it("a restore waits for a slow send and the worker runs again after resume", async () => {
		const service = serviceOf();
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		service.notify.registerChannel({
			id: "mail",
			accepts: () => true,
			targets: async () => [{ recipient: "a@example.test" }],
			send: async (rows) => {
				await gate;
				return rows.map((row) => ({ id: row.id, ok: true }));
			},
		});
		await service.notify.emit("host.created", { id: 1, type: "proxy_host" });
		service.worker.start();
		const running = service.worker.runOnce();
		await turn();
		let paused = false;
		const pausing = service.pauseNotify().then(() => {
			paused = true;
		});
		await turn();
		assert.equal(paused, false);
		release();
		await pausing;
		await running;
		assert.equal((await db.knex(DELIVERY).first()).status, "sent");
		assert.equal(service.worker.paused(), true);
		service.resumeNotify();
		assert.equal(service.worker.paused(), false);
		service.worker.stop();
	});

	it("a pause that times out leaves the worker as it was", async () => {
		const service = serviceOf();
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		service.notify.registerChannel({
			id: "mail",
			accepts: () => true,
			targets: async () => [{ recipient: "a@example.test" }],
			send: async (rows) => {
				await gate;
				return rows.map((row) => ({ id: row.id, ok: true }));
			},
		});
		await service.notify.emit("host.created", { id: 1, type: "proxy_host" });
		service.worker.start();
		const running = service.worker.runOnce();
		await turn();
		await assert.rejects(service.pauseNotify({ timeoutMs: 5 }), WRITER_RUNNING);
		assert.equal(service.worker.paused(), false);
		release();
		await running;
		service.worker.stop();
	});
});
