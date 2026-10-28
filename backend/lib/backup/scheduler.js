const MINUTE = 60_000;

/**
 * The backup schedule timer (spec "Scheduler"): a tick every minute, the first 5 minutes after start (catch-up of
 * overdue schedules, once each); due schedules run one after another; one held back by the busy lock is retried on
 * each tick and given up after maxWaitMs. A tick that is still running makes the next one skip.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.dueSchedules   (nowMs) => Promise<rows>, in run order
 * @param   {Function}  deps.runAutomatic   (row) => Promise; rejects with code "busy" while the lock is held
 * @param   {Function}  deps.giveUp         (row) => Promise
 * @param   {Object}    [deps.clock]        { now, setTimeout, clearTimeout, setInterval, clearInterval }
 * @param   {Object}    [deps.log]          logger with info() and error()
 * @param   {number}    [deps.startDelayMs] 5 minutes
 * @param   {number}    [deps.tickMs]       60 seconds
 * @param   {number}    [deps.maxWaitMs]    60 minutes
 * @returns {{ start(): boolean, stop(): void, tick(): Promise<void> }}
 */
const createBackupScheduler = ({
	dueSchedules,
	runAutomatic,
	giveUp,
	clock = { now: Date.now, setTimeout, clearTimeout, setInterval, clearInterval },
	log = console,
	startDelayMs = 5 * MINUTE,
	tickMs = MINUTE,
	maxWaitMs = 60 * MINUTE,
}) => {
	let startTimer = null;
	let interval = null;
	let running = false;
	// schedule id -> when it first found the lock held
	const waiting = new Map();

	const runOne = async (row) => {
		try {
			await runAutomatic(row);
			waiting.delete(row.id);
		} catch (error) {
			if (error?.code !== "busy") {
				waiting.delete(row.id);
				log.error(`The scheduled backup "${row.name}" could not run: ${error?.message}`);
				return;
			}
			const since = waiting.get(row.id) ?? clock.now();
			waiting.set(row.id, since);
			if (clock.now() - since < maxWaitMs) {
				log.info(`The scheduled backup "${row.name}" waits for another backup or restore`);
				return;
			}
			waiting.delete(row.id);
			try {
				await giveUp(row);
			} catch (giveUpError) {
				log.error(`The scheduled backup "${row.name}" could not be given up: ${giveUpError?.message}`);
			}
		}
	};

	const tick = async () => {
		if (running) return;
		running = true;
		try {
			const rows = await dueSchedules(clock.now());
			// a schedule that is no longer due (edited, disabled, deleted) loses its wait
			const ids = new Set(rows.map((row) => row.id));
			for (const id of waiting.keys()) if (!ids.has(id)) waiting.delete(id);
			for (const row of rows) await runOne(row);
		} catch (error) {
			log.error(`The backup scheduler failed: ${error?.message}`);
		} finally {
			running = false;
		}
	};

	return {
		tick,
		start: () => {
			if (startTimer !== null || interval !== null) return false;
			startTimer = clock.setTimeout(() => {
				startTimer = null;
				interval = clock.setInterval(tick, tickMs);
				interval?.unref?.();
				return tick();
			}, startDelayMs);
			startTimer?.unref?.();
			return true;
		},
		stop: () => {
			if (startTimer !== null) clock.clearTimeout(startTimer);
			if (interval !== null) clock.clearInterval(interval);
			startTimer = null;
			interval = null;
		},
	};
};

export { createBackupScheduler };
