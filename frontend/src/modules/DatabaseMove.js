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

/**
 * After a move: the old process keeps maintenance on until it exits, so a health answer without it is the new process
 */
export const waitForRestart = async ({ fetchHealth, sleep, now, limitMs = 120_000, intervalMs = 2000 }) => {
	const start = now();
	while (now() - start < limitMs) {
		try {
			const health = await fetchHealth();
			if (health?.status === "OK" && !health.maintenance) return "ready";
		} catch {
			// the backend is restarting: nginx answers 502 meanwhile
		}
		await sleep(intervalMs);
	}
	return "timeout";
};

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
	// the old process exits right after the switch, so a poll can miss "restarting" and fail instead
	return pollFailed ? "restarting" : "running";
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

// the move window closes only before the start, after a failure and when the restart wait ran out
export const canCloseMove = (view, restart) => view === "confirm" || view === "failed" || restart === "timeout";
