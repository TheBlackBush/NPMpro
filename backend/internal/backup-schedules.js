import { clientOf } from "../lib/backup/restore-db.js";
import { normalizeSchedule, parseRow, scheduleView, TABLE, toDbDate } from "../lib/backup/schedule-rows.js";
import { localZone, nextRun } from "../lib/backup/schedule-time.js";
import { CATEGORIES } from "../lib/backup/types.js";
import errs from "../lib/error.js";

// Backup schedules: saved rows, runs through the backup service's lock and write path, status, retention, audit
// (spec 2026-10-28-backup-schedules-design). Everything is injected; internal/backup-service.js wires the instance.

const SKIPPED = "Skipped: another backup or restore was running";
const MAX_ERROR = 1000;
const ALL_TYPES = CATEGORIES.flatMap((category) => category.types);

const createScheduleService = ({ knex, box, backup, store, audit, clock = Date, log = console, zone = localZone }) => {
	const client = clientOf(knex);
	const now = () => new Date(clock.now());
	const db = (date) => toDbDate(date, client);

	const readRow = async (id) => {
		const row = await knex(TABLE).where({ id }).first();
		return row ? parseRow(row) : null;
	};

	const mustRead = async (id) => {
		const row = await readRow(id);
		if (!row) throw new errs.ItemNotFoundError(id);
		return row;
	};

	const view = async (row) => scheduleView(row, (await store.scheduleFiles(row.id)).length);

	const checkName = async (name, id = null) => {
		const rows = await knex(TABLE).select("id", "name");
		if (rows.some((row) => Number(row.id) !== id && row.name.toLowerCase() === name.toLowerCase())) {
			throw new errs.ValidationError("A schedule with this name exists", "backup.schedule.error.name-taken");
		}
	};

	const writeAudit = (access, action, row, { meta = {}, userId } = {}) =>
		audit(access, {
			action,
			object_type: "backup-schedule",
			object_id: row.id,
			meta: { name: row.name, ...meta },
			...(userId === undefined ? {} : { user_id: userId }),
		}).catch((error) =>
			log.error(`Could not write the audit log entry of the schedule ${row.name}: ${error.message}`),
		);

	const sealed = (passphrase, current) => {
		if (passphrase === undefined) return current?.passphrase ?? null;
		return passphrase === null ? null : box.encrypt({ passphrase });
	};

	const nextAfter = (row, after) => (row.enabled ? nextRun(row, after, zone) : null);

	const stored = (fields) => ({ ...fields, types: JSON.stringify(fields.types) });

	// the status after a run; the row is read again, so an edit made during the run stays
	const finish = async (row, { started, result, error, manual, access, userId }) => {
		const duration = clock.now() - started.getTime();
		const automatic = !manual;
		if (result) log.info(`Scheduled backup "${row.name}": succeeded, ${result.size} bytes, ${duration} ms`);
		else log.warn(`Scheduled backup "${row.name}": failed, ${error.message}, ${duration} ms`);
		const current = await readRow(row.id);
		let removed = [];
		if (current) {
			if (result) removed = await store.pruneSchedule(current.id, current.keep);
			const previous = current.next_run_at?.getTime() ?? 0;
			const keepPlanned = manual && previous > clock.now();
			const next = keepPlanned
				? current.next_run_at
				: nextAfter({ ...current, last_run_at: started }, new Date(Math.max(clock.now(), previous)));
			await knex(TABLE)
				.where({ id: current.id })
				.update({
					last_run_at: db(started),
					last_status: result ? "success" : "failed",
					last_error: result ? null : String(error.message).slice(0, MAX_ERROR),
					last_file: result ? result.name : current.last_file,
					last_size: result ? result.size : current.last_size,
					last_duration_ms: duration,
					next_run_at: db(next),
				});
		} else log.info(`The schedule "${row.name}" was deleted during its run`);
		const meta = result
			? { file: result.name, size: result.size, removed, automatic }
			: { error: String(error.message).slice(0, MAX_ERROR), automatic };
		await writeAudit(access, result ? "backup-succeeded" : "backup-failed", row, { meta, userId });
	};

	const execute = async (row, { manual, access, userId }) => {
		const started = now();
		let result = null;
		let error = null;
		try {
			const passphrase = row.protection === "passphrase" ? box.decrypt(row.passphrase).passphrase : undefined;
			result = await backup.scheduledBackup({
				scheduleId: row.id,
				types: row.types,
				protection: row.protection,
				passphrase,
				userId,
			});
		} catch (caught) {
			// busy: the scheduler waits, Run now answers 409; neither changes the status
			if (caught?.code === "busy") throw caught;
			error = caught;
		}
		await finish(row, { started, result, error, manual, access, userId });
	};

	const ownerAccess = (row) => ({ token: { getUserId: () => row.owner_user_id } });

	return {
		list: async (access) => {
			access.canAdmin();
			const rows = await knex(TABLE).orderBy("id", "desc");
			return Promise.all(rows.map((row) => view(parseRow(row))));
		},

		get: async (access, id) => {
			access.canAdmin();
			return view(await mustRead(id));
		},

		create: async (access, body) => {
			access.canAdmin();
			const { fields, passphrase } = normalizeSchedule(body, null, ALL_TYPES);
			await checkName(fields.name);
			const at = now();
			const insert = knex(TABLE).insert({
				...stored(fields),
				created_on: db(at),
				modified_on: db(at),
				owner_user_id: access.token.getUserId(0),
				passphrase: sealed(passphrase, null),
				next_run_at: db(nextAfter({ ...fields, last_run_at: null }, at)),
			});
			const [inserted] = await (client === "pg" ? insert.returning("id") : insert);
			const row = await mustRead(typeof inserted === "object" ? inserted.id : inserted);
			await writeAudit(access, "created", row);
			return view(row);
		},

		update: async (access, id, body) => {
			access.canAdmin();
			const current = await mustRead(id);
			const { fields, passphrase } = normalizeSchedule(body, current, ALL_TYPES);
			await checkName(fields.name, current.id);
			const at = now();
			await knex(TABLE)
				.where({ id: current.id })
				.update({
					...stored(fields),
					modified_on: db(at),
					passphrase: sealed(passphrase, current),
					next_run_at: db(nextAfter({ ...fields, last_run_at: current.last_run_at }, at)),
				});
			const row = await mustRead(current.id);
			const toggled = Object.keys(body).length === 1 && Object.hasOwn(body, "enabled");
			let action = "updated";
			if (toggled) action = row.enabled ? "enabled" : "disabled";
			await writeAudit(access, action, row);
			return view(row);
		},

		remove: async (access, id, { files = false } = {}) => {
			access.canAdmin();
			const row = await mustRead(id);
			await knex(TABLE).where({ id: row.id }).del();
			const removedFiles = files ? await store.pruneSchedule(row.id, 0) : [];
			await writeAudit(access, "deleted", row, { meta: { files_deleted: removedFiles.length } });
			return { removedFiles };
		},

		runNow: async (access, id) => {
			access.canAdmin();
			const row = await mustRead(id);
			const userId = access.token.getUserId(0);
			await execute(row, { manual: true, access, userId });
			return view((await readRow(row.id)) ?? row);
		},

		dueSchedules: async (nowMs) =>
			(await knex(TABLE).where({ enabled: true }).whereNotNull("next_run_at"))
				.map(parseRow)
				.filter((row) => row.next_run_at.getTime() <= nowMs)
				.sort((a, b) => a.next_run_at - b.next_run_at || a.id - b.id),

		runAutomatic: (row) => execute(row, { manual: false, access: ownerAccess(row), userId: row.owner_user_id }),

		giveUp: (row) =>
			finish(row, {
				started: now(),
				result: null,
				error: new Error(SKIPPED),
				manual: false,
				access: ownerAccess(row),
				userId: row.owner_user_id,
			}),

		failedSchedules: async () =>
			(await knex(TABLE).where({ enabled: true, last_status: "failed" }).orderBy("id").select("id", "name")).map(
				(row) => ({ id: Number(row.id), name: row.name }),
			),
	};
};

export { createScheduleService, SKIPPED };
