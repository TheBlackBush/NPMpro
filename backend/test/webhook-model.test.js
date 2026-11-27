import assert from "node:assert/strict";
import { it } from "node:test";
import { startApi } from "./support/api.js";

const NOW = "2026-11-28 10:00:00";

it("the model parses events and switches and never returns the url or the secrets", async () => {
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
	} finally {
		await api.stop();
	}
});
