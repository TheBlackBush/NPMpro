import { waitWithin } from "./database/pause.js";
import errs from "./error.js";

const FIRST_DELAY_MS = 60_000;
const POLL_MS = 1000;

const DEFAULT_PERIOD_MS = 5 * 60_000;
// the longest period; Node fires a timer above 2^31-1 ms at once
const MAX_PERIOD_MS = 24 * 60 * 60_000;

const validMs = (ms) => Number.isFinite(ms) && ms > 0;
const clampPeriod = (ms) => Math.min(ms, MAX_PERIOD_MS);

const pausedError = () => {
	const error = new errs.ValidationError("Dynamic DNS is paused", "error.ddns-paused");
	error.status = 409;
	return error;
};

/**
 * The dynamic DNS timer: the first cycle firstDelayMs after start(), then one every periodMs. A tick while a cycle
 * runs or while paused is skipped, never queued; only one cycle runs at a time, and runNow() takes the same lock.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.run              the cycle
 * @param   {number}    deps.periodMs         the interval
 * @param   {number}    [deps.firstDelayMs]   delay of the first cycle after start()
 * @param   {Object}    [deps.clock]          { setInterval, clearInterval, setTimeout, clearTimeout, now } (tests)
 * @param   {number}    [deps.pollMs]         how often pauseAndWait() looks at busy()
 * @param   {Object}    [deps.log]            logger with error() and info()
 */
const createDdnsTimer = ({
	run,
	periodMs,
	firstDelayMs = FIRST_DELAY_MS,
	clock = globalThis,
	pollMs = POLL_MS,
	log,
} = {}) => {
	let period = validMs(periodMs) ? clampPeriod(periodMs) : DEFAULT_PERIOD_MS;
	let firstHandle = null;
	let intervalHandle = null;
	let running = false;
	let nextAt = null;
	// a restore and a database move can each pause the timer: it runs again when every pause has ended
	let pauses = 0;
	// holders and waiters of the lock; the tail is what the next one waits for
	let active = 0;
	let tail = Promise.resolve();

	const now = () => (clock.now ? clock.now() : Date.now());

	const locked = (fn) => {
		active += 1;
		const result = tail
			.then(() => {
				if (pauses > 0) throw pausedError();
				return fn();
			})
			.finally(() => {
				active -= 1;
			});
		tail = result.catch(() => undefined);
		return result;
	};

	const tick = () => {
		if (pauses > 0 || active > 0) return;
		locked(run).catch((error) => {
			// a pause that began after the check above is a skip, not a failure
			if (error?.message_i18n === "error.ddns-paused") return;
			log?.error(`Dynamic DNS cycle failed: ${error?.message}`);
		});
	};

	const stopHandles = () => {
		if (firstHandle !== null) clock.clearTimeout(firstHandle);
		if (intervalHandle !== null) clock.clearInterval(intervalHandle);
		firstHandle = null;
		intervalHandle = null;
	};

	const startInterval = () => {
		nextAt = now() + period;
		intervalHandle = clock.setInterval(() => {
			nextAt = now() + period;
			tick();
		}, period);
	};

	const scheduleFirst = (delayMs) => {
		nextAt = now() + delayMs;
		firstHandle = clock.setTimeout(() => {
			firstHandle = null;
			startInterval();
			tick();
		}, delayMs);
	};

	const notBusy = async (wait) => {
		while (active > 0 && !wait.over) await new Promise((resolve) => clock.setTimeout(resolve, pollMs));
	};

	return {
		/** @returns {boolean} whether the timer is scheduled */
		running: () => running,

		/** @returns {boolean} whether the cycles are skipped */
		paused: () => pauses > 0,

		/** @returns {boolean} whether a cycle (or a runNow) holds or waits for the lock */
		busy: () => active > 0,

		/** @returns {number|null} when the next tick is due, ms since the epoch */
		nextRunOn: () => (running ? nextAt : null),

		/** Skips the cycles until resume() */
		pause: () => {
			pauses += 1;
		},

		/** Ends a pause; a cycle missed meanwhile is not made up */
		resume: () => {
			if (pauses > 0) pauses -= 1;
		},

		/**
		 * Pauses, then waits for a cycle that is going on. With timeoutMs it rejects with "writer-running" when the
		 * cycle takes longer, and this pause is ended again.
		 *
		 * @param {{ timeoutMs?: number }} [options]
		 */
		pauseAndWait: async ({ timeoutMs } = {}) => {
			pauses += 1;
			const wait = { over: false };
			try {
				await waitWithin(notBusy(wait), { name: "Dynamic DNS", timeoutMs, clock });
			} catch (error) {
				if (pauses > 0) pauses -= 1;
				throw error;
			} finally {
				wait.over = true;
			}
		},

		/**
		 * Waits for a running cycle, then runs fn under the same lock
		 *
		 * @param   {Function}  fn
		 * @returns {Promise}   what fn returns; rejects with a 409 "error.ddns-paused" while paused
		 */
		runNow: (fn) => {
			if (pauses > 0) return Promise.reject(pausedError());
			return locked(fn);
		},

		/**
		 * Starts the timer once
		 *
		 * @returns {boolean} false when it was already running
		 */
		start: () => {
			if (running) return false;
			running = true;
			scheduleFirst(Math.min(firstDelayMs, MAX_PERIOD_MS));
			return true;
		},

		/** Stops the timer; start() can run it again */
		stop: () => {
			stopHandles();
			running = false;
			nextAt = null;
		},

		/**
		 * Sets the period (an invalid value keeps the current one); a running timer restarts with it, the next
		 * tick one period from now
		 *
		 * @param {number} [nextPeriodMs]
		 */
		restart: (nextPeriodMs) => {
			if (validMs(nextPeriodMs)) period = clampPeriod(nextPeriodMs);
			if (!running) return;
			// before the first tick the rest of the first delay stays, the new period starts with that tick
			const waiting = firstHandle !== null;
			const remaining = Math.max(0, (nextAt ?? 0) - now());
			stopHandles();
			if (waiting) scheduleFirst(remaining);
			else startInterval();
			log?.info(`Dynamic DNS timer restarted (every ${period} ms)`);
		},
	};
};

export { createDdnsTimer };
