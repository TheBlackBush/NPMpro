import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate } from "./support/certbot.js";

let api;
let admin;

before(async () => {
	api = await startApi({ env: { ACME_SERVER: "https://CA.LAN/dir", NPMPRO_TEST_OUTBOUND: "mock" } });
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	api.outside.dns.set("ca.lan", "127.0.0.1");
	admin = await api.admin();
});
after(() => api.stop());

it("trusts the operator's ACME_SERVER for its lower-cased spelling, so its loopback host is not blocked", async () => {
	acmeDirectory(api, "https://ca.lan/dir", { body: { newNonce: "n", meta: { profiles: { classic: "Classic" } } } });
	const res = await admin.get("/settings/acme/profiles?server=https://CA.LAN/dir");
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.reachable, true);
	assert.deepEqual(res.body.profiles, [{ name: "classic", description: "Classic" }]);
});

it("requests and renews with the spelling of the account's folder when ACME_SERVER has an upper-case host", async () => {
	const { seedAccount, normalizedCalls } = await import("./support/certbot.js");
	const { writeFile, readFile } = await import("node:fs/promises");
	const path = await import("node:path");
	const id = "c".repeat(32);
	// registered in Settings before ACME_SERVER was set: a lower-case row and folder
	await seedAccount(api, "https://ca.lan/dir", id);
	const { default: model } = await import("../models/acme_account.js");
	await model.query().insert({ server: "https://ca.lan/dir", state: "registered", account_id: id });
	await api.outside.clearCalls();
	const made = await admin.post("/nginx/certificates", {
		provider: "letsencrypt",
		domain_names: ["case.example.com"],
	});
	assert.equal(made.status, 201, made.text);
	const certonly = (await normalizedCalls(api)).find((line) => line.includes(" certonly "));
	assert.ok(certonly.includes(`--server https://ca.lan/dir --account ${id}`), certonly);
	assert.deepEqual(
		(await normalizedCalls(api)).filter((line) => line.includes(" register ")),
		[],
		"no second account",
	);
	// a conf that names the upper-case spelling (certbot cannot find the account there) is pointed at the folder's
	const conf = path.join(api.root, `data/tls/certbot/renewal/npm-${made.body.id}.conf`);
	await writeFile(conf, `version = 5.10.0\n[renewalparams]\naccount = ${id}\nserver = https://CA.LAN/dir\n`);
	const internalCertificate = (await import("../internal/certificate.js")).default;
	internalCertificate.intervalProcessing = false;
	await internalCertificate.processExpiringHosts();
	const text = await readFile(conf, "utf8");
	assert.ok(text.split("\n").includes("server = https://ca.lan/dir"), text);
	assert.ok(text.split("\n").includes(`account = ${id}`), text);
});
