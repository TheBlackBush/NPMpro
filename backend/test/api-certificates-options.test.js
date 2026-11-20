import assert from "node:assert/strict";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";

const ACME = "https://acme.options.test/directory";
const INI = "/run/npmpro/certbot.ini";
const SERVER_PART = new RegExp(
	`certonly --server ${ACME} --account [0-9a-f]{32} --required-profile classic --must-staple --cert-name npm-\\d+ `,
	"u",
);
let api;

before(async () => {
	api = await startApi({
		env: { ACME_SERVER: ACME, ACME_PROFILE: "classic", ACME_MUST_STAPLE: "true", NPMPRO_TEST_OUTBOUND: "mock" },
	});
	api.outside.dns.set("acme.options.test", "192.0.2.60");
	acmeDirectory(api, ACME, {
		body: { newNonce: "https://acme.options.test/nonce", meta: { profiles: { classic: "x" } } },
	});
	await certbotSucceeds(api, await makeCertificate(path.join(api.root, "fake"), "opt.example.com"));
});
after(() => api?.stop());

it("a new certificate gets its CA's profile and must-staple after the account", async () => {
	const admin = await api.admin();
	const made = await admin.post("/nginx/certificates", {
		provider: "letsencrypt",
		domain_names: ["opt.example.com"],
	});
	assert.equal(made.status, 201, made.text);
	const calls = await normalizedCalls(api);
	const certonly = calls.find((line) => line.includes(" certonly "));
	assert.ok(certonly.startsWith(`certbot --config ${INI} `), certonly);
	assert.match(certonly, SERVER_PART);
});
