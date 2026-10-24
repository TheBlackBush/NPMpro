const HOUR = 1000 * 60 * 60;

const validHours = (hours) => Number.isInteger(hours) && hours > 0;

/**
 * The certificate renewal interval timer
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.run              the renewal run
 * @param   {number}    [deps.hours]          initial interval, 3 when invalid
 * @param   {Object}    [deps.clock]          { setInterval, clearInterval } (tests)
 * @param   {Object}    [deps.log]            logger with info()
 */
const createRenewalTimer = ({ run, hours, clock = globalThis, log } = {}) => {
	let intervalHours = validHours(hours) ? hours : 3;
	let handle = null;

	const schedule = () => {
		handle = clock.setInterval(run, intervalHours * HOUR);
	};

	return {
		/** @returns {number} the interval in hours */
		hours: () => intervalHours,

		/** @returns {boolean} whether the timer is running */
		running: () => handle !== null,

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
