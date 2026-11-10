import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { certbotFails, certbotSucceeds, makeCertificate } from "./support/certbot.js";

const CERTS = "/nginx/certificates";
const ACME = "https://acme.example.test/directory";
let api;
let admin;
let pair;
let internalCertificate;

const requested = async (name) => {
	const made = await admin.post(CERTS, { provider: "letsencrypt", domain_names: [name] });
	assert.equal(made.status, 201, made.text);
	return made.body;
};
const certbotCalls = async () => (await api.outside.calls()).filter((line) => line.startsWith("certbot "));

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME } });
	admin = await api.admin();
	pair = await makeCertificate(path.join(api.root, "fake"), "renew.example.com");
	internalCertificate = (await import("../internal/certificate.js")).default;
});
after(() => api?.stop());
beforeEach(async () => {
	await api.outside.clearCalls();
	await certbotSucceeds(api, pair);
});

it("a renewal run renews, reloads, reads each expiry again and lets the next run start", async () => {
	const certificate = await requested("renew.example.com");
	await api.db("certificate").where({ id: certificate.id }).update({ expires_on: "2000-01-01 00:00:00" });
	await api.outside.clearCalls();
	const reloads = api.outside.control.reloads;
	await internalCertificate.processExpiringHosts();
	assert.ok((await certbotCalls()).some((line) => line.includes(" renew ") && line.includes(ACME)));
	assert.equal(api.outside.control.reloads, reloads + 1);
	const row = await api.db("certificate").where({ id: certificate.id }).first();
	assert.notEqual(String(row.expires_on).slice(0, 4), "2000");
	assert.equal(internalCertificate.intervalProcessing, false);
});

it("a failed renewal run still reloads and frees the flag", async () => {
	await certbotFails(api, "renew failed");
	const reloads = api.outside.control.reloads;
	await internalCertificate.processExpiringHosts();
	assert.equal(api.outside.control.reloads, reloads + 1);
	assert.equal(internalCertificate.intervalProcessing, false);
});

it("a certificate without files does not stop the renewal of the others", async () => {
	const missing = await requested("files-gone.example.com");
	await api.db("certificate").where({ id: missing.id }).update({ expires_on: "2000-01-01 00:00:00" });
	await rm(path.join(api.root, `data/tls/certbot/live/npm-${missing.id}`), { recursive: true, force: true });
	await internalCertificate.processExpiringHosts();
	const row = await api.db("certificate").where({ id: missing.id }).first();
	assert.equal(String(row.expires_on).slice(0, 4), "2000");
	assert.equal(internalCertificate.intervalProcessing, false);
});

it("a second run while one runs does nothing", async () => {
	internalCertificate.intervalProcessing = true;
	await api.outside.clearCalls();
	await internalCertificate.processExpiringHosts();
	assert.deepEqual(await certbotCalls(), []);
	internalCertificate.intervalProcessing = false;
});
