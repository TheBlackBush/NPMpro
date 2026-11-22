import assert from "node:assert/strict";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls, seedAccount } from "./support/certbot.js";

// An ACME_SERVER that envs.sh accepts but a typed URL may not be (http, an underscore in a Docker name): the create
// and re-issue bodies take it, since only the allowed list decides
const INSTANCE = "http://step_ca:9000/acme/acme/directory";
const SECOND = "https://second.lan/dir";
const INSTANCE_ACCOUNT = "a".repeat(32);
const SECOND_ACCOUNT = "c".repeat(32);
const CERTS = "/nginx/certificates";

let api;
let admin;

const certonlyServer = async () =>
	(await normalizedCalls(api)).find((line) => line.includes(" certonly "))?.match(/--server (?<server>\S+)/u)?.groups
		.server;

before(async () => {
	api = await startApi({ env: { ACME_SERVER: INSTANCE, NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("second.lan", "192.168.1.10");
	acmeDirectory(api, SECOND);
	admin = await api.admin();
	await certbotSucceeds(api, await makeCertificate(path.join(api.root, "fake"), "a.example.com"));
	const model = (await import("../models/acme_account.js")).default;
	await seedAccount(api, INSTANCE, INSTANCE_ACCOUNT);
	await seedAccount(api, SECOND, SECOND_ACCOUNT);
	await model.query().insert({ server: INSTANCE, account_id: INSTANCE_ACCOUNT, state: "registered" });
	await model.query().insert({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered" });
});
beforeEach(() => api.outside.clearCalls());
after(() => api?.stop());

it("a create naming the instance CA from ACME_SERVER passes to certbot and stores that CA", async () => {
	const made = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["a.example.com"],
		npmpro_acme_server: INSTANCE,
	});
	assert.equal(made.status, 201, made.text);
	assert.equal(made.body.npmpro_acme_server, INSTANCE);
	assert.equal(await certonlyServer(), INSTANCE);
});

it("a re-issue back to that instance CA passes the schema", async () => {
	const made = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["a.example.com"],
		npmpro_acme_server: SECOND,
	});
	assert.equal(made.status, 201, made.text);
	await api.outside.clearCalls();
	const done = await admin.post(`${CERTS}/${made.body.id}/reissue`, { npmpro_acme_server: INSTANCE });
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.npmpro_acme_server, INSTANCE);
	assert.equal(await certonlyServer(), INSTANCE);
});

it("still refuses a URL with a space", async () => {
	const refused = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["a.example.com"],
		npmpro_acme_server: "https://second.lan/a b",
	});
	assert.equal(refused.status, 400, refused.text);
	assert.deepEqual(await normalizedCalls(api), []);
});
