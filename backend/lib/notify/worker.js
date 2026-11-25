import { waitWithin } from "../database/pause.js";

// The delivery worker: one pass at a time. A pass asks the queue for the due rows of every channel, sends them (one
// target at a time, at most maxConcurrent units at once per channel) and settles the results. A failure of one send
// never stops the rest, and an error of the pass is logged, never thrown.

const POLL_MS = 5000;
const KICK_MS = 50;
const CLAIM_LIMIT = 50;

// the rows of one send call (a mail group is one call), the units run one after another per target
const unitsOf = (rows) => {
	const units = new Map();
	const jobs = new Map();
	for (const row of rows) {
		const jobKey = row.group_key === null ? `row:${row.id}` : `group:${row.group_key}`;
		let job = jobs.get(jobKey);
		if (!job) {
			job = { rows: [] };
			jobs.set(jobKey, job);
			const unitKey = row.target_id === null ? `job:${jobKey}` : `target:${row.target_id}`;
			if (!units.has(unitKey)) units.set(unitKey, []);
			units.get(unitKey).push(job);
		}
		job.rows.push(row);
	}
	return [...units.values()];
};

/**
 * @param   {Object}    options
 * @param   {Object}    options.queue
 * @param   {Function|Object[]}  options.channels  the registered channels, or a function that returns them
 * @param   {Object}    [options.clock]   { setTimeout, clearTimeout, setInterval, clearInterval } (tests)
 * @param   {Object}    [options.log]
 * @param   {Number}    [options.pollMs]
 */
const createWorker = ({ queue, channels, clock = globalThis, log, pollMs = POLL_MS }) => {
	const channelList = typeof channels === "function" ? channels : () => channels;
	let interval = null;
	let kickTimer = null;
	let current = null;
	let again = false;
	// a restore and a database move can each pause the worker: it runs again when every pause has ended
	let pauses = 0;

	const sendJob = async (channel, job) => {
		let results;
		try {
			results = await channel.send(job.rows);
		} catch (error) {
			log?.warn?.(`notify: ${channel.id} send failed: ${error?.message}`);
			results = [];
		}
		const byId = new Map((results ?? []).map((result) => [result.id, result]));
		// a row the channel did not answer for is retried like a failed send
		return job.rows.map((row) => byId.get(row.id) ?? { id: row.id, ok: false, retry: true, error: "no result" });
	};

	const runUnit = async (channel, unit) => {
		for (const job of unit) {
			const results = await sendJob(channel, job);
			await queue.settle(results, { retryDelays: channel.retryDelays ?? [] });
		}
	};

	const runChannel = async (channel) => {
		const rows = await queue.claimDue({ channel: channel.id, limit: CLAIM_LIMIT });
		if (rows.length === 0) return false;
		const units = unitsOf(rows);
		const width = Math.max(1, channel.maxConcurrent ?? 1);
		const lanes = Array.from({ length: Math.min(width, units.length) }, async () => {
			while (units.length > 0) await runUnit(channel, units.shift());
		});
		await Promise.all(lanes);
		return rows.length >= CLAIM_LIMIT;
	};

	const pass = async () => {
		let more = false;
		for (const channel of channelList()) {
			try {
				more = (await runChannel(channel)) || more;
			} catch (error) {
				log?.warn?.(`notify: ${channel.id} pass failed: ${error?.message}`);
			}
		}
		return more;
	};

	const run = () => {
		if (pauses > 0) return Promise.resolve();
		if (current) {
			again = true;
			return current;
		}
		current = (async () => {
			try {
				do {
					again = false;
					if ((await pass()) && pauses === 0) again = true;
				} while (again && pauses === 0);
			} finally {
				current = null;
			}
		})();
		return current;
	};

	return {
		/** Starts the poll once; false when it already runs */
		start: () => {
			if (interval !== null) return false;
			interval = clock.setInterval(() => void run(), pollMs);
			interval.unref?.();
			return true;
		},

		/** Stops the poll (the app is closing; tests) */
		stop: () => {
			if (interval !== null) clock.clearInterval(interval);
			interval = null;
			if (kickTimer !== null) clock.clearTimeout(kickTimer);
			kickTimer = null;
		},

		/** A pass soon (after an emit); many kicks make one pass */
		kick: () => {
			if (kickTimer !== null || pauses > 0) return;
			kickTimer = clock.setTimeout(() => {
				kickTimer = null;
				void run();
			}, KICK_MS);
			kickTimer.unref?.();
		},

		/** One pass now; resolves when it ended (the pass that is going on, when there is one) */
		runOnce: run,

		/** Skips the passes until resume() */
		pause: () => {
			pauses += 1;
		},

		/** Ends a pause; a pass missed meanwhile is not made up, the next poll runs */
		resume: () => {
			if (pauses > 0) pauses -= 1;
		},

		/** Pauses, then waits for the pass that is going on; with timeoutMs it rejects with "writer-running" */
		pauseAndWait: async ({ timeoutMs } = {}) => {
			pauses += 1;
			try {
				await waitWithin(current ?? Promise.resolve(), { name: "Notification delivery", timeoutMs, clock });
			} catch (error) {
				if (pauses > 0) pauses -= 1;
				throw error;
			}
		},

		/** @returns {boolean} whether the passes are skipped */
		paused: () => pauses > 0,

		/** @returns {boolean} whether a pass is going on */
		busy: () => current !== null,
	};
};

export { createWorker };
