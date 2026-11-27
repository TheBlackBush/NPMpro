import db from "../db.js";
import { createMailChannel } from "../lib/mail/channel.js";
import { sendMail } from "../lib/mail/transport.js";
import { dbTimeOf, msOfDbTime } from "../lib/notify/db-time.js";
import { createNotifyService } from "../lib/notify/service.js";
import { MOVED_WATERMARK_KEY } from "../lib/notify/state-store.js";
import { createWebhookChannel, createWebhookStore } from "../lib/notify/webhook-channel.js";
import { createGuardedAgent } from "../lib/outbound-guard.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { global as logger } from "../logger.js";
import { renderMail } from "../mail/render.js";
import pjson from "../package.json" with { type: "json" };
import internalPasswordToken from "./password-token.js";

// The notification layer of the running app, over the real database. Before initNotify() the worker runs no pass and
// arms no timer, but emit() still queues: initNotify() resets the rows a stopped process left sending, then the worker's
// start sends what is pending.

// the reminder interval is a setting (Settings, Notifications), read at every sweep; mail.js is loaded when it is first needed
const reminderHours = async () => (await (await import("./mail.js")).default.settings()).notifications.reminder_hours;

const service = createNotifyService({ knex: db(), log: logger, reminderHours });
const {
	notify,
	queue,
	sweep,
	stateStore,
	worker,
	registerSweepCheck,
	initNotify: startNotify,
	pauseNotify,
	resumeNotify,
	cleanupAfterRestore,
	clearReplacedStates,
} = service;

const parseRoles = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return [];
	}
};

// The mail channel. mail.js and audit-log.js import this module, so they are loaded when a mail goes out, not now.
notify.registerChannel(
	createMailChannel({
		admins: async () =>
			(await db()("user").select("email", "roles", "is_disabled", "npmpro_language")).map((user) => ({
				...user,
				roles: typeof user.roles === "string" ? parseRoles(user.roles) : user.roles,
			})),
		settings: async () => (await import("./mail.js")).default.settings(),
		send: sendMail,
		render: renderMail,
		audit: async (entry) => (await import("./audit-log.js")).default.add(null, entry),
		log: logger,
	}),
);

// The webhook channel: signed deliveries to the admin's URLs (stored sealed, opened for each attempt)
// the guarded agent is the only one production uses; test code may swap the factory (setWebhookAgentFactory)
let agentFactory = createGuardedAgent;
const webhookChannel = createWebhookChannel({
	webhooks: createWebhookStore({ knex: db(), queue }),
	open: (sealed) => defaultSecretBox.decrypt(sealed),
	notify,
	audit: async (entry) => (await import("./audit-log.js")).default.add(null, entry),
	createAgent: (options) => agentFactory(options),
	log: logger,
	version: pjson.version,
});
notify.registerChannel(webhookChannel);

// the hourly sweep also removes the used and expired password tokens
registerSweepCheck(() => internalPasswordToken.sweep());

// the layer starts, then a database move since the last start is told
const initNotify = async () => {
	await startNotify();
	await checkDatabaseMoved();
};

const HOST_TYPES = {
	"proxy-host": "proxy_host",
	"redirection-host": "redirection_host",
	"dead-host": "dead_host",
	stream: "stream",
};
const HOST_ACTIONS = new Set(["created", "updated", "deleted", "enabled", "disabled"]);

const safeText = (error) => String(error?.message ?? error).slice(0, 200);

// the event of an audit row, or nothing for a row that has none
const eventOf = (entry) => {
	const { object_type: kind, action } = entry;
	if (HOST_TYPES[kind] && HOST_ACTIONS.has(action)) return `host.${action}`;
	if (kind === "certificate" && action === "created") return "certificate.issued";
	if (kind === "certificate" && action === "deleted") return "certificate.deleted";
	if (kind === "backup" && action === "restored") return "backup.restored";
	if (kind === "database" && action === "move-failed") return "database.move_failed";
};

const userNameOf = async (userId) => {
	if (!userId) return;
	const row = await db()("user").select("name").where({ id: userId }).first();
	return row?.name;
};

/**
 * Sends the action event of an audit row (host, certificate, backup restore and database move failure); other rows send
 * nothing. Never throws and never rejects: a failure is logged, the audited action keeps its result. The builder keeps
 * only its whitelisted fields, so the meta of the row (changed fields, secrets) never reaches an event.
 *
 * @param   {Object}  entry  the inserted audit row
 * @returns {Promise<void>}
 */
const fromAudit = async (entry) => {
	try {
		const type = eventOf(entry);
		if (!type) return;
		const meta = entry.meta && typeof entry.meta === "object" ? entry.meta : {};
		let name;
		try {
			name = await userNameOf(entry.user_id);
		} catch {
			// the event goes without a user name
		}
		const hostType = HOST_TYPES[entry.object_type];
		await notify.emit(type, {
			...meta,
			...(hostType ? { type: hostType } : {}),
			// a move's audit meta names the target as name, as the moved check reads it
			...(entry.object_type === "database" ? { to: meta.to ?? meta.name } : {}),
			id: entry.object_id,
			user: { id: entry.user_id, name },
		});
	} catch (error) {
		logger.warn(`notify: the audit event failed: ${safeText(error)}`);
	}
};

// the audit row's created_on (naive local text on SQLite, a Date elsewhere) as epoch ms; 0 when it is not a time
const msOf = (value) => {
	const ms = msOfDbTime(value);
	return Number.isNaN(ms) ? 0 : ms;
};

/**
 * The database move writes its "moved" audit row straight into the target database, so no hook sees it: at start the
 * newest row is compared with the watermark (the state row database.moved:audit, which holds the id and the creation
 * time of the newest moved row seen, or id 0 when there was none). A row created later than the watermark sends
 * database.moved, whatever its id (a restore can lower ids). The first start with notifications stores the watermark
 * silently, with no moved row too, so the first move ever is told at the start after it.
 *
 * @returns {Promise<void>}
 */
const checkDatabaseMoved = async () => {
	try {
		const knex = db();
		const row = await knex("audit_log")
			.select("id", "meta", "created_on")
			.where({ object_type: "database", action: "moved" })
			.orderBy("created_on", "desc")
			.orderBy("id", "desc")
			.first();
		const table = () => knex("npmpro_notification_state");
		const stored = await table().select("data").where({ key: MOVED_WATERMARK_KEY }).first();
		const seen = stored ? JSON.parse(stored.data ?? "{}") : null;
		const at = row ? msOf(row.created_on) : 0;
		const isNew =
			Boolean(row) &&
			seen !== null &&
			(at > (seen.at ?? 0) || (at === (seen.at ?? 0) && row.id > (seen.id ?? 0)));
		if (seen !== null && !isNew) return;
		const since = dbTimeOf(knex)(Date.now());
		const data = JSON.stringify({ id: row?.id ?? 0, at });
		if (stored) await table().where({ key: MOVED_WATERMARK_KEY }).update({ state: "ok", since, data });
		else {
			await table().insert({
				key: MOVED_WATERMARK_KEY,
				event: "database.moved",
				object_id: "audit",
				state: "ok",
				since,
				data,
			});
		}
		if (!isNew) return;
		const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : (row.meta ?? {});
		await notify.emit("database.moved", { from: meta.from, to: meta.to ?? meta.name });
	} catch (error) {
		logger.warn(`notify: the database move check failed: ${safeText(error)}`);
	}
};

/**
 * Tests only: replaces how an attempt gets its agent (undefined: the global dispatcher, a MockAgent). Nothing in the app
 * calls it, and no environment value does.
 *
 * @param {Function} factory  (options) => an agent, or undefined
 */
const setWebhookAgentFactory = (factory) => {
	agentFactory = factory;
};

export {
	checkDatabaseMoved,
	cleanupAfterRestore,
	clearReplacedStates,
	fromAudit,
	initNotify,
	notify,
	pauseNotify,
	queue,
	registerSweepCheck,
	resumeNotify,
	setWebhookAgentFactory,
	stateStore,
	sweep,
	webhookChannel,
	worker,
};
