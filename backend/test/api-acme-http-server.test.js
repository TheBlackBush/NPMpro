import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";

// envs.sh accepts any http:// or https:// ACME_SERVER: an http URL and a Docker name with an underscore must work with
// Try again (POST register) and Replace account, whose request schemas once allowed only the typed-URL characters
const SERVER = "http://step_ca:9000/acme/acme/directory";
const SETTINGS = "/settings/acme";

let api;
let admin;

before(async () => {
	api = await startApi({ env: { ACME_SERVER: SERVER, NPMPRO_TEST_OUTBOUND: "mock" } });
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	acmeDirectory(api, SERVER);
	admin = await api.admin();
});
after(() => api.stop());

it("Try again registers the instance CA without a server, and with its http URL", async () => {
	const res = await admin.post(`${SETTINGS}/register`, {});
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.account.state, "registered");
	assert.equal(res.body.account.server, SERVER);
	const named = await admin.post(`${SETTINGS}/register`, { server: SERVER });
	assert.equal(named.status, 200, named.text);
	assert.equal(named.body.account.state, "registered");
	assert.deepEqual(
		(await normalizedCalls(api))
			.filter((line) => line.includes(" register "))
			.map((line) => line.split(" --server ")[1]),
		[`${SERVER} --register-unsafely-without-email`],
	);
});

it("Replace account takes the instance CA's http URL", async () => {
	const conf = path.join(api.root, "data/tls/certbot/renewal/npm-7.conf");
	await mkdir(path.dirname(conf), { recursive: true });
	const before = (await admin.get(SETTINGS)).body.account;
	const { default: model } = await import("../models/acme_account.js");
	const old = (await model.query().where("server", SERVER).first()).account_id;
	await writeFile(conf, `version = 5.10.0\n[renewalparams]\naccount = ${old}\nserver = ${SERVER}\n`);
	const res = await admin.post(`${SETTINGS}/replace`, { server: SERVER });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.replaced.moved, 1);
	assert.equal(res.body.account.state, "registered");
	assert.notEqual(res.body.account.registered_on, null);
	assert.equal(before.server, SERVER);
	assert.notEqual((await model.query().where("server", SERVER).first()).account_id, old);
});
