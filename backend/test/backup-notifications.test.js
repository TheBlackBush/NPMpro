import assert from "node:assert/strict";
import { after, afterEach, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

// The settings_notifications backup type through the real app: the mail password travels with the secrets, a restore
// reseals it, a restore without secrets leaves none, and the env lock still wins after a restore.

const BASE = "/backups";
const PASSPHRASE = "a long passphrase 1";
const TYPES = ["settings_notifications"];
const SEALED = /^v1:/u;

let api;
let admin;
let smtp;
let secretBox;

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
	admin = await api.admin();
	smtp = await startFakeSmtp();
	secretBox = (await import("../lib/secret-box.js")).defaultSecretBox;
});
afterEach(() => {
	delete process.env.SMTP_HOST;
	delete process.env.SMTP_PASSWORD;
});
after(async () => {
	await smtp?.close();
	await api?.stop();
});

// a helper outside a test: a refused call stops the test with the answer
const ok = (done) => {
	if (done.status !== 200) throw new Error(`${done.status} ${done.text}`);
};
const metaOf = async (id) => {
	const meta = (await api.db("setting").where({ id }).first())?.meta;
	return typeof meta === "string" ? JSON.parse(meta) : meta;
};
const save = async (body) => {
	const done = await admin.put("/settings/email", {
		host: "127.0.0.1",
		port: smtp.port,
		security: "none",
		from_address: "npmpro@example.com",
		...body,
	});
	ok(done);
	return done.body;
};
const keep = async (body) => {
	const done = await admin.post(BASE, { types: TYPES, keep: true, ...body });
	ok(done);
	return done.body.entry;
};
const restore = async (entry, body = {}) => {
	const { token } = (await admin.post(`${BASE}/${entry.name}/inspect`, body)).body;
	const done = await admin.post(`${BASE}/restore/${token}`, { types: TYPES, confirm: true });
	ok(done);
};

it("travels with its password: restored sealed with this instance's box", async () => {
	await save({ password: "mail-pass-1" });
	await admin.put("/settings/notifications", { default_language: "de" });
	const entry = await keep({ secrets: true, passphrase: PASSPHRASE });
	await save({ password: "other-pass", host: "127.0.0.2" });
	await admin.put("/settings/notifications", { default_language: "en" });

	await restore(entry, { passphrase: PASSPHRASE });
	const email = await metaOf("email");
	assert.match(email.password, SEALED);
	assert.equal(secretBox.decrypt(email.password), "mail-pass-1");
	assert.equal(email.host, "127.0.0.1");
	assert.equal((await admin.get("/settings/email")).body.password_set, true);
	assert.equal((await admin.get("/settings/notifications")).body.default_language, "de");
});

it("a backup without secrets restores no password", async () => {
	await save({ password: "mail-pass-2" });
	const entry = await keep({ secrets: false });
	await restore(entry);
	const got = await admin.get("/settings/email");
	assert.equal(got.body.password_set, false);
	assert.equal(got.body.host, "127.0.0.1");
	assert.equal(Object.hasOwn(await metaOf("email"), "password"), false);
});

it("the env lock holds after a restore", async () => {
	await save({});
	const entry = await keep({ secrets: false });
	await save({ host: "127.0.0.2" });
	process.env.SMTP_HOST = "env-smtp.example.com";
	await restore(entry);
	const got = (await admin.get("/settings/email")).body;
	assert.equal(got.host, "env-smtp.example.com");
	assert.ok(got.locked.includes("host"));
});

it("an env password still wins after a restore with secrets", async () => {
	await save({ password: "mail-pass-3" });
	const entry = await keep({ secrets: true, passphrase: PASSPHRASE });
	await admin.put("/settings/email", { password_clear: true });
	process.env.SMTP_PASSWORD = "env-pass";
	await restore(entry, { passphrase: PASSPHRASE });
	const got = (await admin.get("/settings/email")).body;
	assert.equal(got.password_set, true);
	assert.ok(got.locked.includes("password"));
	// the restored row still holds the backup's password under the env one
	assert.equal(secretBox.decrypt((await metaOf("email")).password), "mail-pass-3");
});
