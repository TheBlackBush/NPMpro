import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";

const ENV_SERVER = "https://127.0.0.1:14000/dir";
const SETTINGS = "/settings/acme";
let api;
let admin;
let model;

before(async () => {
	api = await startApi({
		env: {
			ACME_SERVER: ENV_SERVER,
			ACME_EMAIL: "env@example.com",
			ACME_EAB_KID: "env-kid",
			ACME_EAB_HMAC_KEY: "env-hmac",
			NPMPRO_TEST_OUTBOUND: "mock",
		},
	});
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	admin = await api.admin();
	model = (await import("../models/acme_account.js")).default;
});
beforeEach(async () => {
	await model.query().delete();
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	for (const name of await readdir(path.join(api.root, "fake"))) {
		if (name.endsWith(".ini") || name.endsWith(".fail")) await rm(path.join(api.root, "fake", name));
	}
	await api.outside.clearCalls();
	(await import("../lib/acme-directory.js")).clearAcmeDirectoryCache();
});
after(() => api.stop());

it("shows what the environment locks, without the EAB values", async () => {
	const res = await admin.get(SETTINGS);
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.locked, ["server", "email", "eab_kid", "eab_hmac_key"]);
	assert.deepEqual(res.body.locked_by, {
		server: "ACME_SERVER",
		email: "ACME_EMAIL",
		eab_kid: "ACME_EAB_KID",
		eab_hmac_key: "ACME_EAB_HMAC_KEY",
	});
	assert.equal(res.body.server_source, "env");
	assert.equal(res.body.email, "env@example.com");
	assert.equal(res.body.eab_kid_set, true);
	assert.equal(res.body.eab_hmac_key_set, true);
	assert.ok(!res.text.includes("env-kid"));
	assert.ok(!res.text.includes("env-hmac"));
});

it("drops every locked key from a save", async () => {
	const res = await admin.put(SETTINGS, {
		server: "https://ca.lan/dir",
		email: "x@example.com",
		eab_kid: "a",
		eab_hmac_key: "b",
	});
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.server, ENV_SERVER);
	assert.equal(res.body.email, "env@example.com");
	assert.equal(await model.query().resultSize(), 0);
	assert.deepEqual(await normalizedCalls(api), []);
});

it("reads the env CA on a loopback address without the guard", async () => {
	acmeDirectory(api, ENV_SERVER, { body: { newNonce: "n", meta: { profiles: { classic: "Classic" } } } });
	const res = await admin.get(`${SETTINGS}/profiles`);
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.reachable, true);
});

it("registers with the env email and EAB pair and never stores them", async () => {
	acmeDirectory(api, ENV_SERVER, { body: { newNonce: "n", meta: { externalAccountRequired: true } } });
	const res = await admin.post(`${SETTINGS}/register`, {});
	assert.equal(res.status, 200, res.text);
	const ini = (await readFile(path.join(api.root, "fake/register-1.ini"), "utf8")).split("\n");
	assert.ok(ini.includes("email = env@example.com"));
	assert.ok(ini.includes("eab-kid = env-kid"));
	const row = await model.query().where("server", ENV_SERVER).first();
	assert.equal(row.state, "registered");
	assert.equal(row.eab_kid, null);
	assert.equal(row.eab_hmac_key, null);
});
