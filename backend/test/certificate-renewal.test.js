import assert from "node:assert/strict";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotFails, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";

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
	api = await startApi({ env: { ACME_SERVER: ACME, NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("acme.example.test", "192.0.2.50");
	acmeDirectory(api, ACME);
	admin = await api.admin();
	pair = await makeCertificate(path.join(api.root, "fake"), "renew.example.com");
	internalCertificate = (await import("../internal/certificate.js")).default;
});
after(() => api?.stop());
beforeEach(async () => {
	await api.outside.clearCalls();
	await certbotSucceeds(api, pair);
	internalCertificate.intervalProcessing = false;
});

it("a renewal run renews, reloads, reads each expiry again and lets the next run start", async () => {
	const certificate = await requested("renew.example.com");
	await api.db("certificate").where({ id: certificate.id }).update({ expires_on: "2000-01-01 00:00:00" });
	await api.outside.clearCalls();
	const reloads = api.outside.control.reloads;
	await internalCertificate.processExpiringHosts();
	const renews = (await certbotCalls()).filter((line) => line.includes(" renew "));
	assert.equal(renews.length, 1);
	assert.ok(renews[0].endsWith(" renew --quiet"));
	assert.equal(renews[0].includes("--server"), false);
	assert.equal(api.outside.control.reloads, reloads + 1);
	const row = await api.db("certificate").where({ id: certificate.id }).first();
	assert.notEqual(String(row.expires_on).slice(0, 4), "2000");
	assert.equal(internalCertificate.intervalProcessing, false);
});

it("a conf naming a missing account on a CA with a registered account is rewritten before certbot renews", async () => {
	const certificate = await requested("conf.example.com");
	const conf = path.join(api.root, `data/tls/certbot/renewal/npm-${certificate.id}.conf`);
	const account = (await api.db("npmpro_acme_account").where({ server: ACME }).first()).account_id;
	await writeFile(conf, `[renewalparams]\naccount = ${"9".repeat(32)}\nserver = ${ACME}\n`);
	await api.outside.clearCalls();
	await internalCertificate.processExpiringHosts();
	assert.match(await readFile(conf, "utf8"), new RegExp(`^account = ${account}$`, "mu"));
	assert.equal((await normalizedCalls(api)).filter((line) => line.includes(" renew ")).length, 1);
});

it("a renewal run still renews when the renewal confs cannot be listed", async () => {
	const dir = path.join(api.root, "data/tls/certbot/renewal");
	await chmod(dir, 0o000);
	await api.outside.clearCalls();
	try {
		await internalCertificate.processExpiringHosts();
	} finally {
		await chmod(dir, 0o755);
	}
	const renews = (await certbotCalls()).filter((line) => line.includes(" renew "));
	assert.equal(renews.length, 1);
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
	// the fake certbot "renew" without --cert-name exits at once and does not recreate the live folder
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
