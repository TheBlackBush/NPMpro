import { waitWithin } from "./database/pause.js";

const HOUR = 1000 * 60 * 60;
const POLL_MS = 1000;

const validHours = (hours) => Number.isInteger(hours) && hours > 0;

/**
 * The certificate renewal interval timer
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.run              the renewal run
 * @param   {number}    [deps.hours]          initial interval, 3 when invalid
 * @param   {Function}  [deps.busy]           () => boolean, whether a renewal run is going on
 * @param   {Object}    [deps.clock]          { setInterval, clearInterval, setTimeout, clearTimeout } (tests)
 * @param   {Object}    [deps.log]            logger with info()
 * @param   {number}    [deps.pollMs]         how often pauseAndWait() looks at busy()
 */
const createRenewalTimer = ({ run, hours, busy = () => false, clock = globalThis, log, pollMs = POLL_MS } = {}) => {
	let intervalHours = validHours(hours) ? hours : 3;
	let handle = null;
	// a restore and a database move can each pause the timer: it runs again when every pause has ended
	let pauses = 0;

	// a paused timer keeps its interval but skips the runs
	const tick = () => {
		if (pauses > 0) return;
		return run();
	};

	// polls until no renewal runs, or until the wait gave up
	const notBusy = async (wait) => {
		while (busy() && !wait.over) await new Promise((resolve) => clock.setTimeout(resolve, pollMs));
	};

	const schedule = () => {
		handle = clock.setInterval(tick, intervalHours * HOUR);
	};

	return {
		/** @returns {number} the interval in hours */
		hours: () => intervalHours,

		/** @returns {boolean} whether the timer is running */
		running: () => handle !== null,

		/** @returns {boolean} whether the runs are skipped */
		paused: () => pauses > 0,

		/** Skips the runs until resume() */
		pause: () => {
			pauses += 1;
		},

		/** Ends a pause; a run missed meanwhile is not made up, the next interval runs */
		resume: () => {
			if (pauses > 0) pauses -= 1;
		},

		/**
		 * Pauses, then waits for a run that is going on. With timeoutMs it rejects with "writer-running" when the run
		 * takes longer, and this pause is ended again.
		 *
		 * @param {{ timeoutMs?: number }} [options]
		 */
		pauseAndWait: async ({ timeoutMs } = {}) => {
			pauses += 1;
			const wait = { over: false };
			try {
				await waitWithin(notBusy(wait), { name: "Certificate renewal", timeoutMs, clock });
			} catch (error) {
				if (pauses > 0) pauses -= 1;
				throw error;
			} finally {
				wait.over = true;
			}
		},

		/**
		 * Starts the timer once
		 *
		 * @returns {boolean} false when it was already running
		 */
		start: () => {
			if (handle !== null) return false;
			schedule();
			return true;
		},

		/**
		 * Sets the interval (an invalid value keeps the current one) and restarts a running timer with it; before
		 * start() it only stores the interval
		 *
		 * @param {number} [nextHours]
		 */
		restart: (nextHours) => {
			if (validHours(nextHours)) intervalHours = nextHours;
			if (handle === null) return;
			clock.clearInterval(handle);
			schedule();
			log?.info(`Certbot Renewal Timer restarted (every ${intervalHours} hours)`);
		},
	};
};

export { createRenewalTimer };
