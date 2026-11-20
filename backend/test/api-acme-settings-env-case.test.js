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
