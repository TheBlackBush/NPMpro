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

/**
 * Resumes paused writers in reverse order; a writer that cannot resume is logged and the rest still resume.
 *
 * @param   {Array<{ name: string, resume: Function }>}  paused  in the order they were paused
 * @param   {Object}  [options]
 * @param   {Object}  [options.log]  logger with error()
 * @returns {Promise<void>}
 */
const resumeWriters = async (paused, { log = console } = {}) => {
	for (const writer of [...paused].reverse()) {
		try {
			await writer.resume();
		} catch (error) {
			log.error(`${writer.name} could not resume after the database move: ${error?.message}`);
		}
	}
};

/**
 * Pauses the background writers of a database move one after another, each with the same time limit. When one
 * fails (it leaves itself as it was) the ones paused before it resume in reverse order and the error is thrown.
 *
 * @param   {Array<{ name: string, pause: Function, resume: Function }>}  writers  pause({ timeoutMs }) => Promise
 * @param   {Object}  [options]
 * @param   {number}  [options.timeoutMs]  MOVE_PAUSE_MS
 * @param   {Object}  [options.log]
 * @returns {Promise<Array>}  the paused writers, for resumeWriters() after a failed move
 */
const pauseWriters = async (writers, { timeoutMs = MOVE_PAUSE_MS, log = console } = {}) => {
	const paused = [];
	try {
		for (const writer of writers) {
			await writer.pause({ timeoutMs });
			paused.push(writer);
		}
	} catch (error) {
		await resumeWriters(paused, { log });
		throw error;
	}
	return paused;
};

export { MOVE_PAUSE_MS, pauseWriters, resumeWriters, waitWithin, writerRunning };
