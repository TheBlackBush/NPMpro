import assert from "node:assert/strict";
import dns from "node:dns";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it, mock as testMock } from "node:test";
import { Webhook as StandardWebhook } from "standardwebhooks";
import { MockAgent, fetch as undiciFetch } from "undici";
import { startApi } from "./support/api.js";

const TABLE = "npmpro_notification_delivery";
const HOOKS = "npmpro_webhook";
const START = Date.parse("2026-11-28T10:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TOKEN = "tok3n-in-the-query";
const BASE = "https://hooks.example.com";
const PATH = "/in/hook";
const URL_WITH_TOKEN = `${BASE}${PATH}?token=${TOKEN}`;
const BLOCKED = /may not reach/u;
const TIMED_OUT = /timed out after 15 seconds/u;
const TOO_LARGE = /larger than 20 KB/u;
const NOT_OPENED = /cannot be opened/u;
const REDIRECT = /redirect \(not followed\)/u;
const GONE = /410/u;
const BAD_ECHO = /^bad \*\*\* \*\*\*$/u;
const LOOKUP_CODE = /EAI_AGAIN/u;

const api = await startApi();
const knex = api.db;
const { isoToLocal } = await import("../lib/backup/rows.js");
const { msOfDbTime } = await import("../lib/notify/db-time.js");
const { createNotify } = await import("../lib/notify/index.js");
const { createQueue } = await import("../lib/notify/queue.js");
const { createWorker } = await import("../lib/notify/worker.js");
const { createWebhookChannel, createWebhookStore, RETRY_DELAYS, retryAfterOf } = await import(
	"../lib/notify/webhook-channel.js"
);
const { newSecret } = await import("../lib/notify/webhook-sign.js");
const { createSecretBox } = await import("../lib/secret-box.js");

const clock = { at: START, now: () => clock.at, timers: [] };
clock.setTimeout = (fn, ms) => {
	const timer = { fn, ms, cleared: false };
	clock.timers.push(timer);
	return timer;
};
clock.clearTimeout = (timer) => {
	timer.cleared = true;
};
const sql = (ms) => isoToLocal(new Date(ms).toISOString());
const seal = (text) => `sealed:${text}`;
const open = (sealed) => {
	if (!String(sealed).startsWith("sealed:")) throw new Error(`cannot open ${sealed}`);
	return sealed.slice(7);
};
// the library checks the timestamp against the real clock: verify at the time of the attempt
const verify = (secret, call) => {
	testMock.timers.enable({ apis: ["Date"], now: Number(call.init.headers["webhook-timestamp"]) * 1000 });
	try {
		return new StandardWebhook(secret).verify(call.init.body, call.init.headers);
	} finally {
		testMock.timers.reset();
	}
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

let mock;
let route;
let seen;
let agents;
let lines;
let queue;
let worker;
let notify;
let channel;
let store;
let overrides;
const SECRET = newSecret();
const OLD_SECRET = newSecret();

const log = { warn: (line) => lines.push(`warn ${line}`), info: (line) => lines.push(`info ${line}`), debug: () => {} };

const replyOf = () => ({
	statusCode: route.status,
	data: route.body ?? "",
	responseOptions: { headers: route.headers ?? {} },
});

const makeFetch = () => (url, init) => {
	seen.push({ url, init });
	return undiciFetch(url, { ...init, dispatcher: mock });
};

const build = (extra = {}) => {
	store = createWebhookStore({ knex, queue, clock });
	channel = createWebhookChannel({
		webhooks: store,
		open,
		notify,
		fetchFn: overrides.fetchFn ?? makeFetch(),
		createAgent:
			overrides.createAgent ??
			((options) => {
				agents.push(options);
				return { close: async () => {} };
			}),
		clock,
		random: () => 0,
		log,
		version: "9.9.9",
		...extra,
	});
	notify.registerChannel(channel);
};

const addHook = async (extra = {}) => {
	const [id] = await knex(HOOKS).insert({
		created_on: sql(START),
		modified_on: sql(START),
		name: `hook ${Math.random()}`,
		url: seal(URL_WITH_TOKEN),
		url_hint: `${BASE}${PATH}`,
		secret: seal(SECRET),
		events: JSON.stringify(["*"]),
		enabled: true,
		verify_tls: true,
		...extra,
	});
	return id;
};

const hookRow = (id) => knex(HOOKS).where({ id }).first();
const rowsOf = (where = {}) => knex(TABLE).where(where).orderBy("id");
const emitHost = () => notify.deliver("backup.restored", { types: ["proxy_hosts"] });
const pass = async () => {
	await worker.runOnce();
};
const lastSeen = () => seen.at(-1);
const bodyOf = (call) => call.init.body;

before(() => {
	mock = new MockAgent();
	mock.disableNetConnect();
});

beforeEach(async () => {
	clock.at = START;
	clock.timers = [];
	route = { status: 200, body: "ok", headers: {} };
	seen = [];
	agents = [];
	lines = [];
	overrides = {};
	await knex(TABLE).delete();
	await knex(HOOKS).delete();
	mock.get(BASE)
		.intercept({ path: (p) => p.startsWith(PATH), method: "POST" })
		.reply(replyOf)
		.persist();
	queue = createQueue({ knex, clock });
	const timers = {
		setInterval: () => ({ unref() {} }),
		clearInterval() {},
		setTimeout: () => ({ unref() {} }),
		clearTimeout() {},
	};
	notify = createNotify({ stateStore: {}, queue, worker: { kick() {} }, log, clock });
	worker = createWorker({ queue, channels: () => notify.channels(), clock: timers, log });
	build();
	worker.start();
	await worker.runOnce();
});

afterEach(async () => {
	worker.stop();
	await mock.close();
	mock = new MockAgent();
	mock.disableNetConnect();
});

after(() => api.stop());

describe("a delivery", () => {
	it("posts the five headers with a signature that verifies, through a guarded agent that never follows redirects", async () => {
		const id = await addHook({ verify_tls: false });
		await emitHost();
		await pass();
		assert.equal(seen.length, 1);
		const { url, init } = lastSeen();
		assert.equal(url, URL_WITH_TOKEN);
		assert.equal(init.method, "POST");
		assert.equal(init.redirect, "manual");
		assert.deepEqual(agents, [{ rejectUnauthorized: false, privateOnly: false }]);
		const [row] = await rowsOf();
		const headers = init.headers;
		assert.deepEqual(
			Object.keys(headers).sort((a, b) => a.localeCompare(b)),
			["content-type", "user-agent", "webhook-id", "webhook-signature", "webhook-timestamp"],
		);
		assert.equal(headers["content-type"], "application/json");
		assert.equal(headers["user-agent"], "NPMpro-Webhooks/9.9.9");
		assert.equal(headers["webhook-id"], row.message_id);
		assert.equal(headers["webhook-timestamp"], String(START / 1000));
		const payload = verify(SECRET, lastSeen());
		assert.deepEqual(Object.keys(payload), ["type", "timestamp", "data"]);
		assert.equal(payload.type, "backup.restored");
		assert.equal(row.status, "sent");
		assert.equal(row.http_status, 200);
		assert.equal(row.response, "ok");
		assert.equal(row.payload, null);
		const hook = await hookRow(id);
		assert.equal(hook.failing_since, null);
		assert.equal(hook.last_success_on, sql(START));
	});

	it("an http URL may reach private addresses only, and verify_tls is passed on", async () => {
		await addHook({ url: seal("http://192.168.1.5/in/hook") });
		overrides.fetchFn = async () => new Response("fine");
		build();
		await emitHost();
		await pass();
		assert.deepEqual(agents, [{ rejectUnauthorized: true, privateOnly: true }]);
	});

	it("a new agent for every attempt, closed afterwards", async () => {
		await addHook();
		let closed = 0;
		overrides.createAgent = (options) => {
			agents.push(options);
			return {
				close: () => {
					closed += 1;
					return Promise.resolve();
				},
			};
		};
		build();
		route.status = 500;
		await emitHost();
		await pass();
		clock.at += 6000;
		await pass();
		assert.equal(agents.length, 2);
		assert.equal(closed, 2);
	});
});

describe("retries", () => {
	const nextIn = async () => msOfDbTime((await rowsOf())[0].next_try_on) - clock.at;

	it("a 500 is retried after 5 s, then 5 min, with the same id and a new timestamp", async () => {
		await addHook();
		route.status = 500;
		await emitHost();
		await pass();
		let [row] = await rowsOf();
		assert.equal(row.status, "pending");
		assert.equal(row.attempts, 1);
		assert.equal(row.http_status, 500);
		assert.equal(await nextIn(), 5000);
		await pass();
		assert.equal(seen.length, 1, "not due yet");
		clock.at += 5000;
		await pass();
		[row] = await rowsOf();
		assert.equal(row.attempts, 2);
		assert.equal(await nextIn(), 300_000);
		const [first, second] = seen.map((call) => call.init.headers);
		assert.equal(first["webhook-id"], second["webhook-id"]);
		assert.equal(first["webhook-timestamp"], String(START / 1000));
		assert.equal(second["webhook-timestamp"], String((START + 5000) / 1000));
		assert.notEqual(first["webhook-signature"], second["webhook-signature"]);
		verify(SECRET, seen[1]);
	});

	it("adds up to 10% jitter", async () => {
		await addHook();
		build({ random: () => 0.9999 });
		route.status = 500;
		await emitHost();
		await pass();
		const wait = await nextIn();
		assert.ok(wait >= 5000 && wait < 5500, `${wait}`);
	});

	it("gives up after 8 attempts", async () => {
		await addHook();
		route.status = 503;
		await emitHost();
		for (let attempt = 0; attempt < 8; attempt++) {
			clock.at += (attempt === 0 ? 0 : RETRY_DELAYS[attempt - 1]) + 1000;
			await pass();
		}
		const [row] = await rowsOf();
		assert.equal(row.status, "failed");
		assert.equal(row.attempts, 8);
		assert.equal(seen.length, 8);
	});

	it("honours Retry-After in seconds and as a date, at most 24 hours, and ignores the rest", async () => {
		await addHook();
		const cases = [
			["120", 120_000],
			["Sat, 28 Nov 2026 10:10:00 GMT", 600_000],
			["172800", DAY],
			["abc", 5000],
			["-5", 5000],
			["1.5", 5000],
			["foo 5", 5000],
			["1", 5000],
		];
		for (const [value, expected] of cases) {
			await knex(TABLE).delete();
			clock.at = START;
			route = { status: 429, body: "", headers: { "retry-after": value } };
			await emitHost();
			await pass();
			assert.equal(await nextIn(), expected, value);
		}
	});

	it("retryAfterOf reads seconds and IMF dates only", () => {
		assert.equal(retryAfterOf("10", 0), 10_000);
		assert.equal(retryAfterOf(" 10 ", 0), 10_000);
		assert.equal(retryAfterOf(null, 0), 0);
		assert.equal(retryAfterOf("Sat, 28 Nov 2026 09:00:00 GMT", START), 0);
		assert.equal(retryAfterOf("9".repeat(30), 0), DAY);
	});

	it("a redirect is a failed attempt and is not followed", async () => {
		await addHook();
		route = { status: 302, body: "", headers: { location: `${BASE}/elsewhere` } };
		await emitHost();
		await pass();
		assert.equal(seen.length, 1);
		const [row] = await rowsOf();
		assert.equal(row.status, "pending");
		assert.equal(row.http_status, 302);
		assert.match(row.error, REDIRECT);
	});

	it("a timeout after 15 s is a retry", async () => {
		await addHook();
		overrides.fetchFn = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
			});
		build();
		await emitHost();
		const running = pass();
		for (let tries = 0; tries < 50 && clock.timers.length === 0; tries++) await flush();
		assert.equal(clock.timers.length, 1);
		assert.equal(clock.timers[0].ms, 15_000);
		clock.timers[0].fn();
		await running;
		const [row] = await rowsOf();
		assert.equal(row.status, "pending");
		assert.match(row.error, TIMED_OUT);
		assert.equal(clock.timers[0].cleared, true);
	});
});

describe("the response", () => {
	it("is read up to 2 KB and the rest is not read", async () => {
		await addHook();
		let pulled = 0;
		let cancelled = false;
		overrides.fetchFn = async () =>
			new Response(
				new ReadableStream({
					pull(controller) {
						pulled += 1;
						controller.enqueue(new TextEncoder().encode("x".repeat(1000)));
					},
					cancel() {
						cancelled = true;
					},
				}),
				{ status: 200 },
			);
		build();
		await emitHost();
		await pass();
		const [row] = await rowsOf();
		assert.equal(row.response.length, 2048);
		assert.ok(pulled <= 4, `pulled ${pulled}`);
		assert.equal(cancelled, true);
	});
});

describe("410 and failing webhooks", () => {
	it("a 410 disables the webhook at once, drops its pending rows and tells the others once", async () => {
		const gone = await addHook({ name: "gone one" });
		const other = await addHook({ name: "other", events: JSON.stringify(["webhook.disabled"]) });
		route = { status: 410, body: "", headers: {} };
		await emitHost();
		// a later event waits in the queue for the same webhook
		await knex(TABLE).insert({
			created_on: sql(START),
			modified_on: sql(START),
			message_id: "msg_later",
			event: "backup.restored",
			channel: "webhook",
			target_id: gone,
			payload: "{}",
			status: "pending",
			attempts: 0,
		});
		await queue.dropTarget("webhook", other);
		await pass();
		const hook = await hookRow(gone);
		assert.equal(Boolean(hook.enabled), false);
		assert.equal(hook.disabled_reason, "gone");
		const mine = await rowsOf({ target_id: gone });
		assert.deepEqual(
			mine.map((row) => [row.message_id === "msg_later", row.status]),
			[
				[false, "failed"],
				[true, "dropped"],
			],
		);
		assert.match(mine[0].error, GONE);
		assert.equal(mine[0].attempts, 1);
		const told = await rowsOf({ event: "webhook.disabled" });
		assert.deepEqual(
			told.map((row) => row.target_id),
			[other],
		);
		assert.deepEqual(told[0].payload && JSON.parse(told[0].payload).data, {
			webhook: { id: gone, name: "gone one" },
			reason: "gone",
		});
	});

	it("webhook.disabled is never sent to the webhook that was just disabled, even when it selects every event", async () => {
		const gone = await addHook();
		route = { status: 410, body: "", headers: {} };
		await emitHost();
		await pass();
		assert.deepEqual(await rowsOf({ event: "webhook.disabled" }), []);
		assert.equal(Boolean((await hookRow(gone)).enabled), false);
	});

	it("failing for over 3 days disables the webhook (failing); a success in between resets", async () => {
		const id = await addHook();
		route.status = 500;
		await emitHost();
		await pass();
		assert.equal((await hookRow(id)).failing_since, sql(START));
		// the failure goes on for 2 days and 23 hours, then one success
		clock.at = START + 2 * DAY + 23 * HOUR;
		await pass();
		await knex(TABLE).update({ next_try_on: null });
		route.status = 200;
		await pass();
		let hook = await hookRow(id);
		assert.equal(hook.failing_since, null);
		assert.equal(hook.last_success_on, sql(clock.at));
		// a new failure period starts, 3 days and a minute later it ends the webhook
		route.status = 500;
		await emitHost();
		await pass();
		assert.equal((await hookRow(id)).failing_since, sql(clock.at));
		clock.at += 3 * DAY - 1000;
		await knex(TABLE).update({ next_try_on: null });
		await pass();
		assert.equal(Boolean((await hookRow(id)).enabled), true);
		clock.at += 2000;
		await knex(TABLE).update({ next_try_on: null });
		await pass();
		hook = await hookRow(id);
		assert.equal(Boolean(hook.enabled), false);
		assert.equal(hook.disabled_reason, "failing");
		assert.equal((await rowsOf({ status: "pending", channel: "webhook" })).length, 0);
	});

	it("webhook.disabled goes to a webhook that selects it when another one is disabled, once", async () => {
		const first = await addHook({ name: "first" });
		await addHook({ name: "watcher", events: JSON.stringify(["webhook.disabled"]) });
		route = { status: 410, body: "", headers: {} };
		await emitHost();
		await pass();
		route = { status: 200, body: "ok", headers: {} };
		await pass();
		assert.equal(Boolean((await hookRow(first)).enabled), false);
		assert.equal((await rowsOf({ event: "webhook.disabled" }))[0].status, "sent");
		assert.equal((await rowsOf({ event: "webhook.disabled" })).length, 1);
		assert.equal(lines.filter((line) => line.includes("was disabled")).length, 1);
	});
});

describe("the guard", () => {
	const realLookup = dns.lookup;
	const answer = (error, addresses) => {
		dns.lookup = (_host, _options, callback) =>
			error
				? callback(error)
				: callback(
						null,
						addresses.map((address) => ({ address, family: 4 })),
					);
	};
	afterEach(() => {
		dns.lookup = realLookup;
	});

	const realAgent = async () => {
		const { createGuardedAgent } = await import("../lib/outbound-guard.js");
		overrides.fetchFn = undiciFetch;
		overrides.createAgent = createGuardedAgent;
		build();
	};

	it("a name that resolves to 127.0.0.1 at the attempt fails with the guard message and is retried", async () => {
		const id = await addHook({ url: seal("https://rebind.example.com/in/hook?token=value") });
		await realAgent();
		answer(null, ["127.0.0.1"]);
		await emitHost();
		await pass();
		const [row] = await rowsOf();
		assert.equal(row.status, "pending");
		assert.match(row.error, BLOCKED);
		assert.equal(Boolean((await hookRow(id)).enabled), true);
	});

	it("an http URL to a name with a public address is refused", async () => {
		await addHook({ url: seal("http://plain.example.com/in/hook") });
		await realAgent();
		answer(null, ["93.184.216.34"]);
		await emitHost();
		await pass();
		assert.match((await rowsOf())[0].error, BLOCKED);
	});

	it("an address written as an IP is refused at the attempt too", async () => {
		await addHook({ url: seal("https://127.0.0.1/in/hook") });
		await addHook({ url: seal("http://[::ffff:8.8.8.8]/in/hook") });
		await realAgent();
		await emitHost();
		await pass();
		for (const row of await rowsOf()) assert.match(row.error, BLOCKED);
	});

	it("a resolver outage is a retry and does not disable the webhook", async () => {
		const id = await addHook({ url: seal("https://flaky.example.com/in/hook") });
		await realAgent();
		answer(Object.assign(new Error("try again"), { code: "EAI_AGAIN" }), []);
		await emitHost();
		await pass();
		const [row] = await rowsOf();
		assert.equal(row.status, "pending");
		assert.match(row.error, LOOKUP_CODE);
		const hook = await hookRow(id);
		assert.equal(Boolean(hook.enabled), true);
		assert.equal(hook.failing_since, sql(START));
	});
});

describe("secrets and the URL", () => {
	it("the URL, its query and the secrets are never in an error, a log line or a delivery row", async () => {
		await addHook({ previous_secret: seal(OLD_SECRET), previous_secret_until: sql(START + DAY) });
		overrides.fetchFn = (url) => {
			throw new TypeError("fetch failed", {
				cause: Object.assign(new Error(`connect to ${url} with ${SECRET}`), { code: "ECONNRESET" }),
			});
		};
		build();
		await emitHost();
		await pass();
		route.status = 500;
		overrides.fetchFn = undefined;
		build();
		clock.at += 6000;
		await pass();
		const everything = JSON.stringify([await rowsOf(), lines, await knex("audit_log").select()]);
		for (const secret of [TOKEN, SECRET, OLD_SECRET, SECRET.slice(6), "hooks.example.com/in/hook?"]) {
			assert.equal(everything.includes(secret), false, secret);
		}
		const [row] = await rowsOf();
		assert.equal(row.error.includes(TOKEN), false);
	});

	it("an echoed URL or secret in the response is hidden", async () => {
		await addHook();
		route = { status: 400, body: `bad ${URL_WITH_TOKEN} ${SECRET}`, headers: {} };
		await emitHost();
		await pass();
		const [row] = await rowsOf();
		assert.equal(row.response.includes(TOKEN), false);
		assert.equal(row.response.includes(SECRET), false);
		assert.match(row.response, BAD_ECHO);
	});

	it("a rotated webhook signs with both secrets until previous_secret_until", async () => {
		await addHook({ previous_secret: seal(OLD_SECRET), previous_secret_until: sql(START + HOUR) });
		route.status = 500;
		await emitHost();
		await pass();
		const first = lastSeen();
		assert.equal(first.init.headers["webhook-signature"].split(" ").length, 2);
		for (const secret of [SECRET, OLD_SECRET]) verify(secret, first);
		clock.at = START + HOUR + 1000;
		await knex(TABLE).update({ next_try_on: null });
		await pass();
		const later = lastSeen();
		assert.equal(later.init.headers["webhook-signature"].split(" ").length, 1);
		verify(SECRET, later);
		assert.throws(() => verify(OLD_SECRET, later));
	});

	it("opens sealed values with the real secret box", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "npmpro-wh-"));
		try {
			const box = createSecretBox(path.join(dir, "key"));
			await addHook({ url: box.encrypt(URL_WITH_TOKEN), secret: box.encrypt(SECRET) });
			build({ open: (text) => box.decrypt(text) });
			await emitHost();
			await pass();
			assert.equal((await rowsOf())[0].status, "sent");
			verify(SECRET, lastSeen());
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("a value that cannot be opened fails the delivery without a request", async () => {
		const id = await addHook({ url: "garbage" });
		await emitHost();
		await pass();
		const [row] = await rowsOf();
		assert.equal(row.status, "failed");
		assert.match(row.error, NOT_OPENED);
		assert.equal(seen.length, 0);
		assert.equal((await hookRow(id)).failing_since, sql(START));
	});
});

describe("the body", () => {
	it("an envelope that is too large is failed at once and not sent; one under the limit goes", async () => {
		await addHook();
		const big = {
			id: "msg_big",
			type: "backup.restored",
			timestamp: "2026-11-28T10:00:00.000Z",
			data: { x: "y".repeat(21_000) },
		};
		const small = { ...big, id: "msg_small", data: { x: "y".repeat(19_000) } };
		for (const envelope of [big, small]) {
			await queue.add([
				{
					message_id: envelope.id,
					event: envelope.type,
					channel: "webhook",
					target_id: (await knex(HOOKS).first()).id,
					payload: envelope,
				},
			]);
		}
		await pass();
		const rows = await rowsOf();
		assert.deepEqual(
			rows.map((row) => row.status),
			["failed", "sent"],
		);
		assert.match(rows[0].error, TOO_LARGE);
		assert.equal(rows[0].attempts, 1);
		assert.equal(seen.length, 1);
		assert.equal(JSON.parse(bodyOf(lastSeen())).data.x.length, 19_000);
	});

	it("the event layer already keeps an envelope within 20 KB, the body has no id", async () => {
		await addHook();
		await notify.deliver("backup.restored", { types: Array.from({ length: 5000 }, (_, at) => `type-${at}`) });
		await pass();
		const body = bodyOf(lastSeen());
		assert.ok(Buffer.byteLength(body) <= 20 * 1024);
		const parsed = JSON.parse(body);
		assert.equal("id" in parsed, false);
		assert.equal(parsed.data.truncated, true);
	});
});

describe("which webhooks get an event", () => {
	it("an enabled webhook that selects the event; the star covers all but notification.test", async () => {
		const all = await addHook({ name: "all" });
		const some = await addHook({
			name: "some",
			events: JSON.stringify(["backup.restored", "backup.failed.resolved"]),
		});
		const off = await addHook({ name: "off", enabled: false });
		const forType = async (type) =>
			(await channel.targets({ type })).map((target) => target.target_id).sort((a, b) => a - b);
		assert.equal(await channel.accepts("backup.restored"), true);
		assert.deepEqual(await forType("backup.restored"), [all, some]);
		assert.deepEqual(await forType("host.created"), [all]);
		assert.deepEqual(await forType("backup.failed.resolved"), [all, some]);
		assert.deepEqual(await forType("notification.test"), []);
		assert.equal(await channel.accepts("notification.test"), false);
		assert.equal((await channel.targets({ type: "host.created" })).includes(off), false);
		assert.equal(channel.id, "webhook");
		assert.equal(channel.retryDelays.length, 7);
	});

	it("nothing is queued with no enabled webhook", async () => {
		await addHook({ enabled: false });
		await emitHost();
		assert.deepEqual(await rowsOf(), []);
	});

	it("a row of a webhook that was disabled or deleted meanwhile is dropped, not sent", async () => {
		const id = await addHook();
		await emitHost();
		await knex(HOOKS).where({ id }).update({ enabled: false });
		await pass();
		let [row] = await rowsOf();
		assert.equal(row.status, "dropped");
		assert.equal(seen.length, 0);
		await knex(TABLE).delete();
		await knex(HOOKS).where({ id }).update({ enabled: true });
		await emitHost();
		await knex(HOOKS).where({ id }).delete();
		await pass();
		[row] = await rowsOf();
		assert.equal(row.status, "dropped");
	});

	it("disabling drops the pending rows of that webhook only", async () => {
		const one = await addHook({ name: "one" });
		const two = await addHook({ name: "two" });
		await emitHost();
		assert.equal(await store.disable(one, "restore"), true);
		assert.equal(await store.disable(one, "restore"), false);
		const rows = await rowsOf();
		assert.deepEqual(
			rows.map((row) => [row.target_id, row.status]),
			[
				[one, "dropped"],
				[two, "pending"],
			],
		);
	});
});

describe("concurrency", () => {
	it("two rows of one webhook are never in flight at once, two webhooks are", async () => {
		const one = await addHook({ name: "one", url: seal("https://one.example.com/a") });
		await addHook({ name: "two", url: seal("https://two.example.com/a") });
		let inFlight = 0;
		const peaks = {};
		const live = {};
		overrides.fetchFn = async (url) => {
			const host = new URL(url).host;
			live[host] = (live[host] ?? 0) + 1;
			inFlight += 1;
			peaks[host] = Math.max(peaks[host] ?? 0, live[host]);
			peaks.all = Math.max(peaks.all ?? 0, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 20));
			live[host] -= 1;
			inFlight -= 1;
			return new Response("ok");
		};
		build();
		await emitHost();
		await emitHost();
		await pass();
		assert.equal((await rowsOf({ status: "sent" })).length, 4);
		assert.equal(peaks["one.example.com"], 1);
		assert.equal(peaks["two.example.com"], 1);
		assert.equal(peaks.all, 2);
		assert.equal(channel.maxConcurrent > 1, true);
		assert.ok(one);
	});
});

describe("the sweep pruning of webhook rows", () => {
	it("keeps the newest rows of each webhook and drops the old ones", async () => {
		const one = await addHook({ name: "one" });
		const two = await addHook({ name: "two" });
		const fill = (target, count, modified) =>
			knex(TABLE).insert(
				Array.from({ length: count }, (_, at) => ({
					created_on: sql(modified),
					modified_on: sql(modified),
					message_id: `msg_${target}_${at}`,
					event: "backup.restored",
					channel: "webhook",
					target_id: target,
					payload: null,
					status: "sent",
					attempts: 1,
				})),
			);
		await fill(one, 5, START);
		await fill(two, 2, START);
		await fill(two, 1, START - 40 * DAY);
		await queue.pruneWebhooks(3, 30);
		assert.equal((await rowsOf({ target_id: one })).length, 3);
		assert.equal((await rowsOf({ target_id: two })).length, 2);
	});
});
