import errs from "../error.js";

// How long a database move waits for one background writer (a renewal, a scheduled backup, a statistics flush or
// a GeoIP download that is going on) before it gives up and leaves everything as it was.
const MOVE_PAUSE_MS = 2 * 60_000;

/**
 * @param   {string}  name  the writer, shown as the error output
 * @returns {Error}         409 "writer-running"
 */
const writerRunning = (name) =>
	new errs.DatabaseMoveError(
		"writer-running",
		"A background task that writes to the database is still running, try the move again later",
		{ status: 409, details: name },
	);

/**
 * Waits for the work of a writer that is being paused. Without timeoutMs it waits without a limit; with it, it
 * rejects with "writer-running" when the work takes longer. The timer is always cleared.
 *
 * @param   {Promise}  work
 * @param   {Object}   options
 * @param   {string}   options.name
 * @param   {number}   [options.timeoutMs]
 * @param   {Object}   [options.clock]      { setTimeout, clearTimeout }
 * @returns {Promise<void>}
 */
const waitWithin = async (work, { name, timeoutMs, clock = globalThis }) => {
	if (timeoutMs === undefined) {
		await work;
		return;
	}
	let timer = null;
	const late = new Promise((_resolve, reject) => {
		timer = clock.setTimeout(() => reject(writerRunning(name)), timeoutMs);
	});
	try {
		await Promise.race([work, late]);
	} finally {
		clock.clearTimeout(timer);
	}
};

export { MOVE_PAUSE_MS, waitWithin, writerRunning };
