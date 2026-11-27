import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockAgent, fetch as undiciFetch } from "undici";
import { startApi } from "./support/api.js";
import { startFakeSmtp } from "./support/fake-smtp.js";

const TABLE = "npmpro_notification_delivery";
const HOOKS = "npmpro_webhook";
const START = Date.parse("2026-11-28T10:00:00Z");
const MINUTE = 60_000;
const DAY = 86_400_000;
const BASE = "https://hooks.example.com";
const PATH = "/in/hook";
const BOSS = "boss@example.com";
const LISTED = "listed@example.net";
const GONE_LINE = "Webhook gone one was turned off: the receiver answered 410 Gone";
const FAILING_LINE = "Webhook slow one was turned off: deliveries failed for 3 days";
const unwrap = (raw) => raw.replace(/[=]\r?\n/gu, "");

const api = await startApi({ env: { NPMPRO_TEST_SMTP: "loopback" } });
const knex = api.db;
const { isoToLocal } = await import("../lib/backup/rows.js");
const { createMailChannel } = await import("../lib/mail/channel.js");
const { EMAIL_DEFAULTS, mergeNotifications } = await import("../lib/mail/settings-rules.js");
const { sendMail } = await import("../lib/mail/transport.js");
const { createNotify } = await import("../lib/notify/index.js");
const { createQueue } = await import("../lib/notify/queue.js");
const { createWorker } = await import("../lib/notify/worker.js");
const { createWebhookChannel, createWebhookStore } = await import("../lib/notify/webhook-channel.js");
const { renderMail } = await import("../mail/render.js");
const { newSecret } = await import("../lib/notify/webhook-sign.js");

const clock = { at: START, now: () => clock.at, setTimeout: () => ({}), clearTimeout() {} };
const sql = (ms) => isoToLocal(new Date(ms).toISOString());
const seal = (text) => `sealed:${text}`;
const open = (sealed) => sealed.slice(7);

let mock;
let status;
let fake;
let queue;
let worker;
let events;
const servers = [];

const settings = () => ({
	email: { ...EMAIL_DEFAULTS, host: "127.0.0.1", port: fake.port, security: "none", from_address: "npm@example.com" },
	notifications: {
		default_language: "en",
		public_url: "",
		alerts_admins: true,
		alerts_addresses: [LISTED],
		alerts_events: events,
	},
});

const addHook = async (name) => {
	const [id] = await knex(HOOKS).insert({
		created_on: sql(START),
		modified_on: sql(START),
		name,
		url: seal(`${BASE}${PATH}`),
		url_hint: `${BASE}${PATH}`,
		secret: seal(newSecret()),
		events: JSON.stringify(["backup.restored"]),
		enabled: true,
		verify_tls: true,
	});
	return id;
};

const mailsOf = () => fake.messages.map(unwrap);

before(() => {
	mock = new MockAgent();
	mock.disableNetConnect();
});

beforeEach(async () => {
	clock.at = START;
	status = 410;
	events = mergeNotifications({}, {}).values.alerts_events;
	fake = await startFakeSmtp({ mode: "accept" });
	servers.push(fake);
	await knex(TABLE).delete();
	await knex(HOOKS).delete();
	mock.get(BASE)
		.intercept({ path: PATH, method: "POST" })
		.reply(() => ({ statusCode: status, data: "", responseOptions: { headers: {} } }))
		.persist();
	queue = createQueue({ knex, clock });
	const notify = createNotify({ stateStore: {}, queue, worker: { kick() {} }, clock });
	worker = createWorker({
		queue,
		channels: () => notify.channels(),
		clock: {
			setInterval: () => ({ unref() {} }),
			clearInterval() {},
			setTimeout: () => ({ unref() {} }),
			clearTimeout() {},
		},
	});
	notify.registerChannel(
		createWebhookChannel({
			webhooks: createWebhookStore({ knex, queue, clock }),
			open,
			notify,
			fetchFn: (url, init) => undiciFetch(url, { ...init, dispatcher: mock }),
			createAgent: () => ({ close: async () => {} }),
			clock,
			random: () => 0,
		}),
	);
	notify.registerChannel(
		createMailChannel({
			settings: () => Promise.resolve(settings()),
			admins: () => Promise.resolve([{ email: BOSS, roles: ["admin"], is_disabled: 0, npmpro_language: "de" }]),
			send: sendMail,
			render: renderMail,
			audit: () => Promise.resolve(),
			clock,
		}),
	);
	worker.start();
	await worker.runOnce();
	globalThis.notifyUnderTest = notify;
});

after(async () => {
	worker?.stop();
	for (const one of servers) await one.close();
	await mock.close();
	await api.stop();
});

const restore = () => globalThis.notifyUnderTest.deliver("backup.restored", { types: ["proxy_hosts"] });
const later = async (ms) => {
	clock.at += ms;
	await worker.runOnce();
};

describe("the webhook.disabled mail alert", () => {
	it("is a default alert event", () => {
		assert.ok(mergeNotifications({}, {}).values.alerts_events.includes("webhook.disabled"));
	});

	it("a 410 sends exactly one mail per recipient, with the gone reason in the recipient's language", async () => {
		await addHook("gone one");
		await restore();
		await worker.runOnce();
		await later(MINUTE);
		await later(MINUTE);
		const mails = mailsOf();
		assert.equal(mails.length, 2);
		const listed = mails.find((raw) => raw.includes(LISTED));
		const boss = mails.find((raw) => raw.includes(BOSS));
		assert.ok(listed.includes(GONE_LINE), listed);
		assert.ok(boss.includes("Der Webhook gone one wurde ausgeschaltet: der Empf"), boss);
		assert.ok(!listed.includes("410 Gone Gone"));
	});

	it("3 days of failures send the failing reason", async () => {
		await addHook("slow one");
		status = 500;
		await restore();
		await worker.runOnce();
		assert.equal(mailsOf().length, 0);
		clock.at += 3 * DAY + MINUTE;
		await knex(TABLE).update({ next_try_on: null });
		await worker.runOnce();
		await later(MINUTE);
		await later(MINUTE);
		const mails = mailsOf();
		assert.equal(mails.length, 2);
		assert.ok(mails.every((raw) => raw.includes(FAILING_LINE) || raw.includes("Der Webhook slow one")));
		assert.ok(mails.find((raw) => raw.includes(LISTED)).includes(FAILING_LINE));
	});

	it("sends nothing when the event is not ticked", async () => {
		events = ["backup.failed"];
		await addHook("gone one");
		await restore();
		await worker.runOnce();
		await later(MINUTE);
		await later(MINUTE);
		assert.equal(mailsOf().length, 0);
		assert.equal((await knex(TABLE).where({ channel: "mail" })).length, 0);
	});

	it("keeps a stored list without it, and gives the default list the event", () => {
		const stored = mergeNotifications({ alerts_events: ["backup.failed"] }, {}).values.alerts_events;
		assert.deepEqual(stored, ["backup.failed"]);
	});
});
