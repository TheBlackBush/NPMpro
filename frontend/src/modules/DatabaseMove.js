// The Database settings section and the move window: form values, payload, steps and the restart wait

export const ENGINES = ["sqlite", "mysql", "postgres"];
export const DEFAULT_PORTS = { mysql: 3306, postgres: 5432 };
export const MOVE_STEPS = ["maintenance", "backup", "schema", "copy", "verify", "switch"];

const HOST = /^[A-Za-z0-9._:%-]{1,253}$/u;
const DB_NAME = /^[A-Za-z0-9_][A-Za-z0-9_$-]{0,63}$/u;

export const initialTarget = (engine = "postgres") => ({
	engine,
	host: "",
	port: DEFAULT_PORTS[engine] ?? "",
	name: "npmpro",
	user: "npmpro",
	password: "",
	sslEnabled: false,
	sslRejectUnauthorized: true,
	sslVerifyIdentity: true,
});

// the port follows the engine while it is still the old engine's default
export const changeEngine = (values, engine) => ({
	...values,
	engine,
	port:
		values.port === DEFAULT_PORTS[values.engine] || values.port === ""
			? (DEFAULT_PORTS[engine] ?? "")
			: values.port,
});

export const targetErrors = (values) => {
	if (values.engine === "sqlite") return {};
	const errors = {};
	if (!HOST.test(String(values.host).trim())) errors.host = "settings.database.error.host";
	const port = Number(values.port);
	if (!(Number.isInteger(port) && port >= 1 && port <= 65_535)) errors.port = "settings.database.error.port";
	if (!DB_NAME.test(String(values.name))) errors.name = "settings.database.error.name";
	if (String(values.user).length < 1 || String(values.user).length > 255)
		errors.user = "settings.database.error.user";
	return errors;
};

export const toPayload = (values) => {
	if (values.engine === "sqlite") return { engine: "sqlite" };
	return {
		engine: values.engine,
		host: String(values.host).trim(),
		port: Number(values.port),
		name: values.name,
		user: values.user,
		password: values.password,
		ssl:
			values.engine === "mysql"
				? {
						enabled: values.sslEnabled,
						rejectUnauthorized: values.sslRejectUnauthorized,
						verifyIdentity: values.sslVerifyIdentity,
					}
				: { enabled: values.sslEnabled },
	};
};

// Move is enabled only for the values the last passing test used
export const payloadKey = (payload) => JSON.stringify(payload);

/**
 * The last test, when it was made with exactly these form values; null once any value changed
 *
 * @param   {?{ key: string, result?: Object, error?: unknown }} tested
 * @param   {Object} values  the form values
 * @returns {?{ key: string, result?: Object, error?: unknown }}
 */
export const testOfValues = (tested, values) => (tested?.key === payloadKey(toPayload(values)) ? tested : null);

// Move can start after a passing test of the current values
export const canMove = (current) => Boolean(current?.result);

// the hint next to a blocked Move: test first, or the test of these values failed
export const moveHint = (current) => {
	if (canMove(current)) return null;
	return current?.error ? "settings.database.test.failed-hint" : "settings.database.test.first";
};

export const stepState = (move, step) => {
	if (!move) return "pending";
	const at = MOVE_STEPS.indexOf(move.step);
	const index = MOVE_STEPS.indexOf(step);
	if (move.state === "restarting") return "done";
	if (move.state === "failed" && index === at) return "failed";
	if (index < at) return "done";
	if (index === at && move.state === "running") return "active";
	return "pending";
};

export const totals = (tables = []) => ({
	tables: tables.length,
	rows: tables.reduce((sum, table) => sum + Number(table.rows ?? 0), 0),
	copied: tables.reduce((sum, table) => sum + Number(table.copied ?? 0), 0),
});

const SOURCE_BADGES = {
	env: { labelId: "settings.database.source.env", className: "bg-orange-lt" },
	file: { labelId: "settings.database.source.file", className: "bg-blue-lt" },
	default: { labelId: "settings.database.source.default", className: "bg-secondary-lt" },
};

export const sourceBadge = (source) => SOURCE_BADGES[source] ?? SOURCE_BADGES.default;

export const whereText = (connection) =>
	connection.engine === "sqlite" ? connection.file : `${connection.host}:${connection.port}/${connection.name}`;

// a move the window follows until the restart: the section opens the window again for it
export const isMoveActive = (move) => move?.state === "running" || move?.state === "restarting";

/**
 * What the move window shows
 *
 * @param   {Object}   options
 * @param   {?string}  options.moveId      the move this window started or follows; null before the start
 * @param   {?Object}  options.move        the last answer of GET /database/move
 * @param   {boolean}  options.pollFailed  the last poll failed
 * @returns {"confirm"|"starting"|"running"|"restarting"|"failed"}
 */
export const moveView = ({ moveId, move, pollFailed }) => {
	if (!moveId) return "confirm";
	// an older move stays in the cache until the first poll of this one answers
	if (move?.id !== moveId) return "starting";
	if (move.state === "failed") return "failed";
	if (move.state === "restarting") return "restarting";
	// the old process exits only after the switch, so a poll can miss "restarting" and fail instead; at any other
	// step a failed poll is a lost connection, and the polls go on
	return pollFailed && move.step === "switch" ? "restarting" : "running";
};

/**
 * The copy step's progress: the percentage of rows copied and the table being copied
 */
export const copyProgress = (tables = []) => {
	const sums = totals(tables);
	const percent = sums.rows > 0 ? Math.min(100, Math.floor((sums.copied * 100) / sums.rows)) : 100;
	const current = tables.find((table) => Number(table.copied ?? 0) < Number(table.rows ?? 0)) ?? null;
	return { ...sums, percent, current };
};

// the active step's name for the screen reader announcement, null when no step is active
export const activeStep = (move) => (move?.state === "running" ? (move.step ?? null) : null);

// the move window closes only before the start, after a failure and when the restart wait ran out
export const canCloseMove = (view, restart) => view === "confirm" || view === "failed" || restart === "timeout";

// a move's error as an API error, so ApiErrorContent shows the translated message and the details behind a toggle
export const moveAsApiError = (error) => ({
	payload: { error: { message: error?.message, message_i18n: error?.messageI18n, output: error?.details } },
});

// the step a failed move stopped at
export const failedStepOf = (move) => move?.error?.step ?? move?.step ?? null;

// progress polls that failed this long in a row (since the last answer) start the resolution
export const STALL_MS = 10_000;

/**
 * The progress polls failed for STALL_MS in a row: counted from the last answer (or from when the polls resumed), so
 * TanStack's own retries do not matter
 */
export const pollStalled = ({ isError, lastAnswerAt, now, limitMs = STALL_MS }) =>
	Boolean(isError) && now - lastAnswerAt >= limitMs;

// a poll answered without this window's move although the window saw it: the backend restarted or lost it
export const moveLost = ({ seen, answered, move, moveId }) => Boolean(seen && answered && move?.id !== moveId);

/**
 * How a move ended when the progress polls cannot tell: asks the health check, then GET /database
 * - health with maintenance: the old process still runs the move ("running"; while a restart is expected, wait on)
 * - health without maintenance: the move ended; GET /database has it as failed ("failed", with the move) or not
 *   at all, another one or a finished one ("restarted")
 * - no health answer: wait, up to limitMs ("timeout")
 *
 * @returns {Promise<{ result: "running"|"failed"|"restarted"|"timeout", move?: Object }>}
 */
export const resolveMoveEnd = async ({
	moveId,
	expectRestart,
	fetchHealth,
	fetchDatabase,
	sleep,
	now,
	limitMs = 120_000,
	intervalMs = 2000,
}) => {
	const start = now();
	while (now() - start < limitMs) {
		let health = null;
		try {
			health = await fetchHealth();
		} catch {
			// nginx answers 502 while the backend restarts
		}
		if (health?.status === "OK" && health.maintenance && !expectRestart) return { result: "running" };
		if (health?.status === "OK" && !health.maintenance) {
			try {
				const database = await fetchDatabase();
				const move = database?.move;
				if (move?.id === moveId && move.state === "failed") return { result: "failed", move };
				if (move?.id === moveId && move.state === "running") return { result: "running" };
				return { result: "restarted" };
			} catch {
				// asked again after the interval (a 401 after the restart reloads the page by itself)
			}
		}
		await sleep(intervalMs);
	}
	return { result: "timeout" };
};

// the name of a step through formatMessage, or the raw step when the backend sends one this build does not know
export const stepName = (step, formatMessage) =>
	MOVE_STEPS.includes(step) ? formatMessage(`settings.database.step.${step}`) : (step ?? "");

export const TABLES_OPEN_KEY = "npmpro.settings.database.tables.open";

/**
 * Whether the tables card was left open in this browser; collapsed when nothing is stored or storage is blocked
 */
export const readTablesOpen = (storage) => {
	try {
		return storage.getItem(TABLES_OPEN_KEY) === "1";
	} catch {
		return false;
	}
};

/**
 * Remember the state of the tables card; a blocked storage is ignored
 */
export const writeTablesOpen = (storage, open) => {
	try {
		storage.setItem(TABLES_OPEN_KEY, open ? "1" : "0");
	} catch {
		// storage is blocked or full: the card still works, it just starts collapsed next time
	}
};

/**
 * The one line under the title of the tables card, for example "24 tables, 1,234 rows"
 */
export const tablesSummary = (tables, formatMessage) => {
	const sum = totals(tables);
	return formatMessage({ id: "settings.database.tables.total" }, { tables: sum.tables, rows: sum.rows });
};
