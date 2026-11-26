import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { generateApiToken } from "../lib/api-token.js";
import { startApi } from "./support/api.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

// The mail and notification settings through the real app: permissions, the sealed password, the env locks, the
// guarded target and the test mail against a fake SMTP server.

const PASSWORD_VALUE = "s3cret-pass-9";
const ENV_VARS = ["SMTP_HOST", "SMTP_PASSWORD", "SMTP_FROM", "PUBLIC_URL"];
const SEALED = /^v1:/u;
const TO_ADMIN = /To: admin@example\.com/u;
const TO_OTHER = /To: someone@example\.org/u;
const SUBJECT = /Subject: \[NPMpro npm\.example\.test\]/u;
const FROM = /From: NPMpro <npmpro@example\.com>/u;
const NO_SUCH_USER = /no such user/u;
const GUARD_MESSAGE = /outbound requests may not reach/u;
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const now = () => Math.floor(Date.now() / 1000);

let api;
let admin;
let accept;
let reject;
let tokens = 0;

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
	admin = await api.admin();
	accept = await startFakeSmtp();
	reject = await startFakeSmtp({ mode: "rcpt-550" });
});
after(async () => {
	for (const name of ENV_VARS) delete process.env[name];
	await accept?.close();
	await reject?.close();
	await api?.stop();
});

const parsed = (meta) => (typeof meta === "string" ? JSON.parse(meta) : meta);
const settingRow = async (id) => parsed((await api.db("setting").where({ id }).first())?.meta);
const auditRows = () => api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "asc");

// a token of the admin, with or without the Administrator switch; each call has a client (and address) of its own
const bearer = async (isAdmin) => {
	tokens += 1;
	const made = generateApiToken();
	const me = (await admin.get("/users/me")).body;
	await api.db("npmpro_api_token").insert({
		user_id: me.id,
		name: `token ${tokens}`,
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		visibility: "user",
		...Object.fromEntries(SECTIONS.map((section) => [section, "manage"])),
		is_admin: isAdmin,
		created_on: now(),
		expires_on: now() + 3600,
	});
	const client = api.client();
	const headers = { authorization: `Bearer ${made.token}` };
	return {
		get: (url) => client.get(url, { headers }),
		put: (url, body) => client.put(url, body, { headers }),
		post: (url, body) => client.post(url, body, { headers }),
	};
};

const serverOf = (fake, extra = {}) => ({
	host: "127.0.0.1",
	port: fake.port,
	security: "none",
	from_address: "npmpro@example.com",
	...extra,
});

it("answers the permissions: a user 403, no session 401, an admin token reads but saves neither area", async () => {
	const user = await api.limited({ visibility: "user", ...Object.fromEntries(SECTIONS.map((s) => [s, "manage"])) });
	for (const [method, url, body] of [
		["get", "/settings/email"],
		["put", "/settings/email", { port: 25 }],
		["post", "/settings/email/test", {}],
		["get", "/settings/notifications"],
		["put", "/settings/notifications", { default_language: "de" }],
	]) {
		assert.equal((await user[method](url, body)).status, 403, `${method} ${url}`);
		assert.equal((await api.client()[method](url, body)).status, 401, `${method} ${url} without a session`);
	}
	const plain = await bearer(false);
	assert.equal((await plain.get("/settings/email")).status, 403);
	const token = await bearer(true);
	assert.equal((await token.get("/settings/email")).status, 200);
	assert.equal((await token.get("/settings/notifications")).status, 200);
	assert.equal((await token.put("/settings/email", { port: 25 })).status, 403);
	// the public URL is the address of reset links: a token cannot move it (D13)
	assert.equal((await token.put("/settings/notifications", { default_language: "de" })).status, 403);
	assert.equal((await admin.put("/settings/notifications", { default_language: "en" })).status, 200);
});

it("starts unconfigured: the defaults, no password, the test mail refused", async () => {
	const got = await admin.get("/settings/email");
	assert.equal(got.status, 200);
	assert.deepEqual(got.body, {
		host: "",
		port: 587,
		security: "starttls",
		verify_tls: true,
		username: "",
		from_address: "",
		from_name: "",
		reply_to: "",
		password_set: false,
		secret_error: false,
		locked: [],
		locked_by: {},
		configured: false,
	});
	const refused = await admin.post("/settings/email/test", {});
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.message_i18n, "error.mail-not-configured");
});

it("the saved host and sender make the mail sender configured (not the env alone)", async () => {
	const { default: internalMail } = await import("../internal/mail.js");
	assert.equal(await internalMail.configured(), false);
	const saved = await admin.put("/settings/email", serverOf(accept));
	assert.equal(saved.status, 200, saved.text);
	assert.equal(saved.body.configured, true);
	assert.equal(saved.body.host, "127.0.0.1");
	assert.equal(await internalMail.configured(), true);
	assert.equal((await internalMail.settings()).email.port, accept.port);
});

it("saves empty optional values", async () => {
	const saved = await admin.put("/settings/email", { reply_to: "", from_name: "", username: "", password: "" });
	assert.equal(saved.status, 200, saved.text);
	assert.equal(saved.body.reply_to, "");
	assert.equal(saved.body.password_set, false);
});

it("keeps the password sealed: never in an answer, the audit log or plain in the row", async () => {
	const saved = await admin.put("/settings/email", { username: "mailer", password: PASSWORD_VALUE });
	assert.equal(saved.status, 200, saved.text);
	assert.equal(saved.body.password_set, true);
	assert.equal("password" in saved.body, false);
	assert.equal((await admin.get("/settings/email")).text.includes(PASSWORD_VALUE), false);
	const row = await settingRow("email");
	assert.equal(JSON.stringify(row).includes(PASSWORD_VALUE), false);
	assert.match(row.password, SEALED);
	assert.equal(JSON.stringify(await auditRows()).includes(PASSWORD_VALUE), false);
	// the generic settings API neither lists nor reads the row
	assert.equal((await admin.get("/settings/email")).body.password_set, true);
	assert.equal(JSON.stringify((await admin.get("/settings")).body).includes('"id":"email"'), false);
	assert.equal((await admin.put("/settings/email", { from_name: "NPMpro" })).body.password_set, true, "kept");
	assert.equal(
		(await admin.put("/settings/email", { password: "" })).body.password_set,
		true,
		"an empty one keeps it",
	);
});

it("sends the test mail with the saved values: one message to the caller, the login of the saved password", async () => {
	assert.equal((await admin.put("/settings/notifications", { public_url: "https://npm.example.test/" })).status, 200);
	const sent = await admin.post("/settings/email/test", {});
	assert.equal(sent.status, 200, sent.text);
	assert.deepEqual(sent.body, { sent: true });
	assert.equal(accept.messages.length, 1);
	const raw = accept.messages[0];
	assert.match(raw, TO_ADMIN);
	assert.match(raw, SUBJECT);
	assert.match(raw, FROM);
	assert.deepEqual(accept.logins.at(-1), { user: "mailer", password: PASSWORD_VALUE });
	const other = await admin.post("/settings/email/test", { to: "someone@example.org" });
	assert.equal(other.status, 200, other.text);
	assert.match(accept.messages.at(-1), TO_OTHER);
	const tested = (await auditRows()).filter((row) => row.action === "test-sent");
	assert.equal(tested.length, 2);
	for (const row of tested) {
		const meta = parsed(row.meta);
		assert.deepEqual(meta, { id: "email" });
	}
	assert.equal(JSON.stringify(tested).includes("someone@example.org"), false);
});

it("refuses a test mail to a bad address", async () => {
	const token = await bearer(true);
	for (const to of ["a@b.c, d@e.f", "x", "a@b.c\r\nBcc: x@y.z"]) {
		const bad = await token.post("/settings/email/test", { to });
		assert.equal(bad.status, 400, to);
	}
	assert.equal(accept.messages.length, 2);
});

it("answers a failed test mail with the scrubbed reply of the server", async () => {
	const saved = await admin.put("/settings/email", { port: reject.port });
	assert.equal(saved.status, 200, saved.text);
	const failed = await (await bearer(true)).post("/settings/email/test", {});
	assert.equal(failed.status, 400);
	assert.equal(failed.body.error.message_i18n, "error.mail-test-failed");
	assert.match(failed.body.error.message_values.error, NO_SUCH_USER);
	assert.equal(failed.text.includes(PASSWORD_VALUE), false);
	assert.equal((await admin.put("/settings/email", { port: accept.port })).status, 200);
});

it("limits the test mail to 5 a minute per address", async () => {
	const token = await bearer(true);
	for (let n = 0; n < 5; n += 1) assert.equal((await token.post("/settings/email/test", {})).status, 200);
	assert.equal((await token.post("/settings/email/test", {})).status, 429);
});

it("removes the password with password_clear, and a password sent with it wins", async () => {
	const both = await admin.put("/settings/email", { password: PASSWORD_VALUE, password_clear: true });
	assert.equal(both.body.password_set, true);
	const cleared = await admin.put("/settings/email", { password_clear: true });
	assert.equal(cleared.status, 200);
	assert.equal(cleared.body.password_set, false);
	assert.equal("password" in (await settingRow("email")), false);
});

it("drops a locked key, never stores the password of the env and lists the locks", async () => {
	process.env.SMTP_HOST = "mail.locked.test";
	process.env.SMTP_PASSWORD = "from-the-env";
	try {
		const got = await admin.get("/settings/email");
		assert.deepEqual(got.body.locked.sort(), ["host", "password"]);
		// the app's JSON replacer blanks every string under a key named password, the variable's name included
		assert.deepEqual(got.body.locked_by, { host: "SMTP_HOST", password: "" });
		assert.equal(got.body.host, "mail.locked.test");
		assert.equal(got.body.password_set, true);
		assert.equal(got.text.includes("from-the-env"), false);

		const saved = await admin.put("/settings/email", {
			host: "other.example.test",
			password: "typed-over",
			from_name: "Locked",
		});
		assert.equal(saved.status, 200, saved.text);
		assert.equal(saved.body.host, "mail.locked.test");
		assert.equal(saved.body.from_name, "Locked");
		const row = await settingRow("email");
		assert.equal(row.host, "127.0.0.1", "the stored host is untouched");
		assert.equal("password" in row, false, "no password stored");
		assert.equal(JSON.stringify(row).includes("from-the-env"), false);
		assert.equal(JSON.stringify(row).includes("typed-over"), false);

		const environment = await admin.get("/settings/environment");
		const locks = environment.body.locked_runtime.filter(({ group }) => group === "email");
		assert.deepEqual(locks.map(({ key, env }) => [key, env]).sort(), [
			["host", "SMTP_HOST"],
			["password", "SMTP_PASSWORD"],
		]);
		process.env.PUBLIC_URL = "https://locked.example.test";
		const notified = await admin.get("/settings/environment");
		assert.deepEqual(
			notified.body.locked_runtime.filter(({ group }) => group === "notifications").map(({ env }) => env),
			["PUBLIC_URL"],
		);
	} finally {
		for (const name of ENV_VARS) delete process.env[name];
	}
});

it("refuses an invalid value with its translation key", async () => {
	for (const [patch, key] of [
		[{ from_address: "a@b.c, d@e.f" }, "settings.email.from-address.invalid"],
		[{ reply_to: "not an address" }, "settings.email.reply-to.invalid"],
		[{ from_name: 'Bad "name"' }, "settings.email.from-name.invalid"],
	]) {
		const refused = await admin.put("/settings/email", patch);
		assert.equal(refused.status, 400, JSON.stringify(patch));
		assert.equal(refused.body.error.message_i18n, key);
	}
	for (const patch of [{ security: "ssl" }, { port: 0 }, { port: 70000 }]) {
		assert.equal((await admin.put("/settings/email", patch)).status, 400, JSON.stringify(patch));
	}
});

it("checks the target at a save that moves it", async () => {
	const saved = await admin.put("/settings/email", { host: "unknown.example.test" });
	assert.equal(saved.status, 400);
	assert.equal(saved.body.error.message_i18n, "error.mail-host-unresolved");

	api.outside.dns.set("mail.public.test", "203.0.113.5");
	const plain = await admin.put("/settings/email", {
		host: "mail.public.test",
		security: "none",
		username: "mailer",
	});
	assert.equal(plain.status, 400);
	assert.equal(plain.body.error.message_i18n, "error.mail-plain-credentials");

	assert.equal((await settingRow("email")).host, "127.0.0.1", "a refused save stores nothing");
});

it("refuses loopback without the test hook", async () => {
	const hook = process.env.NPMPRO_TEST_SMTP;
	delete process.env.NPMPRO_TEST_SMTP;
	try {
		for (const host of ["127.0.0.1", "169.254.1.1"]) {
			const refused = await admin.put("/settings/email", { host, port: 2525 });
			assert.equal(refused.status, 400, host);
			assert.match(refused.body.error.message, GUARD_MESSAGE);
		}
		// an unchanged target is not checked again
		assert.equal((await admin.put("/settings/email", { from_name: "Same" })).status, 200);
	} finally {
		process.env.NPMPRO_TEST_SMTP = hook;
	}
});

it("audits a save with the key names only", async () => {
	assert.equal((await admin.put("/settings/email", { from_name: "Audited", password: PASSWORD_VALUE })).status, 200);
	const row = (await auditRows()).filter((entry) => entry.action === "updated").at(-1);
	const meta = parsed(row.meta);
	assert.equal(meta.id, "email");
	assert.deepEqual(meta.changed.sort(), ["from_name", "password"]);
	assert.equal(JSON.stringify(await auditRows()).includes(PASSWORD_VALUE), false);
});

it("saves the notification settings: public_url without the trailing slash, the language, the locks", async () => {
	const saved = await admin.put("/settings/notifications", {
		public_url: "https://Npm.Example.test/",
		default_language: "de",
	});
	assert.equal(saved.status, 200, saved.text);
	assert.equal(saved.body.public_url, "https://npm.example.test");
	assert.equal(saved.body.default_language, "de");
	for (const public_url of [
		"http://npm.example.test",
		"https://npm.example.test/path",
		"https://u:p@npm.example.test",
		"https://x?a=1",
	]) {
		const refused = await admin.put("/settings/notifications", { public_url });
		assert.equal(refused.status, 400, public_url);
		assert.equal(refused.body.error.message_i18n, "settings.notifications.public-url.invalid");
	}
	assert.equal((await admin.put("/settings/notifications", { default_language: "xx" })).status, 400);
	assert.equal((await admin.put("/settings/notifications", { public_url: "" })).body.public_url, "");

	process.env.MAIL_LANGUAGE = "fr";
	const locked = await admin.put("/settings/notifications", { default_language: "it" });
	delete process.env.MAIL_LANGUAGE;
	assert.equal(locked.body.default_language, "fr");
	assert.deepEqual(locked.body.locked_by, { default_language: "MAIL_LANGUAGE" });
	assert.equal((await settingRow("notifications")).default_language, "de");
	const row = (await auditRows()).filter((entry) => entry.action === "updated").at(-1);
	assert.equal(parsed(row.meta).id, "notifications");
});

it("counts the mail as configured only with a host and a sender", async () => {
	const { default: internalMail } = await import("../internal/mail.js");
	assert.equal((await admin.put("/settings/email", { from_address: "" })).body.configured, false);
	assert.equal(await internalMail.configured(), false);
	assert.equal((await admin.put("/settings/email", { from_address: "npmpro@example.com" })).body.configured, true);
	assert.equal((await admin.put("/settings/email", { host: "" })).body.configured, false);
});

it("answers a guard-blocked host with the translated key and the configured name, on save and on the test mail", async () => {
	const hook = process.env.NPMPRO_TEST_SMTP;
	delete process.env.NPMPRO_TEST_SMTP;
	try {
		const refused = await admin.put("/settings/email", { host: "127.0.0.1", port: 2525 });
		assert.equal(refused.status, 400);
		assert.equal(refused.body.error.message_i18n, "error.mail-host-blocked");
		assert.deepEqual(refused.body.error.message_values, { host: "127.0.0.1" });
	} finally {
		process.env.NPMPRO_TEST_SMTP = hook;
	}
	// a saved host that now resolves to a blocked address (the hook off at send time)
	assert.equal(
		(
			await admin.put("/settings/email", {
				host: "127.0.0.1",
				port: accept.port,
				from_address: "npmpro@example.com",
			})
		).status,
		200,
	);
	delete process.env.NPMPRO_TEST_SMTP;
	try {
		const blocked = await (await bearer(true)).post("/settings/email/test", {});
		assert.equal(blocked.status, 400);
		assert.equal(blocked.body.error.message_i18n, "error.mail-host-blocked");
		assert.deepEqual(blocked.body.error.message_values, { host: "127.0.0.1" });
	} finally {
		process.env.NPMPRO_TEST_SMTP = hook;
	}
});

it("never answers the password a server echoes in its 535 reply, nor its base64", async () => {
	const echo = await startFakeSmtp({ mode: "auth-535-echo" });
	try {
		assert.equal(
			(await admin.put("/settings/email", { port: echo.port, username: "mailer", password: PASSWORD_VALUE }))
				.status,
			200,
		);
		const failed = await (await bearer(true)).post("/settings/email/test", {});
		assert.equal(failed.status, 400);
		assert.equal(failed.body.error.message_i18n, "error.mail-test-failed");
		assert.equal(echo.logins.length > 0, true);
		assert.equal(failed.text.includes(PASSWORD_VALUE), false);
		assert.equal(failed.text.includes(Buffer.from(PASSWORD_VALUE).toString("base64")), false);
	} finally {
		await echo.close();
	}
});

it("answers an unexpected error of the sender with a generic text, never its message", async () => {
	const { default: internalMail } = await import("../internal/mail.js");
	const original = internalMail.sendNow;
	internalMail.sendNow = () => Promise.reject(new TypeError("internal detail /data/secret-path"));
	try {
		const failed = await (await bearer(true)).post("/settings/email/test", {});
		assert.equal(failed.status, 400);
		assert.equal(failed.body.error.message_i18n, "error.mail-test-failed");
		assert.equal(failed.text.includes("secret-path"), false);
		assert.equal(typeof failed.body.error.message_values.error, "string");
	} finally {
		internalMail.sendNow = original;
	}
});
