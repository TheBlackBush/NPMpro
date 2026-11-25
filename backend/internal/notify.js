import db from "../db.js";
import { engineOf } from "../lib/database/engine.js";
import { createNotifyService } from "../lib/notify/service.js";
import { global as logger } from "../logger.js";

// The notification layer of the running app, over the real database. Before initNotify() no worker runs, but
// emit() still queues (a pending row waits for the worker).

const service = createNotifyService({ knex: db(), log: logger });
const {
	notify,
	sweep,
	stateStore,
	worker,
	registerSweepCheck,
	initNotify: startNotify,
	pauseNotify,
	resumeNotify,
	cleanupAfterRestore,
} = service;

// the layer starts, then a database move since the last start is told
const initNotify = async () => {
	await startNotify();
	await checkDatabaseMoved();
};

const STATE_KEY = "database.moved:audit";
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
		await notify.emit(type, {
			...meta,
			type: HOST_TYPES[entry.object_type],
			id: entry.object_id,
			user: { id: entry.user_id, name },
		});
	} catch (error) {
		logger.warn(`notify: the audit event failed: ${safeText(error)}`);
	}
};

/**
 * The database move writes its "moved" audit row straight into the target database, so no hook sees it: at start the
 * newest row is compared with the last seen id (state row database.moved:audit). A newer row sends database.moved; with
 * no state row the id is only stored (a fresh install, or the first start with notifications).
 *
 * @returns {Promise<void>}
 */
const checkDatabaseMoved = async () => {
	try {
		const knex = db();
		const row = await knex("audit_log")
			.select("id", "meta")
			.where({ object_type: "database", action: "moved" })
			.orderBy("id", "desc")
			.first();
		if (!row) return;
		const table = () => knex("npmpro_notification_state");
		const stored = await table().select("data").where({ key: STATE_KEY }).first();
		const seen = stored ? Number(JSON.parse(stored.data ?? "{}").id ?? 0) : null;
		if (seen !== null && row.id <= seen) return;
		// the row is an ok state row: the hourly prune drops old ones, so it is written again with the id of the move
		const date = new Date();
		const since = engineOf(knex) === "sqlite" ? date.toISOString().replace("T", " ").slice(0, -1) : date;
		const data = JSON.stringify({ id: row.id });
		if (stored) await table().where({ key: STATE_KEY }).update({ state: "ok", since, data });
		else {
			await table().insert({
				key: STATE_KEY,
				event: "database.moved",
				object_id: "audit",
				state: "ok",
				since,
				data,
			});
		}
		if (seen === null) return;
		const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : (row.meta ?? {});
		await notify.emit("database.moved", { from: meta.from, to: meta.to ?? meta.name });
	} catch (error) {
		logger.warn(`notify: the database move check failed: ${safeText(error)}`);
	}
};

export {
	checkDatabaseMoved,
	cleanupAfterRestore,
	fromAudit,
	initNotify,
	notify,
	pauseNotify,
	registerSweepCheck,
	resumeNotify,
	stateStore,
	sweep,
	worker,
};
