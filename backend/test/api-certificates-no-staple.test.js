import assert from "node:assert/strict";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";

const LE = "https://acme-v02.api.letsencrypt.org/directory";
let api;

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("acme-v02.api.letsencrypt.org", "192.0.2.30");
	acmeDirectory(api, LE);
	await certbotSucceeds(api, await makeCertificate(path.join(api.root, "fake"), "plain.example.com"));
});
after(() => api?.stop());

it("passes no must-staple when the instance CA is Let's Encrypt and the option is unset", async () => {
	const admin = await api.admin();
	const made = await admin.post("/nginx/certificates", {
		provider: "letsencrypt",
		domain_names: ["plain.example.com"],
	});
	assert.equal(made.status, 201, made.text);
	const certonly = (await normalizedCalls(api)).find((line) => line.includes(" certonly "));
	assert.ok(certonly.includes(` certonly --server ${LE} --account `), certonly);
	assert.equal(certonly.includes("--must-staple"), false);
	assert.ok(certonly.includes(" --required-profile shortlived "), certonly);
});
