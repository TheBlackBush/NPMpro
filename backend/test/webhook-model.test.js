import assert from "node:assert/strict";
import { it } from "node:test";
import { startApi } from "./support/api.js";

const NOW = "2026-11-28 10:00:00";

it("the model parses events and switches, hides the url and secrets, reads a corrupt event list as empty and writes events as text", async () => {
	const api = await startApi();
	try {
		const { default: Webhook } = await import("../models/webhook.js");
		await api.db("npmpro_webhook").insert({
			created_on: NOW,
			modified_on: NOW,
			name: "m",
			url: "sealed-url",
			url_hint: "https://example.com/hook",
			secret: "sealed-secret",
			previous_secret: "sealed-old",
			events: '["backup.failed","cert.expiring"]',
			enabled: 0,
		});
		const webhook = await Webhook.query().findOne({ name: "m" });
		assert.deepEqual(webhook.events, ["backup.failed", "cert.expiring"]);
		assert.equal(webhook.enabled, false);
		assert.equal(webhook.verify_tls, true);
		assert.equal(webhook.url, "sealed-url");
		const json = webhook.toJSON();
		for (const key of ["url", "secret", "previous_secret"]) assert.equal(key in json, false, key);
		assert.equal(json.url_hint, "https://example.com/hook");

		const created = await Webhook.query().insertAndFetch({
			name: "n",
			url: "u",
			url_hint: "https://example.com",
			secret: "s",
			events: ["*"],
		});
		assert.deepEqual(created.events, ["*"]);
		assert.equal((await api.db("npmpro_webhook").where({ name: "n" }).first()).events, '["*"]');
		const base = { created_on: NOW, modified_on: NOW, url: "u", url_hint: "https://example.com", secret: "s" };
		await api.db("npmpro_webhook").insert([
			{ ...base, name: "bad", events: "{not json" },
			{ ...base, name: "obj", events: '{"a":1}' },
		]);
		for (const name of ["bad", "obj"]) assert.deepEqual((await Webhook.query().findOne({ name })).events, []);

		const good = await Webhook.query().insertAndFetch({ ...base, name: "good", events: ["*"] });
		await Webhook.query().patchAndFetchById(good.id, { events: ["backup.failed"] });
		const row = await api.db("npmpro_webhook").where({ id: good.id }).first();
		assert.equal(row.events, '["backup.failed"]');
		assert.notEqual(row.modified_on, NOW);
		await Webhook.query()
			.findById(good.id)
			.patch({ events: ["*"] });
		assert.equal((await api.db("npmpro_webhook").where({ id: good.id }).first()).events, '["*"]');
	} finally {
		await api.stop();
	}
});
