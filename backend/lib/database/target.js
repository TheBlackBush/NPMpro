import errs from "../error.js";
import { ENGINES, serverFieldError } from "./connection-file.js";
import { listTables, serverVersion } from "./engine.js";
import { knexConfigOf } from "./knex-config.js";

const PROBE_TABLE = "npmpro_move_probe";
const FLOORS = { mysql: [8, 0], mariadb: [10, 6], postgres: [13, 0] };
const FLAVOR_NAMES = { mysql: "MySQL", mariadb: "MariaDB", postgres: "PostgreSQL" };
const MYSQL_VERSION = /^(?:5\.5\.5-)?(?<major>\d+)\.(?<minor>\d+)/u;
const PG_VERSION = /(?<major>\d+)(?:\.(?<minor>\d+))?/u;
const KEYS = ["engine", "host", "port", "user", "name", "password", "ssl"];
const SSL_KEYS = { mysql: ["enabled", "reject_unauthorized", "verify_identity"], postgres: ["enabled"] };

const invalid = (reason) => new errs.DatabaseMoveError("invalid-target", reason);

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const sslOf = (engine, ssl) => {
	if (ssl === undefined) ssl = {};
	if (!isPlainObject(ssl)) throw invalid("ssl must be an object");
	const unknown = Object.keys(ssl).find((key) => !SSL_KEYS[engine].includes(key));
	if (unknown) throw invalid(`ssl.${unknown} is not a setting of ${engine}`);
	for (const key of SSL_KEYS[engine]) {
		if (ssl[key] !== undefined && typeof ssl[key] !== "boolean") throw invalid(`ssl.${key} must be true or false`);
	}
	if (engine === "mysql") {
		return {
			enabled: ssl.enabled ?? false,
			reject_unauthorized: ssl.reject_unauthorized ?? true,
			verify_identity: ssl.verify_identity ?? true,
		};
	}
	return { enabled: ssl.enabled ?? false };
};

/**
 * The target of a test or move from the request body
 */
const validateTarget = (body) => {
	if (!ENGINES.includes(body?.engine)) throw invalid(`engine must be one of ${ENGINES.join(", ")}`);
	if (body.engine === "sqlite") return { engine: "sqlite" };
	const unknown = Object.keys(body).find((key) => !KEYS.includes(key));
	if (unknown) throw invalid(`${unknown} is not a setting of the target`);
	const problem = serverFieldError(body);
	if (problem) throw invalid(problem);
	if (body.password !== undefined && typeof body.password !== "string") throw invalid("password must be a text");
	const { engine, host, port, user, name } = body;
	return { engine, host, port, user, name, password: body.password ?? "", ssl: sslOf(engine, body.ssl) };
};

const parseVersion = (engine, text) => {
	const value = String(text ?? "");
	if (engine === "postgres") {
		const found = PG_VERSION.exec(value)?.groups;
		return found
			? { flavor: "postgres", major: Number(found.major), minor: Number(found.minor ?? 0), text: value }
			: null;
	}
	// MariaDB behind a replication proxy reports "5.5.5-10.x"
	const found = MYSQL_VERSION.exec(value)?.groups;
	if (!found) return null;
	const flavor = /mariadb/iu.test(value) ? "mariadb" : "mysql";
	return { flavor, major: Number(found.major), minor: Number(found.minor), text: value };
};

const versionProblem = (parsed) => {
	if (!parsed) return "The server version could not be read";
	const [major, minor] = FLOORS[parsed.flavor];
	if (parsed.major > major || (parsed.major === major && parsed.minor >= minor)) return null;
	const name = FLAVOR_NAMES[parsed.flavor];
	return `${name} ${parsed.major}.${parsed.minor} is too old, NPMpro needs ${name} ${major}.${minor} or newer`;
};

const sameDatabase = (current, target) =>
	current.engine === target.engine &&
	target.engine !== "sqlite" &&
	String(current.host).toLowerCase() === String(target.host).toLowerCase() &&
	Number(current.port) === Number(target.port) &&
	(target.engine === "mysql"
		? String(current.name).toLowerCase() === target.name.toLowerCase()
		: current.name === target.name);

const withTimeout = (promise, timeoutMs) => {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// driver messages can echo the connection string: never show the password, in any common encoding
const scrub = (error, password) => {
	const text = String(error?.message ?? error);
	if (!password) return text;
	const forms = [
		...new Set([
			password,
			encodeURIComponent(password),
			encodeURI(password),
			JSON.stringify(password).slice(1, -1),
		]),
	].sort((first, second) => second.length - first.length);
	return forms.reduce((result, form) => result.split(form).join("***"), text);
};

const timeoutError = (timeoutMs) =>
	new errs.DatabaseMoveError(
		"timeout",
		`The target database did not answer within ${Math.round(timeoutMs / 1000)} seconds`,
	);

const connectError = (error, timeoutMs, password) =>
	error?.code === "timeout" || /timeout/iu.test(String(error?.message))
		? timeoutError(timeoutMs)
		: new errs.DatabaseMoveError("connect", "Could not connect to the target database", {
				details: scrub(error, password),
			});

const PERMISSION_MESSAGE = "The user cannot create and drop tables in the target database";

// create and drop the probe table; a drop that fails twice says that the table was left behind
const probeTable = async (knex, password) => {
	try {
		await knex.schema.createTable(PROBE_TABLE, (table) => table.integer("id"));
	} catch (error) {
		throw new errs.DatabaseMoveError("permission", PERMISSION_MESSAGE, { details: scrub(error, password) });
	}
	let last;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await knex.schema.dropTable(PROBE_TABLE);
			return;
		} catch (error) {
			last = error;
		}
	}
	throw new errs.DatabaseMoveError("permission", PERMISSION_MESSAGE, {
		details: `The probe table ${PROBE_TABLE} was left on the target and can be dropped by hand: ${scrub(last, password)}`,
	});
};

// the probe table of a test that stopped half way (best effort, bounded)
const cleanProbe = async (knex, timeoutMs) => {
	try {
		await withTimeout(knex.schema.dropTableIfExists(PROBE_TABLE), timeoutMs);
	} catch {
		// the target is gone or the user may not drop: nothing more to do
	}
};

/**
 * Checks a move target without changing it: connect, version, empty, create and drop a table, not the database in use.
 * SQLite needs no test (a new file is used). One time limit covers all the steps; nothing is left behind.
 *
 * @param   {Object}    options
 * @param   {Object}    options.target      validateTarget()
 * @param   {Object}    options.current     the connection in use
 * @param   {Function}  options.createKnex  (config) => knex
 * @param   {number}    [options.timeoutMs]
 * @returns {Promise<{ engine: string, version: string|null, flavor: string|null }>}
 */
const testTarget = async ({ target, current, createKnex, timeoutMs = 10_000 }) => {
	if (target.engine === "sqlite") return { engine: "sqlite", version: null, flavor: null };
	if (sameDatabase(current, target)) {
		throw new errs.DatabaseMoveError("same-database", "The target is the database in use");
	}
	const knex = createKnex(knexConfigOf(target, { timeoutMs }));
	let probeStarted = false;
	const checks = async () => {
		const version = await serverVersion(knex);
		const parsed = parseVersion(target.engine, version);
		const problem = versionProblem(parsed);
		if (problem) throw new errs.DatabaseMoveError("version", problem, { details: version });
		const tables = await listTables(knex, { views: true });
		if (tables.length > 0) {
			throw new errs.DatabaseMoveError("not-empty", "The target database is not empty", {
				details: tables.slice(0, 20).join(", "),
			});
		}
		probeStarted = true;
		await probeTable(knex, target.password);
		probeStarted = false;
		return { engine: target.engine, version, flavor: parsed.flavor };
	};
	try {
		return await withTimeout(checks(), timeoutMs);
	} catch (error) {
		if (error instanceof errs.DatabaseMoveError) throw error;
		throw connectError(error, timeoutMs, target.password);
	} finally {
		if (probeStarted) await cleanProbe(knex, timeoutMs);
		try {
			await withTimeout(knex.destroy(), timeoutMs);
		} catch {
			// a hung connection must not block the answer
		}
	}
};

export { PROBE_TABLE, parseVersion, sameDatabase, testTarget, validateTarget, versionProblem };
