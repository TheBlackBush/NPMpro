// While the database cannot be reached, the startup retries every second and knex reports every failed connection.
// The first failure is logged in full, then one short line every 30 seconds while the same error repeats, and one
// line when the database answers again; a different error is logged in full again. Driver messages name the host and
// user, never the password.

const REPEAT_MS = 30_000;
// the first line of knex's own connection warnings, without its prefix: the same text as the startup error's message
const KNEX_CONNECTION_WARNING = /^(?:Acquire connection error|Connection Error): (?:Error: )?(?<message>.*)$/u;

/**
 * @param   {Object}    options
 * @param   {Object}    options.log         { warn(line), info(line) } for the short lines
 * @param   {Function}  [options.now]       () => epoch ms
 * @param   {number}    [options.repeatMs]  how often a repeated error gets its short line
 * @returns {{ failed: Function, connected: Function }}
 */
const createRetryLog = ({ log, now = Date.now, repeatMs = REPEAT_MS }) => {
	let current = null;
	return {
		/**
		 * A failure: logs it in full (full()) when it is new, else a short line at most every repeatMs
		 *
		 * @param   {string}    message            what identifies the error (its message)
		 * @param   {Function}  full               logs the error in full
		 * @param   {Object}    [options]
		 * @param   {boolean}   [options.reached]  the database answered before this failure (a later startup step)
		 * @returns {"full"|"short"|"quiet"}
		 */
		failed(message, full, { reached = false } = {}) {
			const key = String(message);
			const at = now();
			if (current?.key !== key || current.reached !== reached) {
				current = { key, reached, shortAt: at };
				full();
				return "full";
			}
			if (at - current.shortAt < repeatMs) return "quiet";
			current.shortAt = at;
			log.warn(reached ? `Startup still failing: ${key}` : `Still waiting for the database: ${key}`);
			return "short";
		},
		/** The database answers: one line after failures to reach it, and a later failure counts as new */
		connected() {
			if (!current || current.reached) return;
			current = null;
			log.info("Connected to the database again");
		},
	};
};

/**
 * The startup error text of a knex connection warning, or null for any other warning
 *
 * @param   {*}  message  what knex passes to log.warn
 * @returns {string|null}
 */
const knexConnectionError = (message) => {
	if (typeof message !== "string") return null;
	return KNEX_CONNECTION_WARNING.exec(message.split("\n", 1)[0])?.groups.message ?? null;
};

/**
 * knex's log option: connection warnings go through the retry log, other warnings to warn as they are
 *
 * @param   {Object}    retryLog  createRetryLog()
 * @param   {Function}  warn      (message) => void
 * @returns {Object}  { warn }
 */
const knexLogOf = (retryLog, warn) => ({
	warn(message) {
		const error = knexConnectionError(message);
		if (error === null) warn(message);
		else retryLog.failed(error, () => warn(message));
	},
});

export { createRetryLog, KNEX_CONNECTION_WARNING, knexConnectionError, knexLogOf, REPEAT_MS };
