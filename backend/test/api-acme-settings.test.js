import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
	await (await import("../lib/runtime-apply.js")).writeStartupSettings();
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
	assert.ok(!hasServerLine(await startup()));
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

it("saves the host of a typed CA in lower case, so the account row and the card match", async () => {
	acmeDirectory(api, GOOD, { persist: false });
	const res = await admin.put(SETTINGS, { server: "https://GOOD.LAN/dir", email: "ops@example.com" });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.server, "https://good.lan/dir");
	assert.deepEqual(
		res.body.accounts.map((entry) => entry.server),
		["https://good.lan/dir"],
	);
	assert.equal((await account("https://good.lan/dir")).state, "registered");
	assert.ok((await startup()).split("\n").includes("ACME_SERVER=https://good.lan/dir"));
	assert.equal((await admin.get(SETTINGS)).body.server, "https://good.lan/dir");
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
	api.outside.dns.set("ca.lan", "127.0.0.1");
	try {
		// registered: the email change needs the CA, which counts as not reachable (D13), not as a refused server
		const offline = await admin.put(SETTINGS, { email: "y@example.com" });
		assert.equal(offline.status, 400, offline.text);
		assert.equal(offline.body.error.message_i18n, "error.acme-email-offline");
		// no account folder: the row is really pending, and is stored as pending again
		await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
		await model.query().where("server", CA).patch({ state: "pending", account_id: null });
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

// a registered account of server, under the test root
const seedRegistered = async (server, id) => {
	await seedAccount(api, server, id);
	await model.query().insert({ server, state: "registered", account_id: id });
};

it("goes back to Let's Encrypt and is not refused when Let's Encrypt cannot be reached", async () => {
	await registeredCa();
	const { default: settingModel } = await import("../models/setting.js");
	await seedRegistered(LE, `${"0".repeat(31)}9`);
	acmeDirectory(api, LE, { status: 503, body: "down", persist: false });
	const res = await admin.put(SETTINGS, { server: LE });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.server, LE);
	assert.equal(res.body.server_source, "default");
	assert.equal((await settingModel.query().where("id", "acme").first()).meta.server, null);
	assert.ok(!hasServerLine(await startup()));
	assert.equal((await admin.get("/settings/runtime/certificates")).body.profile, "shortlived");
});

it("drops a default profile the reachable new CA does not list, and still saves", async () => {
	await registeredCa();
	await seedRegistered(LE, `${"0".repeat(31)}9`);
	acmeDirectory(api, LE, { persist: false });
	const res = await admin.put(SETTINGS, { server: LE });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.server, LE);
	assert.equal((await admin.get("/settings/runtime/certificates")).body.profile, "");
});

it("puts the previous CA back when applying the switch fails", async () => {
	await registeredCa();
	const { default: settingModel } = await import("../models/setting.js");
	await (await import("../lib/runtime-apply.js")).writeStartupSettings();
	const startupBefore = await startup();
	await seedRegistered(ZEROSSL, `${"0".repeat(31)}8`);
	acmeDirectory(api, ZEROSSL, { persist: false });
	api.outside.control.failNext = "nginx: forced failure";
	try {
		const res = await admin.put(SETTINGS, { server: ZEROSSL });
		assert.notEqual(res.status, 200, res.text);
	} finally {
		api.outside.control.failNext = null;
	}
	assert.equal((await settingModel.query().where("id", "acme").first()).meta.server, CA);
	assert.equal(await startup(), startupBefore);
	assert.equal(acmeServer.storedAcmeServer(), CA);
	assert.equal((await admin.get(SETTINGS)).body.server, CA);
	assert.equal(
		(await api.db("audit_log").where({ object_type: "setting" })).filter((entry) => entry.meta.includes(ZEROSSL))
			.length,
		0,
	);
});

it("applies the guard to a typed URL whose account already exists", async () => {
	api.outside.dns.set("loop.lan", "::1");
	await seedRegistered("https://loop.lan/dir", `${"0".repeat(31)}6`);
	const res = await admin.put(SETTINGS, { server: "https://loop.lan/dir" });
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.acme-blocked");
	assert.equal((await admin.get(SETTINGS)).body.server, LE);
	assert.ok(!hasServerLine(await startup()));
});

it("stores failed when Register now is refused", async () => {
	acmeDirectory(api, CA, { status: 503, body: "down", persist: false });
	assert.equal((await admin.put(SETTINGS, { server: CA })).body.warning, "unreachable");
	acmeDirectory(api, CA, { persist: false });
	await writeFile(path.join(api.root, "fake/register.fail"), "refused by the CA");
	const res = await admin.post(`${SETTINGS}/register`, {});
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.acme-refused");
	assert.equal((await account(CA)).state, "failed");
});

it("rewrites the renewal options of the new CA's certificates", async () => {
	const dir = path.join(api.root, "data/tls/certbot/renewal");
	await mkdir(dir, { recursive: true });
	const conf = path.join(dir, "npm-1.conf");
	await writeFile(conf, `[renewalparams]\naccount = abc\nserver = ${ZEROSSL}\n`);
	await seedRegistered(ZEROSSL, `${"0".repeat(31)}8`);
	acmeDirectory(api, ZEROSSL, { persist: false });
	const res = await admin.put(SETTINGS, { server: ZEROSSL });
	assert.equal(res.status, 200, res.text);
	const text = await readFile(conf, "utf8");
	assert.ok(text.split("\n").includes("must_staple = True"), text);
});

it("refuses an http or malformed profiles server", async () => {
	const http = await admin.get(`${SETTINGS}/profiles?server=http://good.lan/dir`);
	assert.equal(http.status, 400);
	assert.equal(http.body.error.message_i18n, "error.acme-url");
	assert.equal((await admin.get(`${SETTINGS}/profiles?server=${GOOD}&server=${CA}`)).status, 400);
	assert.equal((await admin.get(`${SETTINGS}/profiles?server=not-a-url`)).status, 400);
});

const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const tokenOf = async (isAdmin) => {
	const made = await admin.post("/users/me/api-tokens", {
		name: `acme ${isAdmin}`,
		admin: isAdmin,
		visibility: "all",
		permissions: Object.fromEntries(SECTIONS.map((name) => [name, "manage"])),
	});
	if (made.status !== 201) throw new Error(`creating a token answered ${made.status}: ${made.text}`);
	const client = api.client();
	const headers = { authorization: `Bearer ${made.body.token}` };
	return {
		get: (url) => client.get(url, { headers }),
		put: (url, body) => client.put(url, body, { headers }),
		post: (url, body) => client.post(url, body, { headers }),
	};
};

it("lets an Administrator API token read, save and register (D14), and refuses a token without the switch", async () => {
	const token = await tokenOf(true);
	assert.equal((await token.get(SETTINGS)).status, 200);
	acmeDirectory(api, CA, { status: 503, body: "down", persist: false });
	const saved = await token.put(SETTINGS, { server: CA, email: "t@example.com" });
	assert.equal(saved.status, 200, saved.text);
	acmeDirectory(api, CA, { persist: false });
	const registered = await token.post(`${SETTINGS}/register`, {});
	assert.equal(registered.status, 200, registered.text);
	assert.equal(registered.body.account.state, "registered");
	assert.equal((await token.get(`${SETTINGS}/profiles`)).status, 200);
	const plain = await tokenOf(false);
	assert.equal((await plain.get(SETTINGS)).status, 403);
	assert.equal((await plain.put(SETTINGS, { email: "a@example.com" })).status, 403);
	assert.equal((await plain.post(`${SETTINGS}/register`, {})).status, 403);
	assert.equal((await plain.get(`${SETTINGS}/profiles`)).status, 403);
	assert.equal((await admin.get(SETTINGS)).status, 200);
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

it("answers busy and changes nothing while certbot holds its lock, on a save and on Register now", async () => {
	const service = await import("../internal/acme-account.js");
	service.setBusyRetry({ retries: 1, delayMs: 5 });
	try {
		await writeFile(path.join(api.root, "fake/register.fail"), "Another instance of Certbot is already running.");
		acmeDirectory(api, CA);
		const saved = await admin.put(SETTINGS, { server: CA, email: "ops@example.com" });
		assert.equal(saved.status, 400, saved.text);
		assert.equal(saved.body.error.message_i18n, "error.acme-busy");
		assert.equal(await account(CA), undefined);
		assert.equal((await admin.get(SETTINGS)).body.server, LE);
		assert.equal((await registeredCalls()).length, 2);
		acmeDirectory(api, LE);
		const now = await admin.post(`${SETTINGS}/register`, {});
		assert.equal(now.status, 400, now.text);
		assert.equal(now.body.error.message_i18n, "error.acme-busy");
		assert.equal(await account(LE), undefined);
		assert.deepEqual(await api.db("audit_log").where("object_type", "acme-account"), []);
	} finally {
		service.setBusyRetry({ retries: 3, delayMs: 3000 });
	}
});

it("validates the profiles query with the documented parameters", async () => {
	const { getCompiledSchema, getQuerySchema } = await import("../schema/index.js");
	const documented = (await getCompiledSchema()).paths["/settings/acme/profiles"].get.parameters;
	const schema = getQuerySchema("/settings/acme/profiles", "get");
	assert.deepEqual(
		Object.keys(schema.properties),
		documented.map((param) => param.name),
	);
	assert.deepEqual(schema.properties.server, documented[0].schema);
	assert.equal(schema.additionalProperties, false);
	assert.equal(getQuerySchema("/settings/acme/profiles", "get"), schema);
	const long = `https://good.lan/${"a".repeat(255)}`;
	assert.equal((await admin.get(`${SETTINGS}/profiles?server=${long}`)).status, 400);
	acmeDirectory(api, GOOD, { persist: false });
	const other = await admin.get(`${SETTINGS}/profiles?server=${GOOD}&cache=1`);
	assert.equal(other.status, 200, other.text);
});

const UPPER = "https://CA.LAN/dir";

it("loads an old stored CA with an upper-case host in lower case, and stores it so", async () => {
	const { loadAcmeServer, readAcmeSetting, saveAcmeSetting } = await import("../internal/acme-account.js");
	await saveAcmeSetting(UPPER);
	await loadAcmeServer();
	assert.equal(acmeServer.storedAcmeServer(), CA);
	assert.equal(await readAcmeSetting(), CA);
	assert.equal((await admin.get(SETTINGS)).body.server, CA);
});

it("an old stored CA with an upper-case host gets a request, and certbot gets the row's spelling", async () => {
	const { saveAcmeSetting } = await import("../internal/acme-account.js");
	await seedAccount(api, CA, ID);
	await model.query().insert({ server: CA, state: "registered", account_id: ID });
	// stored before the host was lower-cased, and not loaded again since
	await saveAcmeSetting(UPPER);
	acmeServer.setStoredAcmeServer(UPPER);
	await api.outside.clearCalls();
	const made = await admin.post("/nginx/certificates", {
		provider: "letsencrypt",
		domain_names: ["old.example.com"],
	});
	assert.equal(made.status, 201, made.text);
	const calls = await normalizedCalls(api);
	assert.deepEqual(
		calls.filter((line) => line.includes(" register ")),
		[],
	);
	const certonly = calls.find((line) => line.includes(" certonly "));
	assert.ok(certonly.includes(`--server ${CA} --account ${ID}`), certonly);
	await api.db("certificate").where({ id: made.body.id }).delete();
});

it("a save of the same CA in another letter case registers with the row's spelling", async () => {
	// a pending row and the stored CA, both from before the host was lower-cased
	await model.query().insert({ server: UPPER, state: "pending", email: "old@example.com" });
	acmeServer.setStoredAcmeServer(UPPER);
	acmeDirectory(api, CA, { persist: false });
	const res = await admin.put(SETTINGS, { server: CA, email: "ops@example.com" });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.warning, undefined);
	assert.deepEqual(
		(await registeredCalls()).map((line) => line.split(" register ")[1]),
		[`--server ${UPPER}`],
	);
	assert.equal(res.body.account.state, "registered");
	// the folder has the row's spelling, so the account counts as registered and nothing registers again
	await api.outside.clearCalls();
	const { ensureAccount } = await import("../internal/acme-account.js");
	assert.equal(await ensureAccount(CA), (await account(UPPER)).account_id);
	assert.deepEqual(await registeredCalls(), []);
});

it("reads the directory again with fresh, not from the cache (the Connect window's check)", async () => {
	acmeDirectory(api, GOOD, { persist: false });
	assert.equal((await admin.get(`${SETTINGS}/profiles?server=${GOOD}`)).body.reachable, true);
	acmeDirectory(api, GOOD, { status: 503, body: "down", persist: false });
	assert.equal((await admin.get(`${SETTINGS}/profiles?server=${GOOD}`)).body.reachable, true, "cached");
	const fresh = await admin.get(`${SETTINGS}/profiles?server=${GOOD}&fresh=true`);
	assert.equal(fresh.status, 200, fresh.text);
	assert.equal(fresh.body.reachable, false);
});

it("names the Change button for a missing EAB pair on Try again, and the Settings card for a request", async () => {
	const EAB_CA = "https://eab.lan/dir";
	const eabDirectory = () =>
		acmeDirectory(api, EAB_CA, {
			body: { newNonce: "https://eab.lan/n", meta: { externalAccountRequired: true } },
			persist: false,
		});
	api.outside.dns.set("eab.lan", "192.168.1.12");
	await model.query().insert({ server: EAB_CA, state: "pending" });
	acmeServer.setStoredAcmeServer(EAB_CA);
	eabDirectory();
	const retry = await admin.post(`${SETTINGS}/register`, {});
	assert.equal(retry.status, 400, retry.text);
	assert.equal(retry.body.error.message_i18n, "error.acme-set-up");
	eabDirectory();
	const made = await admin.post("/nginx/certificates", {
		provider: "letsencrypt",
		domain_names: ["eab.example.com"],
	});
	assert.equal(made.status, 400, made.text);
	assert.equal(made.body.error.message_i18n, "error.acme-set-up-request");
});
