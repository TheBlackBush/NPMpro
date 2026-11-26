import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startApi } from "./support/api.js";
import { migratedSqlite } from "./support/database.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

const TABLE = "npmpro_notification_delivery";
const START = Date.parse("2026-11-26T10:00:00Z");
const MINUTE = 60_000;
const SIX_HOURS = 6 * 3_600_000;
const PASSWORD = "s3cret-pass-word";
const BOB = "bob@example.net";
const ENV_NAMES = ["NPMPRO_TEST_SMTP"];
const SUBJECT = /Subject: \[NPMpro [^\]]+\] Notice/u;
const SENT_TO = /To: bob@example\.net/u;
const INSTANCE_SUBJECT = /Subject: \[NPMpro npm\.example\.com\] Notice/u;
const NEVER_QUEUED = /never queued/u;
const MASKED = /\*\*\*/u;
const NOT_A_STRING = /must be a string/u;
const NO_SUCH_USER = /no such user/u;
const LOGO_PARTS = /Content-ID: <logo@npmpro>/gu;
const LOGO_INLINE = /Content-Disposition: inline/u;
const HTML_PART = /Content-Type: text\/html[\s\S]*?\r?\n\r?\n(?<body>[\s\S]*?)\r?\n--/u;
const SOFT_BREAK = /[=]\r?\n/gu;
const QP_BYTE = /[=](?<hex>[0-9A-F]{2})/gu;
const PNG_PART = /Content-Type: image\/png/u;

// the HTML part of a raw message, quoted-printable decoded, so a soft line break cannot split what a test looks for
const htmlOf = (raw) => {
	const body = raw.match(HTML_PART)?.groups.body ?? "";
	const bytes = body
		.replace(SOFT_BREAK, "")
		.replace(QP_BYTE, (_whole, ...rest) => String.fromCharCode(Number.parseInt(rest.at(-1).hex, 16)));
	return Buffer.from(bytes, "latin1").toString("utf8");
};

// what the raw message says about the logo: attached once, inline, and the HTML part points at the same cid
const logoFacts = (raw) => ({
	parts: raw.match(LOGO_PARTS)?.length,
	inline: LOGO_INLINE.test(raw),
	png: PNG_PART.test(raw),
	referenced: htmlOf(raw).includes('<img src="cid:logo@npmpro"'),
});
const LOGO_ONCE = { parts: 1, inline: true, png: true, referenced: true };

const api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
const { createMailChannel } = await import("../lib/mail/channel.js");
const { EMAIL_DEFAULTS } = await import("../lib/mail/settings-rules.js");
const { MailError, sendMail } = await import("../lib/mail/transport.js");
const { createQueue } = await import("../lib/notify/queue.js");
const { createWorker } = await import("../lib/notify/worker.js");
const { renderMail, TEMPLATES } = await import("../mail/render.js");
const { default: internalMail } = await import("../internal/mail.js");

const clock = { at: START, now: () => clock.at };
const notice = () => ({ subject: "Notice", lines: ["Hello"], footer: [] });

let db;
let port;
let audits;
let queue;
let override = {};
let settingsBroken = false;
let worker;
let channel;
let appWorker;
const servers = [];

const emailValues = () => ({
	...EMAIL_DEFAULTS,
	host: "127.0.0.1",
	port,
	security: "none",
	password: PASSWORD,
	from_address: "npm@example.com",
});
const settings = () => ({
	email: { ...emailValues(), ...override },
	notifications: { public_url: "", default_language: "en" },
});
const listen = async (mode) => {
	const fake = await startFakeSmtp({ mode });
	servers.push(fake);
	return fake;
};
const row = () => ({
	message_id: "msg_a",
	event: "mail.notice",
	channel: "mail",
	payload: { to: BOB, template: "notice", language: "en", data: {} },
});
const rowsOf = () => db.knex(TABLE).orderBy("id");
const pass = async () => {
	await worker.runOnce();
};

before(async () => {
	db = await migratedSqlite();
	TEMPLATES.notice = notice;
});

after(async () => {
	delete TEMPLATES.notice;
	for (const fake of servers) await fake.close();
	await db?.cleanup?.();
	await api.stop();
	for (const name of ENV_NAMES) delete process.env[name];
});

describe("the mail channel on the worker", () => {
	beforeEach(async () => {
		clock.at = START;
		override = {};
		settingsBroken = false;
		audits = [];
		await db.knex(TABLE).delete();
		queue = createQueue({ knex: db.knex, clock });
		channel = createMailChannel({
			settings: () =>
				settingsBroken ? Promise.reject(new Error(`broken ${PASSWORD}`)) : Promise.resolve(settings()),
			send: sendMail,
			render: renderMail,
			audit: (entry) => {
				audits.push(entry);
				return Promise.resolve();
			},
			clock,
		});
		worker = createWorker({ queue, channels: [channel] });
		worker.start();
		await pass();
	});

	after(() => worker?.stop());

	it("is the mail channel, takes no event in PR 2a and waits 1 min, 5 min, 30 min, 2 h, 6 h", () => {
		assert.equal(channel.id, "mail");
		assert.equal(channel.accepts("host.created"), false);
		assert.deepEqual(channel.retryDelays, [60e3, 300e3, 1_800e3, 7_200e3, 21_600e3]);
	});

	it("sends a queued account mail through the SMTP server", async () => {
		const fake = await listen("accept");
		port = fake.port;
		await queue.add([row()]);
		await pass();
		const [stored] = await rowsOf();
		assert.equal(stored.status, "sent");
		assert.equal(stored.payload, null);
		assert.equal(fake.messages.length, 1);
		assert.match(fake.messages[0], SUBJECT);
		assert.match(fake.messages[0], SENT_TO);
		assert.equal(audits.length, 0);
	});

	it("retries a 450 after 1 minute, then sends", async () => {
		const busy = await listen("rcpt-450");
		port = busy.port;
		await queue.add([row()]);
		await pass();
		let [stored] = await rowsOf();
		assert.equal(stored.status, "pending");
		assert.equal(stored.attempts, 1);
		assert.equal(busy.messages.length, 0);
		assert.equal(audits.length, 0);

		clock.at += MINUTE - 1000;
		await pass();
		[stored] = await rowsOf();
		assert.equal(stored.attempts, 1);

		const fine = await listen("accept");
		port = fine.port;
		clock.at += 1000;
		await pass();
		[stored] = await rowsOf();
		assert.equal(stored.status, "sent");
		assert.equal(fine.messages.length, 1);
		assert.equal(audits.length, 0);
	});

	it("fails a 550 at once with one audit row that holds no address and no password", async () => {
		const fake = await listen("rcpt-550");
		port = fake.port;
		await queue.add([row()]);
		await pass();
		const [stored] = await rowsOf();
		assert.equal(stored.status, "failed");
		assert.equal(stored.attempts, 1);
		assert.equal(audits.length, 1);
		const [entry] = audits;
		assert.equal(entry.action, "mail-failed");
		assert.equal(entry.object_type, "setting");
		assert.deepEqual(
			Object.keys(entry.meta).sort((left, right) => left.localeCompare(right)),
			["error", "id", "kind", "recipients"],
		);
		assert.equal(entry.meta.id, "email");
		assert.equal(entry.meta.kind, "notice");
		assert.equal(entry.meta.recipients, 1);
		assert.match(entry.meta.error, NO_SUCH_USER);
		assert.ok(!JSON.stringify(entry).includes(BOB));
		assert.ok(!JSON.stringify(entry).includes(PASSWORD));
		assert.ok(!stored.error.includes(PASSWORD));
	});

	it("keeps the row pending through five 450 replies and fails at the sixth, with one audit row", async () => {
		const fake = await listen("rcpt-450");
		port = fake.port;
		await queue.add([row()]);
		for (let attempt = 1; attempt <= 5; attempt++) {
			await pass();
			const [stored] = await rowsOf();
			assert.equal(stored.status, "pending");
			assert.equal(stored.attempts, attempt);
			clock.at += SIX_HOURS;
		}
		assert.equal(audits.length, 0);
		await pass();
		const [stored] = await rowsOf();
		assert.equal(stored.status, "failed");
		assert.equal(stored.attempts, 6);
		assert.equal(audits.length, 1);
		assert.equal(audits[0].meta.recipients, 1);
	});

	it("fails a row without content at once", async () => {
		const fake = await listen("accept");
		port = fake.port;
		await queue.add([{ ...row(), payload: null }]);
		await pass();
		const [stored] = await rowsOf();
		assert.equal(stored.status, "failed");
		assert.equal(stored.attempts, 1);
		assert.equal(fake.messages.length, 0);
		assert.equal(audits.length, 1);
	});
});

describe("the mail channel, final failures", () => {
	const auditsOf = [];
	const stub = (message, retry = false) =>
		createMailChannel({
			settings: () => Promise.resolve(settings()),
			send: () => Promise.reject(new MailError(message, { retry })),
			render: renderMail,
			audit: (entry) => {
				auditsOf.push(entry);
				return Promise.resolve();
			},
		});
	const rowOf = (to, attempts = 0) => ({
		id: 1,
		attempts,
		event: "mail.notice",
		payload: { to, template: "notice", language: "en", data: {} },
	});

	beforeEach(() => {
		auditsOf.length = 0;
		override = {};
		port = 25;
	});

	it("masks an address in any case before the text is cut, and an address the cut splits", async () => {
		const upper = await stub(`550 no mailbox ${BOB.toUpperCase()} here`).send([rowOf(BOB)]);
		assert.ok(!upper[0].error.toLowerCase().includes("bob@"), upper[0].error);
		assert.match(upper[0].error, MASKED);
		// the address starts 290 characters in, so the cut of the text falls inside it
		const cut = await stub(`${"x".repeat(290)}${BOB}`).send([rowOf(BOB)]);
		assert.ok(!cut[0].error.includes("bob"), cut[0].error);
		assert.ok(!JSON.stringify(auditsOf).toLowerCase().includes("bob"), JSON.stringify(auditsOf));
		assert.equal(auditsOf.length, 2);
	});

	it("retries a settings read that fails, then audits the final failure without the error's secret", async () => {
		settingsBroken = true;
		const failing = createMailChannel({
			settings: () => Promise.reject(new Error(`broken ${PASSWORD}`)),
			send: sendMail,
			render: renderMail,
			audit: (entry) => {
				auditsOf.push(entry);
				return Promise.resolve();
			},
		});
		const [again] = await failing.send([rowOf(BOB, 2)]);
		assert.equal(again.ok, false);
		assert.equal(again.retry, true);
		assert.equal(auditsOf.length, 0);
		const [last] = await failing.send([rowOf(BOB, 5)]);
		assert.equal(last.retry, true);
		assert.equal(auditsOf.length, 1);
		assert.equal(auditsOf[0].action, "mail-failed");
		assert.ok(!JSON.stringify(auditsOf).includes(PASSWORD));
	});

	it("fails invalid mail settings at once with one audit row", async () => {
		override = { from_address: "not an address" };
		const [result] = await stub("never sent").send([rowOf(BOB)]);
		assert.equal(result.ok, false);
		assert.equal(result.retry, false);
		assert.equal(auditsOf.length, 1);
		assert.equal(auditsOf[0].meta.recipients, 1);
	});
});

describe("internalMail", () => {
	const sentTo = (fake) => fake.messages.length;
	const serveWith = async (mode) => {
		const fake = await listen(mode);
		internalMail.useSettings(() =>
			Promise.resolve({
				email: { ...emailValues(), port: fake.port },
				notifications: { public_url: "https://npm.example.com", default_language: "de" },
			}),
		);
		return fake;
	};
	const stored = () => api.db(TABLE).where({ channel: "mail" });

	before(async () => {
		({ worker: appWorker } = await import("../internal/notify.js"));
		appWorker.start();
	});

	beforeEach(async () => {
		await api.db(TABLE).delete();
	});

	after(() => appWorker.stop());

	it("queues an account mail that the running worker sends", async () => {
		const fake = await serveWith("accept");
		assert.deepEqual(await internalMail.queueMail({ to: BOB, template: "notice", language: "en" }), {
			queued: true,
		});
		for (let wait = 0; wait < 100 && sentTo(fake) === 0; wait++) await new Promise((done) => setTimeout(done, 100));
		assert.equal(sentTo(fake), 1);
		assert.match(fake.messages[0], INSTANCE_SUBJECT);
		assert.deepEqual(logoFacts(fake.messages[0]), LOGO_ONCE);
		const [one] = await stored();
		assert.equal(one.status, "sent");
		assert.equal(one.group_key, null);
	});

	it("writes the mail-failed audit row of a refused queued mail through the real audit log", async () => {
		await serveWith("rcpt-550");
		await api.db("audit_log").where({ action: "mail-failed" }).delete();
		await internalMail.queueMail({ to: BOB, template: "notice", language: "en" });
		let logged = [];
		for (let wait = 0; wait < 100 && logged.length === 0; wait++) {
			await new Promise((done) => setTimeout(done, 100));
			logged = await api.db("audit_log").where({ action: "mail-failed" });
		}
		assert.equal(logged.length, 1);
		assert.equal(logged[0].object_type, "setting");
		assert.ok(!JSON.stringify(logged[0]).includes(BOB));
		assert.ok(!JSON.stringify(logged[0]).includes(PASSWORD));
	});

	it("throws for a caller bug only: a direct template, a template name or a recipient that is not a string", async () => {
		await serveWith("accept");
		await assert.rejects(internalMail.queueMail({ to: BOB, template: "test", language: "en" }), NEVER_QUEUED);
		await assert.rejects(internalMail.queueMail({ to: BOB, template: 7, language: "en" }), NOT_A_STRING);
		await assert.rejects(internalMail.queueMail({ to: 7, template: "notice", language: "en" }), NOT_A_STRING);
		await assert.rejects(internalMail.queueMail({ to: [BOB, null], template: "notice" }), NOT_A_STRING);
		assert.equal((await stored()).length, 0);
	});

	it("does not queue a missing template, a refused recipient or a failed queue write, and never throws", async () => {
		await serveWith("rcpt-550");
		assert.deepEqual(await internalMail.queueMail({ to: BOB, template: "nope", language: "en" }), {
			queued: false,
			reason: "template",
		});
		assert.deepEqual(await internalMail.queueMail({ to: BOB, template: "toString", language: "en" }), {
			queued: false,
			reason: "template",
		});
		for (const to of [
			"",
			"not an address",
			`${BOB}, other@example.net`,
			`${BOB}\r\nBcc: evil@example.org`,
			"Bob <bob@example.net>",
			"jöhn@example.net",
			[BOB, "x"],
			[],
		]) {
			assert.deepEqual(
				await internalMail.queueMail({ to, template: "notice", language: "en" }),
				{ queued: false, reason: "recipient" },
				JSON.stringify(to),
			);
		}
		assert.equal((await stored()).length, 0);
		const { queue: appQueue } = await import("../internal/notify.js");
		const add = appQueue.add;
		appQueue.add = () => Promise.reject(Object.assign(new Error("SQLITE_BUSY"), { code: "SQLITE_BUSY" }));
		try {
			assert.deepEqual(await internalMail.queueMail({ to: BOB, template: "notice", language: "en" }), {
				queued: false,
				reason: "queue",
			});
		} finally {
			appQueue.add = add;
		}
		await internalMail.queueMail({ to: BOB, template: "notice", language: "xx" });
		const [one] = await stored();
		assert.equal(JSON.parse(one.payload).language, "de");
	});

	it("writes nothing while mail is not configured and sendNow throws error.mail-not-configured", async () => {
		internalMail.useSettings(() =>
			Promise.resolve({
				email: { ...EMAIL_DEFAULTS },
				notifications: { public_url: "", default_language: "en" },
			}),
		);
		assert.equal(await internalMail.configured(), false);
		assert.deepEqual(await internalMail.queueMail({ to: BOB, template: "notice", language: "en" }), {
			queued: false,
			reason: "not-configured",
		});
		assert.equal((await stored()).length, 0);
		await assert.rejects(internalMail.sendNow({ to: BOB, template: "test", language: "en" }), (error) => {
			assert.equal(error.message_i18n, "error.mail-not-configured");
			return true;
		});
	});

	it("sends a direct mail at once, outside the queue, and returns the scrubbed error of a refusal", async () => {
		const fake = await serveWith("accept");
		assert.equal(await internalMail.configured(), true);
		assert.deepEqual(await internalMail.sendNow({ to: BOB, template: "test", language: "en" }), { ok: true });
		assert.equal(fake.messages.length, 1);
		assert.deepEqual(logoFacts(fake.messages[0]), LOGO_ONCE);
		assert.equal((await stored()).length, 0);

		await serveWith("rcpt-550");
		await assert.rejects(internalMail.sendNow({ to: BOB, template: "test", language: "en" }), (error) => {
			assert.ok(error instanceof MailError);
			assert.equal(error.retry, false);
			assert.match(error.message, NO_SUCH_USER);
			assert.ok(!error.message.includes(PASSWORD));
			return true;
		});
		assert.equal((await stored()).length, 0);
	});

	it("refuses a bad recipient of a direct mail before anything is sent", async () => {
		const fake = await serveWith("accept");
		for (const to of [
			`${BOB}, other@example.net`,
			`${BOB}\r\nBcc: evil@example.org`,
			"Bob <bob@example.net>",
			"",
			7,
		]) {
			await assert.rejects(internalMail.sendNow({ to, template: "test", language: "en" }), (error) => {
				assert.equal(error.name, "ValidationError");
				assert.equal(error.message_i18n, "error.mail-bad-recipient");
				return true;
			});
		}
		assert.equal(fake.messages.length, 0);
	});

	it("takes the language of the user, else the default language", async () => {
		await serveWith("accept");
		assert.equal(await internalMail.languageOf({ npmpro_language: "fr" }), "fr");
		assert.equal(await internalMail.languageOf({ npmpro_language: null }), "de");
		assert.equal(await internalMail.languageOf(undefined), "de");
	});
});
