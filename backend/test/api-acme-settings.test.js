import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls, seedAccount } from "./support/certbot.js";

const LE = "https://acme-v02.api.letsencrypt.org/directory";
const ZEROSSL = "https://acme.zerossl.com/v2/DV90";
const CA = "https://ca.lan/dir";
const GOOD = "https://good.lan/dir";
const REFUSE = "https://refuse.lan/dir";
const SETTINGS = "/settings/acme";
const FAKE_FILES = [".ini", ".fail", ".mode"];
let api;
let admin;
let model;
let directory;
let acmeServer;

const readFake = (name) => readFile(path.join(api.root, "fake", name), "utf8");
const startup = () => readFile(path.join(api.root, "data/npmpro/startup-settings.env"), "utf8");
const hasServerLine = (text) => text.split("\n").some((line) => line.startsWith("ACME_SERVER="));
const containsAny = (text, values) => values.some((value) => text.includes(value));
const registeredCalls = async () => (await normalizedCalls(api)).filter((line) => line.includes(" register "));
const account = (server) => model.query().where("server", server).first();

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_OUTBOUND: "mock" } });
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	for (const host of ["ca.lan", "good.lan", "refuse.lan"]) api.outside.dns.set(host, "192.168.1.10");
	api.outside.dns.set("acme.zerossl.com", "192.0.2.20");
	api.outside.dns.set("acme-v02.api.letsencrypt.org", "192.0.2.30");
	admin = await api.admin();
	model = (await import("../models/acme_account.js")).default;
	directory = await import("../lib/acme-directory.js");
	acmeServer = await import("../lib/acme-server.js");
});
beforeEach(async () => {
	await model.query().delete();
	await api.db("audit_log").whereIn("object_type", ["acme-account", "setting"]).delete();
	const { default: settingModel } = await import("../models/setting.js");
	await settingModel.query().where("id", "acme").delete();
	acmeServer.setStoredAcmeServer(null);
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	for (const name of await readdir(path.join(api.root, "fake"))) {
		if (FAKE_FILES.some((end) => name.endsWith(end))) await rm(path.join(api.root, "fake", name));
	}
	await api.outside.clearCalls();
	directory.clearAcmeDirectoryCache();
});
after(() => api.stop());

it("is for administrators only", async () => {
	const first = await admin.get(SETTINGS);
	assert.equal(first.status, 200);
	assert.equal(first.body.server, LE);
	assert.equal(first.body.server_source, "default");
	assert.equal(first.body.account, null);
	assert.deepEqual(first.body.locked, []);
	assert.equal(first.body.presets.length, 4);
	const limited = await api.limited({ visibility: "all", certificates: "manage" });
	assert.equal((await limited.get(SETTINGS)).status, 403);
	assert.equal((await limited.put(SETTINGS, { email: "a@example.com" })).status, 403);
	assert.equal((await limited.post(`${SETTINGS}/register`, {})).status, 403);
	assert.equal((await limited.get(`${SETTINGS}/profiles`)).status, 403);
});

it("refuses a blocked URL and stores nothing", async () => {
	api.outside.dns.set("loop.lan", "::1");
	for (const server of ["https://127.0.0.1/dir", "https://169.254.169.254/directory", "https://loop.lan/dir"]) {
		const res = await admin.put(SETTINGS, { server });
		assert.equal(res.status, 400, res.text);
		assert.equal(res.body.error.message_i18n, "error.acme-blocked");
	}
	const got = await admin.get(SETTINGS);
	assert.equal(got.body.server, LE);
	assert.equal(await model.query().resultSize(), 0);
	assert.ok(!hasServerLine(await startup()));
	assert.deepEqual(await normalizedCalls(api), []);
	const profiles = await admin.get(`${SETTINGS}/profiles?server=https://127.0.0.1/dir`);
	assert.equal(profiles.status, 400);
	assert.equal(profiles.body.error.message_i18n, "error.acme-blocked");
});

it("stores an unreachable CA as pending with a warning", async () => {
	acmeDirectory(api, CA, { status: 503, body: "down", persist: false });
	const res = await admin.put(SETTINGS, { server: CA, email: "ops@example.com" });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.warning, "unreachable");
	assert.equal(res.body.server, CA);
	assert.equal(res.body.server_source, "setting");
	assert.equal(res.body.account.state, "pending");
	assert.equal(res.body.account.email, "ops@example.com");
	assert.ok((await startup()).split("\n").includes(`ACME_SERVER=${CA}`));
	assert.deepEqual(await normalizedCalls(api), []);
});

it("refuses a CA that answers but refuses the account, and leaves everything as it was", async () => {
	acmeDirectory(api, REFUSE);
	await writeFile(path.join(api.root, "fake/register.fail"), "invalidContact: ops@bad.example");
	const res = await admin.put(SETTINGS, { server: REFUSE, email: "ops@bad.example" });
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.acme-refused");
	assert.ok(!JSON.stringify(res.body.error.message_values).includes("ops@bad.example"));
	const got = await admin.get(SETTINGS);
	assert.equal(got.body.server, LE);
	assert.equal(await account(REFUSE), undefined);
});

it("registers a new CA with EAB on save and keeps every secret out of answers, audit and argv", async () => {
	acmeDirectory(api, GOOD, { body: { newNonce: "n", meta: { externalAccountRequired: true } }, persist: false });
	const res = await admin.put(SETTINGS, {
		server: GOOD,
		email: "ops@example.com",
		eab_kid: "kid-1",
		eab_hmac_key: "hmac-secret-1",
	});
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.warning, undefined);
	assert.equal(res.body.account.state, "registered");
	assert.equal(res.body.eab_kid_set, false);
	assert.equal(res.body.eab_hmac_key_set, false);
	const ini = await readFake("register-1.ini");
	for (const line of ["email = ops@example.com", "eab-kid = kid-1", "eab-hmac-key = hmac-secret-1"]) {
		assert.ok(ini.split("\n").includes(line), line);
	}
	// the email is shown to administrators in the answer; it never reaches argv, the audit log or a log
	const secrets = ["kid-1", "hmac-secret-1", "ops@example.com"];
	const audit = await api.db("audit_log");
	assert.ok(!containsAny(JSON.stringify(res.body), ["kid-1", "hmac-secret-1"]));
	assert.ok(!containsAny(JSON.stringify(await normalizedCalls(api)), secrets));
	assert.ok(!containsAny(JSON.stringify(audit), secrets));
	const updated = audit.find((entry) => entry.action === "updated" && entry.object_type === "acme-account");
	const meta = typeof updated.meta === "string" ? JSON.parse(updated.meta) : updated.meta;
	assert.equal(meta.email_changed, true);
	assert.equal(meta.eab_entered, true);
	const setting = audit.find((entry) => entry.object_type === "setting");
	const settingMeta = typeof setting.meta === "string" ? JSON.parse(setting.meta) : setting.meta;
	assert.equal(settingMeta.id, "acme");
});

it("registers now what a save stored as pending", async () => {
	acmeDirectory(api, CA, { status: 503, body: "down", persist: false });
	assert.equal((await admin.put(SETTINGS, { server: CA, email: "ops@example.com" })).body.warning, "unreachable");
	directory.clearAcmeDirectoryCache();
	acmeDirectory(api, CA, { persist: false });
	const res = await admin.post(`${SETTINGS}/register`, {});
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.account.state, "registered");
});

const ID = `${"0".repeat(31)}7`;

// ca.lan as the instance CA with an account registered under ops@example.com
const registeredCa = async () => {
	const { saveAcmeSetting } = await import("../internal/acme-account.js");
	await seedAccount(api, CA, ID);
	await model.query().insert({ server: CA, state: "registered", account_id: ID, email: "ops@example.com" });
	await saveAcmeSetting(CA);
	acmeServer.setStoredAcmeServer(CA);
	await api.outside.clearCalls();
};

it("refuses an email change while the CA cannot be reached", async () => {
	await registeredCa();
	acmeDirectory(api, CA, { status: 503, body: "down", persist: false });
	const res = await admin.put(SETTINGS, { email: "new@example.com" });
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.acme-email-offline");
	assert.equal((await account(CA)).email, "ops@example.com");
	assert.ok(!(await normalizedCalls(api)).some((line) => line.includes("update_account")));
});

it("changes the email of a registered account at its CA", async () => {
	await registeredCa();
	acmeDirectory(api, CA, { persist: false });
	const res = await admin.put(SETTINGS, { email: "new@example.com" });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.account.email, "new@example.com");
	const calls = await normalizedCalls(api);
	assert.ok(calls.some((line) => line.includes(`update_account --server ${CA} --account ${ID}`)));
	await api.outside.clearCalls();
	acmeDirectory(api, CA, { persist: false });
	const removed = await admin.put(SETTINGS, { email: "" });
	assert.equal(removed.status, 200, removed.text);
	assert.ok((await normalizedCalls(api)).some((line) => line.includes("--register-unsafely-without-email")));
});

it("ignores EAB values for a registered account", async () => {
	await registeredCa();
	const res = await admin.put(SETTINGS, { eab_kid: "k", eab_hmac_key: "h" });
	assert.equal(res.status, 200, res.text);
	assert.equal((await registeredCalls()).length, 0);
	assert.equal(res.body.eab_kid_set, false);
});

it("never refuses a stored server a save keeps, a blocked name counts as unreachable", async () => {
	await registeredCa();
	await model.query().where("server", CA).patch({ state: "pending" });
	api.outside.dns.set("ca.lan", "127.0.0.1");
	try {
		const res = await admin.put(SETTINGS, { email: "x@example.com" });
		assert.equal(res.status, 200, res.text);
		assert.equal(res.body.warning, "unreachable");
		const row = await account(CA);
		assert.equal(row.state, "pending");
		assert.equal(row.email, "x@example.com");
	} finally {
		api.outside.dns.set("ca.lan", "192.168.1.10");
	}
});

it("lists the profiles of a CA, cached", async () => {
	acmeDirectory(api, GOOD, {
		body: { newNonce: "n", meta: { profiles: { classic: "Classic", shortlived: "Six days" } } },
		persist: false,
	});
	const want = {
		reachable: true,
		directory: true,
		external_account_required: false,
		profiles: [
			{ name: "classic", description: "Classic" },
			{ name: "shortlived", description: "Six days" },
		],
	};
	const first = await admin.get(`${SETTINGS}/profiles?server=${GOOD}`);
	assert.equal(first.status, 200, first.text);
	assert.deepEqual(first.body, want);
	const second = await admin.get(`${SETTINGS}/profiles?server=${GOOD}`);
	assert.deepEqual(second.body, want);
});

it("goes back to Let's Encrypt", async () => {
	await registeredCa();
	const { default: settingModel } = await import("../models/setting.js");
	await seedAccount(api, LE, `${"0".repeat(31)}9`);
	await model.query().insert({ server: LE, state: "registered", account_id: `${"0".repeat(31)}9` });
	acmeDirectory(api, LE, { body: { newNonce: "n", meta: { profiles: { shortlived: "Six days" } } }, persist: false });
	const res = await admin.put(SETTINGS, { server: LE });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.server, LE);
	assert.equal(res.body.server_source, "default");
	assert.equal((await settingModel.query().where("id", "acme").first()).meta.server, null);
	assert.ok(!hasServerLine(await startup()));
});

it("makes the runtime defaults follow the CA without a restart", async () => {
	const id = `${"0".repeat(31)}8`;
	await seedAccount(api, ZEROSSL, id);
	await model.query().insert({ server: ZEROSSL, state: "registered", account_id: id });
	acmeDirectory(api, ZEROSSL, { persist: false });
	const res = await admin.put(SETTINGS, { server: ZEROSSL });
	assert.equal(res.status, 200, res.text);
	const runtime = await admin.get("/settings/runtime/certificates");
	assert.equal(runtime.body.must_staple, true);
	assert.equal(runtime.body.ocsp_stapling, true);
});
