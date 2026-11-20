import assert from "node:assert/strict";
import { chmod, copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls, seedAccount } from "./support/certbot.js";

const CA = "https://acme.test/directory";
const LAN = "https://ca.lan/dir";
const ZEROSSL = "https://acme.zerossl.com/v2/DV90";
const ID1 = `${"0".repeat(31)}1`;
const EAB_REQUIRED = { newNonce: "https://ca.lan/n", meta: { externalAccountRequired: true } };
let api;
let service;
let model;

// text checks without regexes (Biome wants those at module level): a whole line, or a value anywhere in a text
const hasLine = (text, line) => text.split("\n").includes(line);
const containsAny = (text, values) => values.some((value) => text.includes(value));
const readFake = (name) => readFile(path.join(api.root, "fake", name), "utf8");
const FAKE_FILES = [".ini", ".fail", ".mode"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const registerCalls = async () => (await normalizedCalls(api)).filter((line) => line.includes(" register "));

const waitForRegisterCalls = async (count) => {
	for (let tries = 0; tries < 100; tries += 1) {
		if ((await registerCalls()).length >= count) return;
		await sleep(50);
	}
	throw new Error("certbot register was not called");
};

before(async () => {
	api = await startApi({ env: { ACME_SERVER: CA, NPMPRO_TEST_OUTBOUND: "mock" } });
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	api.outside.dns.set("ca.lan", "192.168.1.10");
	api.outside.dns.set("acme.zerossl.com", "192.0.2.20");
	service = await import("../internal/acme-account.js");
	model = (await import("../models/acme_account.js")).default;
});
beforeEach(async () => {
	await model.query().delete();
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	for (const name of await readdir(path.join(api.root, "fake"))) {
		if (FAKE_FILES.some((end) => name.endsWith(end))) await rm(path.join(api.root, "fake", name));
	}
	await api.outside.clearCalls();
});
after(() => api.stop());

it("registers the instance CA once without an email, in a run folder that is removed afterwards", async () => {
	acmeDirectory(api, CA);
	assert.equal(await service.ensureAccount(CA), ID1);
	assert.equal(await service.ensureAccount(CA), ID1);
	assert.deepEqual(await normalizedCalls(api), [
		`certbot --config /tmp/acme-register-*/certbot.ini register --server ${CA} --register-unsafely-without-email`,
	]);
	const row = await model.query().where("server", CA).first();
	assert.equal(row.state, "registered");
	assert.equal(row.account_id, ID1);
	assert.deepEqual(await readdir(path.join(api.root, "tmp")), []);
	const ini = await readFile(path.join(api.root, "fake/register-1.ini"), "utf8");
	assert.ok(hasLine(ini, "agree-tos = true"));
	assert.ok(
		ini
			.split("\n")
			.some(
				(line) => line.startsWith("logs-dir = ") && line.includes("acme-register-") && line.endsWith("/logs"),
			),
	);
});

it("runs one registration for two callers at once", async () => {
	acmeDirectory(api, CA);
	const [a, b] = await Promise.all([service.ensureAccount(CA), service.ensureAccount(CA)]);
	assert.equal(a, b);
	assert.equal((await registerCalls()).length, 1);
});

it("registers again when the registered account's folder is gone", async () => {
	acmeDirectory(api, CA);
	await service.ensureAccount(CA);
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true });
	assert.notEqual(await service.ensureAccount(CA), undefined);
	assert.equal((await registerCalls()).length, 2);
});

it("puts the email and the EAB pair in the run config, never on the command line", async () => {
	acmeDirectory(api, LAN, { body: EAB_REQUIRED, persist: false });
	const eab = { kid: "kid-1", hmac: "hmac-secret-1" };
	const result = await service.attemptRegistration(LAN, { email: "ops@example.com", eab });
	assert.equal(result.outcome, "registered");
	const ini = await readFile(path.join(api.root, "fake/register-1.ini"), "utf8");
	assert.ok(hasLine(ini, "email = ops@example.com"));
	assert.ok(hasLine(ini, "eab-kid = kid-1"));
	assert.ok(hasLine(ini, "eab-hmac-key = hmac-secret-1"));
	const calls = (await normalizedCalls(api)).join("\n");
	for (const secret of ["ops@example.com", "kid-1", "hmac-secret-1", "--register-unsafely-without-email"]) {
		assert.ok(!calls.includes(secret), `${secret} is on the command line`);
	}
});

it("writes the run config with mode 0600 in a private folder, and removes it when certbot fails", async () => {
	acmeDirectory(api, CA);
	await service.ensureAccount(CA);
	assert.equal((await readFile(path.join(api.root, "fake/register-1.mode"), "utf8")).trim(), "600\n700");
	await model.query().delete();
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true });
	await writeFile(path.join(api.root, "fake/register.fail"), "boom");
	await assert.rejects(
		service.attemptRegistration(CA, { email: "ops@example.com", eab: null }),
		(err) => err.message_i18n === "error.acme-refused",
	);
	assert.deepEqual(await readdir(path.join(api.root, "tmp")), []);
});

it("removes the update_account run folder when certbot fails", async () => {
	acmeDirectory(api, CA);
	await service.ensureAccount(CA);
	await writeFile(path.join(api.root, "fake/update_account.fail"), "boom");
	await assert.rejects(
		service.updateEmail(CA, "new@example.com"),
		(err) => err.message_i18n === "error.acme-refused",
	);
	assert.deepEqual(await readdir(path.join(api.root, "tmp")), []);
	assert.equal((await model.query().where("server", CA).first()).email, null);
});

it("seals the EAB pair, never returns it and drops it after a registration", async () => {
	const sealed = service.seal("hmac-secret-2");
	assert.notEqual(sealed, null);
	assert.ok(!sealed.includes("hmac-secret-2"));
	assert.equal(service.open(sealed), "hmac-secret-2");
	assert.equal(service.seal(""), null);
	assert.equal(service.open(null), null);
	assert.equal(service.open("not sealed"), null);
	acmeDirectory(api, LAN, { body: EAB_REQUIRED, persist: false });
	const row = await model.query().insertAndFetch({
		server: LAN,
		state: "pending",
		email: "ops@example.com",
		eab_kid: service.seal("kid-2"),
		eab_hmac_key: service.seal("hmac-secret-2"),
	});
	assert.deepEqual(service.registrationValues(LAN, row), {
		email: "ops@example.com",
		eab: { kid: "kid-2", hmac: "hmac-secret-2" },
	});
	const view = service.accountView(row);
	assert.equal(view.eab_kid_set, true);
	assert.equal(view.eab_hmac_key_set, true);
	assert.ok(!containsAny(JSON.stringify(view), ["kid-2", "hmac-secret-2"]));
	assert.ok(!JSON.stringify(row).includes("eab_"));
	await service.ensureAccount(LAN);
	const stored = await model.query().where("server", LAN).first();
	assert.equal(stored.state, "registered");
	assert.equal(stored.eab_kid, null);
	assert.equal(stored.eab_hmac_key, null);
	assert.ok(hasLine(await readFake("register-1.ini"), "eab-hmac-key = hmac-secret-2"));
	assert.ok(!containsAny((await normalizedCalls(api)).join("\n"), ["hmac-secret-2", "kid-2"]));
});

it("keeps the EAB pair and the email out of the audit log, the stored error and every log line", async () => {
	acmeDirectory(api, LAN, { body: EAB_REQUIRED, persist: false });
	await writeFile(path.join(api.root, "fake/register.fail"), "bad key kid-3 hmac-secret-3 for ops@example.com");
	await model.query().insert({
		server: LAN,
		state: "pending",
		email: "ops@example.com",
		eab_kid: service.seal("kid-3"),
		eab_hmac_key: service.seal("hmac-secret-3"),
	});
	// the backend logs through console.log, which startApi silences: capture it for this call
	const silenced = console.log;
	const logged = [];
	console.log = (...args) => logged.push(args.map(String).join(" "));
	try {
		await assert.rejects(service.ensureAccount(LAN), (err) => err.message_i18n === "error.acme-refused");
	} finally {
		console.log = silenced;
	}
	// the capture works: the debug line of the certbot call is there, without the secrets
	assert.ok(logged.some((line) => line.includes("CMD: certbot")));
	assert.ok(!containsAny(logged.join("\n"), ["kid-3", "hmac-secret-3", "ops@example.com"]));
	const row = await model.query().where("server", LAN).first();
	const everything = JSON.stringify([row.error, await api.db("audit_log")]);
	assert.ok(!containsAny(everything, ["kid-3", "hmac-secret-3", "ops@example.com"]));
	assert.ok(row.error.includes("[hidden]"));
	assert.deepEqual(await readdir(path.join(api.root, "tmp")), []);
});

it("hides the email in any letter case and URL-encoded", () => {
	const text = "bad Ops@Example.COM, ops%40example.com and OPS%40EXAMPLE.COM, key K-1";
	const out = service.scrub(text, ["ops@example.com", "k-1", ""]);
	assert.equal(out, "bad [hidden], [hidden] and [hidden], key [hidden]");
	assert.equal(service.scrub("", ["a"]), "certbot failed without a message");
});

it("shares one lock and one account between the spellings of a CA URL", async () => {
	acmeDirectory(api, CA);
	const other = "https://ACME.test/directory/";
	await writeFile(path.join(api.root, "fake/hold"), CA);
	let ids;
	try {
		const first = service.ensureAccount(CA);
		await waitForRegisterCalls(1);
		const second = service.ensureAccount(other);
		await sleep(300);
		assert.equal((await registerCalls()).length, 1);
		await rm(path.join(api.root, "fake/hold"));
		ids = await Promise.all([first, second]);
	} finally {
		await rm(path.join(api.root, "fake/hold"), { force: true });
	}
	// the second spelling finds the first one's row and account: no second registration, no second row
	assert.deepEqual(ids, [ID1, ID1]);
	assert.equal((await registerCalls()).length, 1);
	assert.equal(await model.query().resultSize(), 1);
});

it("maps a Let's Encrypt URL with a trailing slash and the v01 URL to the one row of the CA", async () => {
	const LE = "https://acme-v02.api.letsencrypt.org/directory";
	const id = "f".repeat(32);
	await seedAccount(api, LE, id);
	await model.query().insert({ server: LE, state: "registered", account_id: id });
	assert.equal(await service.ensureAccount(`${LE}/`), id);
	assert.equal(await service.ensureAccount("https://acme-v01.api.letsencrypt.org/directory"), id);
	assert.equal((await service.accountRow("https://acme-v01.api.letsencrypt.org/directory/")).server, LE);
	assert.equal(await model.query().resultSize(), 1);
	assert.deepEqual(await registerCalls(), []);
});

it("does not hold a registration of one CA behind a slow registration of another", async () => {
	acmeDirectory(api, CA);
	acmeDirectory(api, LAN, { persist: false });
	await writeFile(path.join(api.root, "fake/hold"), CA);
	try {
		const slow = service.ensureAccount(CA);
		await waitForRegisterCalls(1);
		const id = await service.ensureAccount(LAN);
		assert.equal(typeof id, "string");
		assert.equal((await model.query().where("server", CA).first())?.state, undefined);
		await rm(path.join(api.root, "fake/hold"));
		await slow;
	} finally {
		await rm(path.join(api.root, "fake/hold"), { force: true });
	}
	assert.equal((await model.query().where("server", CA).first()).state, "registered");
});

it("refuses a CA that needs EAB without a pair, and stores the failure for a lazy registration", async () => {
	acmeDirectory(api, LAN, { body: EAB_REQUIRED, persist: false });
	await assert.rejects(service.ensureAccount(LAN), (err) => err.message_i18n === "error.acme-set-up");
	assert.equal((await model.query().where("server", LAN).first()).state, "failed");
	assert.deepEqual(await normalizedCalls(api), []);
});

it("fetches a ZeroSSL pair from the email, uses it once and stores it nowhere", async () => {
	acmeDirectory(api, ZEROSSL, { body: EAB_REQUIRED, persist: false });
	api.outside.http
		.get("https://api.zerossl.com")
		.intercept({ path: "/acme/eab-credentials-email", method: "POST" })
		.reply(
			200,
			{ success: true, eab_kid: "zs-kid", eab_hmac_key: "zs-hmac" },
			{ headers: { "content-type": "application/json" } },
		);
	const result = await service.attemptRegistration(ZEROSSL, { email: "ops@example.com", eab: null });
	assert.equal(result.outcome, "registered");
	assert.ok(hasLine(await readFake("register-1.ini"), "eab-hmac-key = zs-hmac"));
	assert.equal(await model.query().where("server", ZEROSSL).first(), undefined);
});

it("keeps a CA that cannot be reached pending, without running certbot", async () => {
	acmeDirectory(api, LAN, { status: 503, body: "down", persist: false });
	await assert.rejects(
		service.ensureAccount(LAN),
		(err) => err.message_i18n === "error.acme-unreachable" && err.message.endsWith("(it answered with HTTP 503)"),
	);
	assert.equal((await model.query().where("server", LAN).first()).state, "pending");
	assert.deepEqual(await normalizedCalls(api), []);
});

it("stores a refusal as failed, with the email hidden in the message and the audit entry", async () => {
	acmeDirectory(api, CA);
	await writeFile(path.join(api.root, "fake/register.fail"), "invalidContact: ops@bad.example is not allowed");
	process.env.ACME_EMAIL = "ops@bad.example";
	try {
		await assert.rejects(service.ensureAccount(CA), (err) => err.message_i18n === "error.acme-refused");
	} finally {
		delete process.env.ACME_EMAIL;
	}
	const row = await model.query().where("server", CA).first();
	assert.equal(row.state, "failed");
	assert.ok(!row.error.includes("ops@bad.example"));
	const audit = await api.db("audit_log").where("object_type", "acme-account");
	assert.ok(audit.some((entry) => entry.action === "registration-failed"));
	assert.equal(audit[0].user_id, 0);
	assert.ok(!JSON.stringify(audit).includes("ops@bad.example"));
});

it("changes and removes the email of a registered account, and refuses while the CA cannot be reached", async () => {
	acmeDirectory(api, CA);
	const id = await service.ensureAccount(CA);
	await service.updateEmail(CA, "new@example.com");
	await service.updateEmail(CA, "");
	const calls = (await normalizedCalls(api)).filter((line) => line.includes("update_account"));
	assert.deepEqual(calls, [
		`certbot --config /tmp/acme-register-*/certbot.ini update_account --server ${CA} --account ${id}`,
		`certbot --config /tmp/acme-register-*/certbot.ini update_account --server ${CA} --account ${id} --register-unsafely-without-email`,
	]);
	assert.ok(hasLine(await readFake("update_account-1.ini"), "email = new@example.com"));
	assert.equal((await model.query().where("server", CA).first()).email, null);
	acmeDirectory(api, LAN, { status: 503, body: "down", persist: false });
	await seedAccount(api, LAN, "c".repeat(32));
	await model
		.query()
		.insert({ server: LAN, state: "registered", account_id: "c".repeat(32), email: "keep@example.com" });
	await assert.rejects(
		service.updateEmail(LAN, "other@example.com"),
		(err) => err.message_i18n === "error.acme-email-offline",
	);
	assert.equal((await model.query().where("server", LAN).first()).email, "keep@example.com");
});

const BUSY = "Another instance of Certbot is already running.";

it("retries a registration while certbot is busy with another run, and stores nothing while it stays busy", async () => {
	service.setBusyRetry({ retries: 2, delayMs: 5 });
	const hook = path.join(api.root, "fake/certbot.hook");
	const real = path.join(api.root, "fake/certbot-real");
	const count = path.join(api.root, "fake/busy-count");
	await copyFile(hook, real);
	await chmod(real, 0o755);
	try {
		// busy once, then the real fake certbot
		await writeFile(count, "");
		await writeFile(
			hook,
			`#!/bin/sh\necho x >> "${count}"\nif [ "$(wc -l < "${count}")" -le 1 ]; then echo "${BUSY}" >&2; exit 1; fi\nexec "${real}" "$@"\n`,
		);
		acmeDirectory(api, CA);
		assert.equal(await service.ensureAccount(CA), ID1);
		assert.equal((await model.query().where("server", CA).first()).state, "registered");
		// busy every time: the caller gets the busy error, the row is not marked failed and no audit entry is written
		await model.query().delete();
		await api.db("audit_log").where("object_type", "acme-account").delete();
		await writeFile(hook, `#!/bin/sh\necho x >> "${count}"\necho "${BUSY}" >&2\nexit 1\n`);
		await writeFile(count, "");
		acmeDirectory(api, LAN, { persist: false });
		await assert.rejects(service.ensureAccount(LAN), (err) => err.message_i18n === "error.acme-busy");
		assert.equal((await readFile(count, "utf8")).trim().split("\n").length, 3);
		assert.equal(await model.query().where("server", LAN).first(), undefined);
		assert.deepEqual(await api.db("audit_log").where("object_type", "acme-account"), []);
	} finally {
		await copyFile(real, hook);
		await rm(real, { force: true });
		service.setBusyRetry({ retries: 3, delayMs: 3000 });
	}
});

it("adopts a usable account folder instead of registering again", async () => {
	const id = "e".repeat(32);
	await seedAccount(api, LAN, id);
	await model.query().insert({ server: LAN, state: "failed", error: "killed after certbot wrote the account" });
	assert.equal(await service.ensureAccount(LAN), id);
	const row = await model.query().where("server", LAN).first();
	assert.equal(row.state, "registered");
	assert.equal(row.account_id, id);
	assert.equal(row.error, null);
	// no row at all: the folder is adopted too
	await model.query().delete();
	assert.equal(await service.ensureAccount(LAN), id);
	assert.equal(await model.query().resultSize(), 1);
	assert.deepEqual(await registerCalls(), []);
});
