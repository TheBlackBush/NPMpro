import { waitWithin } from "../database/pause.js";
import { safeError } from "./queue.js";

// The hourly sweep: the registered checks (the certificate expiry check), the reminders that are due, then the
// pruning of old rows. A failing step is logged (safe text) and never stops the next one, and a pass never throws.

const FIRST_MS = 2 * 60_000;
const HOUR_MS = 3_600_000;
const MAIL_DAYS = 30;
const PAYLOAD_DAYS = 7;
const WEBHOOK_KEEP = 100;
const WEBHOOK_DAYS = 30;

/**
 * @param   {Object}    options
 * @param   {Object}    options.stateStore   dueReminders(), prune()
 * @param   {Object}    options.queue        pruneMail(days), clearOldPayloads(days)
 * @param   {Object}    options.notify       deliver(type, data, object)
 * @param   {Function[]|Function}  [options.checks]  async functions, or a function that returns them
 * @param   {Object}    [options.clock]      { setTimeout, clearTimeout } (tests)
 * @param   {Object}    [options.log]
 * @param   {Number}    [options.everyMs]
 */
const createSweep = ({ stateStore, queue, notify, checks = [], clock = globalThis, log, everyMs = HOUR_MS }) => {
	const checkList = typeof checks === "function" ? checks : () => checks;
	let timer = null;
	let started = false;
	let current = null;
	let pauses = 0;

	const step = async (what, work) => {
		try {
			return await work();
		} catch (error) {
			log?.warn?.(`notify: sweep ${what} failed: ${safeError(error?.message ?? String(error))}`);
		}
	};

	const pass = async () => {
		for (const [at, check] of checkList().entries()) await step(`check ${at + 1}`, () => check());
		const reminders = (await step("reminders", () => stateStore.dueReminders())) ?? [];
		for (const reminder of reminders) {
			await step(`reminder ${reminder.type}`, () =>
				notify.deliver(reminder.type, reminder.data, reminder.data?.id ?? "-"),
			);
		}
		await step("prune", () => stateStore.prune());
		await step("prune mail", () => queue.pruneMail(MAIL_DAYS));
		await step("prune webhooks", () => queue.pruneWebhooks(WEBHOOK_KEEP, WEBHOOK_DAYS));
		await step("prune payloads", () => queue.clearOldPayloads(PAYLOAD_DAYS));
	};

	const arm = (ms) => {
		timer = clock.setTimeout(async () => {
			timer = null;
			await sweep.runOnce();
			if (started) arm(everyMs);
		}, ms);
		timer.unref?.();
	};

	const sweep = {
		/** Starts the sweep once: the first pass after 2 minutes, then every everyMs; false when it already runs */
		start: () => {
			if (started) return false;
			started = true;
			arm(FIRST_MS);
			return true;
		},

		/** Stops the timer (the app is closing; tests) */
		stop: () => {
			started = false;
			if (timer !== null) clock.clearTimeout(timer);
			timer = null;
		},

		/** One pass now; nothing while paused; the pass that is going on, when there is one */
		runOnce: () => {
			if (pauses > 0) return Promise.resolve();
			current ??= pass()
				.catch(() => {})
				.finally(() => {
					current = null;
				});
			return current;
		},

		/** Skips the passes and waits for the one that is going on; with timeoutMs it rejects with "writer-running" */
		pause: async ({ timeoutMs } = {}) => {
			pauses += 1;
			try {
				await waitWithin(current ?? Promise.resolve(), { name: "Notification sweep", timeoutMs, clock });
			} catch (error) {
				if (pauses > 0) pauses -= 1;
				throw error;
			}
		},

		resume: () => {
			if (pauses > 0) pauses -= 1;
		},
	};
	return sweep;
};

export { createSweep };
