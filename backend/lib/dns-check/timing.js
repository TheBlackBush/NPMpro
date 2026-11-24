// The time bounds of the DNS checks (the host check and the CAA check): one deadline per request and a race timer
// for each try of a lookup, so a resolver that stops answering cannot hold a request for long. c-ares doubles its own
// timeout per round and per server, so its timeout alone does not bound a lookup. The tests shorten these values;
// nothing else writes them.

const checkTiming = {
	// a host check or CAA request: names not finished by then answer unknown and are not cached
	requestMs: 60_000,
	// one try of a lookup
	tryMs: 3000,
	tries: 2,
};

/**
 * A request deadline: aborted after checkTiming.requestMs; expired resolves when it is
 *
 * @returns {{ signal: AbortSignal, expired: Promise<void> }}
 */
const requestDeadline = () => {
	const signal = AbortSignal.timeout(checkTiming.requestMs);
	const expired = new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
	return { signal, expired };
};

/**
 * The result of task, or of late() when the deadline comes first
 *
 * @param   {Promise}   task
 * @param   {{ signal: AbortSignal, expired: Promise<void> }}  deadline
 * @param   {Function}  late  () => the answer of an unfinished task
 * @returns {Promise}
 */
const beforeDeadline = (task, deadline, late) => {
	if (deadline.signal.aborted) return Promise.resolve(late());
	return Promise.race([task, deadline.expired.then(late)]);
};

export { beforeDeadline, checkTiming, requestDeadline };
