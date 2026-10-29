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
