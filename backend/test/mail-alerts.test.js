import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startApi } from "./support/api.js";
import { migratedSqlite } from "./support/database.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

const TABLE = "npmpro_notification_delivery";
const START = Date.parse("2026-11-26T10:00:00Z");
const MINUTE = 60_000;
const BOSS = "Boss@Example.com";
const LISTED = "listed@example.net";
const FORTY = 40;
const ENV_NAMES = ["NPMPRO_TEST_SMTP"];
const ITEM_LINES = /^- certificate\.renewal_failed/gmu;

const api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
const { createMailChannel } = await import("../lib/mail/channel.js");
const { EMAIL_DEFAULTS } = await import("../lib/mail/settings-rules.js");
const { sendMail } = await import("../lib/mail/transport.js");
const { createNotify } = await import("../lib/notify/index.js");
const { createQueue } = await import("../lib/notify/queue.js");
const { createWorker } = await import("../lib/notify/worker.js");
const { renderMail } = await import("../mail/render.js");

const clock = { at: START, now: () => clock.at };
let db;
let port;
let queue;
let worker;
let notify;
let audits;
let configured;
let notifications;
let admins;
const servers = [];

const certificate = (id) => ({ id, nice_name: `cert ${id}`, error: "no" });
const rowsOf = () => db.knex(TABLE).orderBy("id");
const pass = async () => {
	await worker.runOnce();
};
const listen = async (mode) => {
	const fake = await startFakeSmtp({ mode });
	servers.push(fake);
	port = fake.port;
	return fake;
};
const settings = () => ({
	email: configured
		? { ...EMAIL_DEFAULTS, host: "127.0.0.1", port, security: "none", from_address: "npm@example.com" }
		: { ...EMAIL_DEFAULTS },
	notifications: notifications(),
});

before(async () => {
	db = await migratedSqlite();
});

after(async () => {
	for (const fake of servers) await fake.close();
	await db?.cleanup?.();
	await api.stop();
	for (const name of ENV_NAMES) delete process.env[name];
});

describe("alert mails: recipients, accepts and the grouped send", () => {
	beforeEach(async () => {
		clock.at = START;
		configured = true;
		audits = [];
		admins = [
			{ email: BOSS, roles: ["admin"], is_disabled: 0, npmpro_language: "de" },
			{ email: "off@example.com", roles: ["admin"], is_disabled: 1 },
			{ email: "x@", roles: ["admin"], is_disabled: 0 },
		];
		notifications = () => ({
			default_language: "en",
			public_url: "",
			alerts_admins: true,
			alerts_addresses: [LISTED, BOSS.toLowerCase()],
			alerts_events: ["certificate.renewal_failed", "backup.failed"],
		});
		await db.knex(TABLE).delete();
		queue = createQueue({ knex: db.knex, clock });
		const channel = createMailChannel({
			settings: () => Promise.resolve(settings()),
			admins: () => Promise.resolve(admins),
			send: sendMail,
			render: renderMail,
			audit: (entry) => {
				audits.push(entry);
				return Promise.resolve();
			},
			clock,
		});
		worker = createWorker({ queue, channels: [channel] });
		notify = createNotify({ stateStore: {}, queue, worker, clock });
		notify.registerChannel(channel);
		worker.start();
		await pass();
	});

	after(() => worker?.stop());

	it("queues one row per recipient: group key, a 60 s delay, language and envelope", async () => {
		await notify.deliver("certificate.renewal_failed", certificate(1));
		const rows = await rowsOf();
		assert.equal(rows.length, 2);
		assert.deepEqual(rows.map((row) => row.group_key).sort(), [`alerts:${BOSS.toLowerCase()}`, `alerts:${LISTED}`]);
		const boss = rows.find((row) => row.recipient === BOSS);
		assert.equal(JSON.parse(boss.payload).language, "de");
		assert.equal(JSON.parse(boss.payload).envelope.type, "certificate.renewal_failed");
		assert.ok(rows.every((row) => row.next_try_on !== null && row.channel === "mail"));
	});

	it("sends forty events within the window as one mail per recipient with forty items", async () => {
		const fake = await listen("accept");
		for (let id = 1; id <= FORTY; id++) await notify.deliver("certificate.renewal_failed", certificate(id));
		await pass();
		assert.equal(fake.messages.length, 0);
		clock.at += MINUTE;
		await pass();
		assert.equal(fake.messages.length, 2);
		for (const raw of fake.messages) assert.equal(raw.match(ITEM_LINES).length, FORTY);
		assert.equal(fake.messages.filter((raw) => raw.includes(LISTED)).length, 1);
		assert.equal((await rowsOf()).filter((row) => row.status === "sent").length, FORTY * 2);
	});

	it("starts a new group for an event after the group was sent", async () => {
		const fake = await listen("accept");
		await notify.deliver("certificate.renewal_failed", certificate(1));
		clock.at += MINUTE;
		await pass();
		assert.equal(fake.messages.length, 2);
		await notify.deliver("certificate.renewal_failed", certificate(2));
		await pass();
		assert.equal(fake.messages.length, 2);
		clock.at += MINUTE;
		await pass();
		assert.equal(fake.messages.length, 4);
	});

	it("queues nothing for an event that is not ticked, and nothing while mail is not configured", async () => {
		await notify.deliver("geoip.failed", { error: "x" });
		assert.equal((await rowsOf()).length, 0);
		configured = false;
		await notify.deliver("certificate.renewal_failed", certificate(1));
		assert.equal((await rowsOf()).length, 0);
	});

	it("queues no row when nobody is a recipient", async () => {
		notifications = () => ({
			default_language: "en",
			alerts_admins: false,
			alerts_addresses: [],
			alerts_events: ["backup.failed"],
		});
		await notify.deliver("backup.failed", { error: "x" });
		assert.equal((await rowsOf()).length, 0);
	});

	it("queues the recovery of a ticked event, and a reminder of it", async () => {
		await notify.deliver("certificate.renewal_failed.resolved", certificate(1));
		await notify.deliver("certificate.renewal_failed", { ...certificate(1), reminder: true });
		const rows = await rowsOf();
		assert.equal(rows.length, 4);
		const envelopes = rows.filter((row) => row.recipient === LISTED).map((row) => JSON.parse(row.payload).envelope);
		assert.equal(envelopes[0].type, "certificate.renewal_failed.resolved");
		assert.equal(envelopes[1].data.reminder, true);
	});

	it("does not queue the recovery of an event that is not ticked", async () => {
		await notify.deliver("geoip.failed.resolved", {});
		assert.equal((await rowsOf()).length, 0);
	});

	it("keeps a newly ticked event without a backlog: ticking queues nothing", async () => {
		notifications = () => ({
			default_language: "en",
			alerts_admins: true,
			alerts_addresses: [],
			alerts_events: ["geoip.failed"],
		});
		assert.equal((await rowsOf()).length, 0);
		await notify.deliver("geoip.failed", { error: "later" });
		assert.equal((await rowsOf()).length, 1);
	});

	it("retries a group that fails with 450 as one, with no audit row", async () => {
		const busy = await listen("rcpt-450");
		for (let id = 1; id <= 3; id++) await notify.deliver("certificate.renewal_failed", certificate(id));
		clock.at += MINUTE;
		await pass();
		const rows = await rowsOf();
		assert.equal(busy.messages.length, 0);
		assert.ok(rows.every((row) => row.status === "pending" && row.attempts === 1));
		assert.equal(audits.length, 0);
		const fine = await listen("accept");
		clock.at += MINUTE;
		await pass();
		assert.equal(fine.messages.length, 2);
		assert.ok((await rowsOf()).every((row) => row.status === "sent"));
	});

	it("fails a refused group at once with one audit row per mail", async () => {
		await listen("rcpt-550");
		for (let id = 1; id <= 3; id++) await notify.deliver("certificate.renewal_failed", certificate(id));
		clock.at += MINUTE;
		await pass();
		assert.ok((await rowsOf()).every((row) => row.status === "failed"));
		assert.equal(audits.length, 2);
		assert.equal(audits[0].meta.kind, "alerts");
	});
});
