import { writerRunning } from "../database/pause.js";

// how long counts are kept in memory while the database flush keeps failing
const PENDING_MAX_MS = 10 * 60000;

const sumRequests = (rows) => rows.reduce((n, r) => n + r.requests, 0);

const hasRows = (data) =>
	data.minutes.length > 0 ||
	data.countries.length > 0 ||
	data.asns.length > 0 ||
	data.ips.length > 0 ||
	data.visitors.length > 0;

const mergeBatches = (batches) => ({
	minutes: batches.flatMap((b) => b.minutes),
	countries: batches.flatMap((b) => b.countries),
	asns: batches.flatMap((b) => b.asns),
	ips: batches.flatMap((b) => b.ips),
	visitors: batches.flatMap((b) => b.visitors),
});

/**
 * Moves the counter into the database and keeps the reader position in step with the counts written.
 * `settings` and `position` are the service's shared objects; the pending batches and the flush errors stay
 * private and are exposed through the methods.
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.store
 * @param   {Object}    deps.counter
 * @param   {Function}  deps.saveState  (state) => Promise
 * @param   {Function}  deps.statLog    () => Promise<{ino, size}>
 * @param   {Object}    deps.settings   showIps, uniqueVisitors
 * @param   {Object}    deps.position   lastState, savedState, unsavedState
 * @param   {Object}    deps.reader     createTrafficReader() instance
 * @param   {Function}  deps.now
 * @param   {Object}    deps.log
 * @param   {Function}  deps.logOnce
 * @param   {Function}  deps.logError   (what) => (err) => void
 * @returns {{flushNow: Function, flushForPause: Function, moveToLogEnd: Function, status: Function,
 *            dropPendingIps: Function, dropPendingVisitors: Function, reset: Function}}
 */
const createAggregator = ({
	store,
	counter,
	saveState,
	statLog,
	settings,
	position,
	reader,
	now,
	log,
	logOnce,
	logError,
}) => {
	let pending = [];
	let flushError = null;
	let droppedRequests = 0;

	/** Moves the counter into the pending batches and writes them; on failure keeps them up to 10 minutes. */
	const flushNow = async () => {
		// a read that yields to the event loop must finish first, so the saved position matches the counts
		if (reader.inFlight()) await reader.inFlight();
		const data = counter.drain();
		if (!settings.showIps) data.ips = [];
		if (!settings.uniqueVisitors) data.visitors = [];
		if (hasRows(data)) pending.push({ at: now(), data });
		const state = position.lastState;
		if (pending.length === 0) {
			flushError = null;
		} else {
			try {
				await store.flush(mergeBatches(pending.map((p) => p.data)));
				pending = [];
				flushError = null;
			} catch (err) {
				flushError = `Could not save the statistics: ${err.message}`;
				logOnce(flushError);
				const cutoff = now() - PENDING_MAX_MS;
				const old = pending.filter((p) => p.at <= cutoff);
				pending = pending.filter((p) => p.at > cutoff);
				droppedRequests += old.reduce((n, p) => n + sumRequests(p.data.minutes), 0);
				// those visitors were never stored: let them be counted again today
				counter.dropVisitors(old.flatMap((p) => p.data.visitors));
				return;
			}
		}
		if (state && (position.savedState?.inode !== state.inode || position.savedState?.offset !== state.offset)) {
			try {
				await saveState(state);
				position.savedState = state;
				position.unsavedState = null;
			} catch (err) {
				position.unsavedState = state;
				log.error(`Traffic statistics: could not save the reader position: ${err.message}`);
			}
		}
	};

	/**
	 * The final write of a pause: the counts, then the reader position of the counts written. A position that could
	 * not be saved is tried once more; when that fails too the pause fails, because a move would copy counts whose
	 * lines the new process reads again.
	 */
	const flushForPause = async () => {
		await flushNow();
		if (!position.unsavedState) return;
		const state = position.unsavedState;
		try {
			await saveState(state);
			position.savedState = state;
			position.unsavedState = null;
		} catch (err) {
			throw writerRunning(`Traffic statistics: the access log position could not be saved (${err.message})`);
		}
	};

	/**
	 * Moves the reader to the current end of the access log and saves that position (runs inside the queue): the
	 * lines nginx wrote while statistics were off (Write log files keeps the log on) are not counted. A missing log
	 * starts from its beginning once it exists; another stat error keeps the old position.
	 */
	const moveToLogEnd = async () => {
		if (reader.inFlight()) await reader.inFlight();
		let state = null;
		try {
			const st = await statLog();
			state = { inode: Number(st.ino), offset: Number(st.size) };
		} catch (err) {
			if (err?.code !== "ENOENT") {
				logError("could not find the end of the access log")(err);
				return;
			}
		}
		reader.resetReader();
		position.lastState = state;
		if (!state) return;
		try {
			await saveState(state);
			position.savedState = state;
			// a newer saved position: an older unsaved one must never be written over it
			position.unsavedState = null;
		} catch (err) {
			log.error(`Traffic statistics: could not save the reader position: ${err.message}`);
		}
	};

	return {
		flushNow,
		flushForPause,
		moveToLogEnd,
		status: () => ({ error: flushError, droppedRequests }),
		dropPendingIps: () => {
			for (const p of pending) p.data.ips = [];
		},
		dropPendingVisitors: () => {
			for (const p of pending) p.data.visitors = [];
		},
		/** Forgets the pending batches and the flush state (after every stored statistic was deleted). */
		reset: () => {
			pending = [];
			droppedRequests = 0;
			flushError = null;
		},
	};
};

export { createAggregator };
