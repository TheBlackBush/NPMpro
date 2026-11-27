import assert from "node:assert/strict";
import { it } from "node:test";
import { createQueue } from "../../lib/notify/queue.js";

const NOW = "2026-11-26 10:00:00";

// The webhook store and the prune of the delivery queue on a real database server: `enabled` as a Postgres boolean and
// a MySQL tinyint, the affected-row count of the conditional disable, distinct and the per-webhook delete. ctx holds
// knex (migrated) and createWebhookStore (imported after the database settings, as the models read them once).
const webhookStoreTests = (ctx) => {
	it("runs the webhook store and the prune: enabled switches, the patch count, distinct and the per-webhook delete", async () => {
		const { knex, createWebhookStore } = ctx;
		const deliveries = () => knex("npmpro_notification_delivery");
		await deliveries().delete();
		await knex("npmpro_webhook").delete();
		const day = 24 * 3_600_000;
		const clock = { at: Date.parse("2026-11-26T10:00:00Z"), now: () => clock.at };
		const queue = createQueue({ knex, clock });
		const store = createWebhookStore({ knex, queue, clock });
		const hook = async (name, extra = {}) => {
			const [inserted] = await knex("npmpro_webhook")
				.insert({
					created_on: NOW,
					modified_on: NOW,
					name,
					url: "sealed-url",
					url_hint: "https://hooks.example.com/",
					secret: "sealed-secret",
					events: '["*"]',
					...extra,
				})
				.returning("id");
			return Number(inserted?.id ?? inserted);
		};
		const all = await hook("all");
		const off = await hook("off", { enabled: false });
		const one = await hook("one", { events: '["backup.restored"]' });

		const ids = async (type) => (await store.forEvent(type)).map((item) => item.id).sort((a, b) => a - b);
		assert.deepEqual(await ids("backup.restored"), [all, one]);
		assert.deepEqual(await ids("notification.test"), []);
		assert.equal((await store.get(off)).enabled, false);

		// the failing period: set once, longer than 3 days disables, a success ends it
		assert.equal(await store.recordFailure(one), false);
		clock.at += 4 * day;
		assert.equal(await store.recordFailure(one), true);
		await store.recordSuccess(one);
		const healthy = await store.get(one);
		assert.equal(healthy.failing_since, null);
		assert.notEqual(healthy.last_success_on, null);

		const row = (id, target, channel = "webhook") => ({
			message_id: `m${id}`,
			event: "backup.restored",
			channel,
			target_id: target,
			payload: {},
		});
		// old final rows of `one`, newer final rows of `all`, one pending row each and a final mail row
		clock.at -= 40 * day;
		await queue.add([row(1, one), row(2, one), row(3, null, "mail")]);
		clock.at += 40 * day;
		await queue.add([row(4, all), row(5, all), row(6, all), row(7, all), row(8, one), row(9, all)]);
		await deliveries().whereIn("message_id", ["m1", "m2", "m3"]).update({ status: "failed" });
		await deliveries().whereIn("message_id", ["m4", "m5", "m6", "m7"]).update({ status: "sent" });
		await queue.pruneWebhooks(2, 30);
		const left = async () => (await deliveries().orderBy("id")).map((item) => [item.message_id, item.status]);
		assert.deepEqual(await left(), [
			["m3", "failed"],
			["m6", "sent"],
			["m7", "sent"],
			["m8", "pending"],
			["m9", "pending"],
		]);

		// a disable is one conditional update: the second one changes nothing; the pending rows are dropped
		assert.equal(await store.disable(all, "gone"), true);
		assert.equal(await store.disable(all, "gone"), false);
		const disabled = await store.get(all);
		assert.equal(disabled.enabled, false);
		assert.equal(disabled.disabled_reason, "gone");
		assert.deepEqual(await ids("backup.restored"), [one]);
		assert.deepEqual((await left()).slice(-2), [
			["m8", "pending"],
			["m9", "dropped"],
		]);
		await deliveries().delete();
		await knex("npmpro_webhook").delete();
	});
};

export { webhookStoreTests };
