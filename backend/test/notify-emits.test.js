import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { startApi } from "./support/api.js";
import {
	acmeDirectory,
	certbotFails,
	certbotSucceeds,
	makeCertificate,
	makeExpiredCertificate,
} from "./support/certbot.js";

const CERTS = "/nginx/certificates";
const ACME = "https://acme.example.test/directory";
const STATE = "npmpro_notification_state";
const DAY = 86_400_000;
const WENT_WRONG = /Renewal went wrong/u;
const KEY_PATH = /private_key|\/accounts\//u;
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

let api;
let admin;
let pair;
let expired;
let internalCertificate;
let notify;
let stateStore;
let seen;

const requested = async (name) => {
	const made = await admin.post(CERTS, { provider: "letsencrypt", domain_names: [name] });
	if (made.status !== 201) throw new Error(made.text);
	return made.body;
};
const live = (id) => path.join(api.root, `data/tls/certbot/live/npm-${id}/fullchain.pem`);
const stale = (id, on = "2000-01-01 00:00:00") => api.db("certificate").where({ id }).update({ expires_on: on });
const eventsOf = (type, id) => seen.filter((one) => one.type === type && (id === undefined || one.data.id === id));
const rowsOf = () => api.db("certificate").orderBy("id");
const run = async () => {
	internalCertificate.intervalProcessing = false;
	return await internalCertificate.processExpiringHosts();
};

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME, NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("acme.example.test", "192.0.2.50");
	acmeDirectory(api, ACME);
	admin = await api.admin();
	pair = await makeCertificate(path.join(api.root, "fake"), "emit.example.com");
	expired = await makeExpiredCertificate(path.join(api.root, "fake"), "stuck.example.com");
	internalCertificate = (await import("../internal/certificate.js")).default;
	({ notify, stateStore } = await import("../internal/notify.js"));
	notify.registerChannel({
		id: "fake",
		accepts: () => true,
		targets: (envelope) => {
			seen.push(envelope);
			return Promise.resolve([]);
		},
	});
});
beforeEach(async () => {
	seen = [];
	await api.db(STATE).delete();
	await certbotSucceeds(api, pair);
});
after(() => api?.stop());

describe("certificate emit points", () => {
	it("a run with one renewed and one stuck certificate sends one renewed and one renewal_failed, then resolves", async () => {
		const renewed = await requested("renewed.example.com");
		const stuck = await requested("stuck.example.com");
		const healthy = await requested("healthy.example.com");
		await stale(renewed.id);
		await stale(stuck.id, "2020-06-01 00:00:00");
		await cp(expired.certificate, live(stuck.id));
		await certbotFails(api, "Renewal went wrong, see /data/tls/certbot/accounts/acme/abc/private_key.json");
		seen = [];
		assert.equal(await run(), undefined);

		assert.equal(eventsOf("certificate.renewed").length, 1);
		assert.equal(eventsOf("certificate.renewed")[0].data.id, renewed.id);
		const failed = eventsOf("certificate.renewal_failed");
		assert.equal(failed.length, 1);
		assert.equal(failed[0].data.id, stuck.id);
		assert.match(failed[0].data.error, WENT_WRONG);
		assert.doesNotMatch(failed[0].data.error, KEY_PATH);
		assert.equal(seen.filter((one) => one.data.id === healthy.id).length, 0);

		// the next run: the stuck certificate is renewed
		await certbotSucceeds(api, pair);
		await cp(pair.certificate, live(stuck.id));
		seen = [];
		await run();
		assert.equal(eventsOf("certificate.renewal_failed.resolved", stuck.id).length, 1);
		assert.equal(eventsOf("certificate.renewed", stuck.id).length, 1);
		assert.equal(eventsOf("certificate.renewal_failed").length, 0);
	});

	it("the expiry check sends soon once, nothing after a restart, and a delete clears the states", async () => {
		const [id] = await api.db("certificate").insert({
			owner_user_id: 1,
			created_on: "2026-01-01 00:00:00",
			modified_on: "2026-01-01 00:00:00",
			provider: "other",
			nice_name: "custom",
			domain_names: JSON.stringify(["custom.example.com"]),
			expires_on: sql(Date.now() + 3 * DAY),
			meta: "{}",
		});
		await internalCertificate.checkCertificateExpiry();
		const sent = eventsOf("certificate.expiring", id);
		assert.equal(sent.length, 1);
		assert.equal(sent[0].data.state, "soon");
		assert.ok([2, 3].includes(sent[0].data.days_left));

		await internalCertificate.checkCertificateExpiry();
		assert.equal(eventsOf("certificate.expiring", id).length, 1);
		assert.equal((await api.db(STATE).where({ event: "certificate.expiring", object_id: String(id) })).length, 1);

		assert.equal((await admin.delete(`${CERTS}/${id}`)).status, 200);
		assert.equal((await api.db(STATE).where({ object_id: String(id) })).length, 0);
	});

	it("a layer that throws leaves the run result, the refresh and a single renew unchanged", async () => {
		const one = await requested("layer.example.com");
		await stale(one.id);
		await cp(expired.certificate, live(one.id));
		const original = stateStore.report;
		const targets = notify.channels()[0].targets;
		notify.registerChannel({
			id: "fake",
			accepts: () => true,
			targets: () => {
				throw new Error("targets broke");
			},
		});
		stateStore.report = () => {
			throw new Error("store broke");
		};
		try {
			await certbotFails(api, "boom");
			assert.equal(await run(), undefined);
			assert.equal(internalCertificate.intervalProcessing, false);
			// the refresh of the dates still happened
			assert.equal(
				String((await rowsOf()).find((row) => row.id === one.id).expires_on).slice(0, 10),
				"2020-01-02",
			);

			await certbotSucceeds(api, pair);
			await stale(one.id);
			const renewed = await admin.post(`${CERTS}/${one.id}/renew`, {});
			assert.equal(renewed.status, 200, renewed.text);
			assert.equal((await admin.delete(`${CERTS}/${one.id}`)).status, 200);
		} finally {
			stateStore.report = original;
			notify.registerChannel({ id: "fake", accepts: () => true, targets });
		}
	});
});
