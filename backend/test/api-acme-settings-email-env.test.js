import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, afterEach, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";

// ACME_EMAIL set without ACME_SERVER: a CA switch in Settings registers the new instance CA with the env email (and
// the env EAB pair when both are set), since the email and EAB fields are locked by the env (D5)

const CA = "https://ca.lan/dir";
const ZEROSSL = "https://acme.zerossl.com/v2/DV90";
const GOOGLE = "https://dv.acme-v02.api.pki.goog/directory";
const SETTINGS = "/settings/acme";
const EAB_REQUIRED = { newNonce: "https://ca.lan/n", meta: { externalAccountRequired: true } };
const FAKE_FILES = [".ini", ".fail", ".mode"];
let api;
let admin;
let model;

const iniLines = async (n = 1) => (await readFile(path.join(api.root, `fake/register-${n}.ini`), "utf8")).split("\n");
const registerCalls = async () => (await normalizedCalls(api)).filter((line) => line.includes(" register "));

before(async () => {
	api = await startApi({ env: { ACME_EMAIL: "env@example.com", NPMPRO_TEST_OUTBOUND: "mock" } });
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	api.outside.dns.set("ca.lan", "192.168.1.10");
	api.outside.dns.set("acme.zerossl.com", "192.0.2.20");
	api.outside.dns.set("dv.acme-v02.api.pki.goog", "192.0.2.40");
	admin = await api.admin();
	model = (await import("../models/acme_account.js")).default;
});
beforeEach(async () => {
	await model.query().delete();
	const { default: settingModel } = await import("../models/setting.js");
	await settingModel.query().where("id", "acme").delete();
	(await import("../lib/acme-server.js")).setStoredAcmeServer(null);
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	for (const name of await readdir(path.join(api.root, "fake"))) {
		if (FAKE_FILES.some((end) => name.endsWith(end))) await rm(path.join(api.root, "fake", name));
	}
	await api.outside.clearCalls();
	(await import("../lib/acme-directory.js")).clearAcmeDirectoryCache();
});
afterEach(() => {
	delete process.env.ACME_EAB_KID;
	delete process.env.ACME_EAB_HMAC_KEY;
});
after(() => api.stop());

it("registers a CA chosen in Settings with ACME_EMAIL", async () => {
	acmeDirectory(api, CA, { persist: false });
	const res = await admin.put(SETTINGS, { server: CA });
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.locked, ["email"]);
	assert.equal(res.body.server, CA);
	assert.equal(res.body.account.state, "registered");
	assert.ok((await iniLines()).includes("email = env@example.com"));
	const [call] = await registerCalls();
	assert.ok(!call.includes("--register-unsafely-without-email"), call);
	assert.equal((await model.query().where("server", CA).first()).email, "env@example.com");
});

it("fetches the ZeroSSL EAB pair for ACME_EMAIL instead of refusing the switch", async () => {
	acmeDirectory(api, ZEROSSL, { body: EAB_REQUIRED, persist: false });
	api.outside.http
		.get("https://api.zerossl.com")
		.intercept({
			path: "/acme/eab-credentials-email",
			method: "POST",
			body: (body) => new URLSearchParams(String(body)).get("email") === "env@example.com",
		})
		.reply(
			200,
			{ success: true, eab_kid: "zs-kid", eab_hmac_key: "zs-hmac" },
			{ headers: { "content-type": "application/json" } },
		);
	const res = await admin.put(SETTINGS, { server: ZEROSSL });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.server, ZEROSSL);
	const ini = await iniLines();
	assert.ok(ini.includes("email = env@example.com"));
	assert.ok(ini.includes("eab-kid = zs-kid"));
	const row = await model.query().where("server", ZEROSSL).first();
	assert.equal(row.state, "registered");
	assert.equal(row.eab_kid, null);
});

it("uses the env EAB pair for a CA that needs one when both values are set", async () => {
	process.env.ACME_EAB_KID = "env-kid";
	process.env.ACME_EAB_HMAC_KEY = "env-hmac";
	acmeDirectory(api, GOOGLE, { body: EAB_REQUIRED, persist: false });
	const res = await admin.put(SETTINGS, { server: GOOGLE });
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.locked, ["email", "eab_kid", "eab_hmac_key"]);
	const ini = await iniLines();
	assert.ok(ini.includes("email = env@example.com"));
	assert.ok(ini.includes("eab-kid = env-kid"));
	assert.ok(ini.includes("eab-hmac-key = env-hmac"));
	assert.ok(!res.text.includes("env-hmac"));
	const row = await model.query().where("server", GOOGLE).first();
	assert.equal(row.state, "registered");
	assert.equal(row.eab_kid, null);
	assert.equal(row.eab_hmac_key, null);
});
