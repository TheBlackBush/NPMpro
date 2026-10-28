import errs from "../error.js";
import { ENGINES, serverFieldError } from "./connection-file.js";
import { listTables, serverVersion } from "./engine.js";
import { knexConfigOf } from "./knex-config.js";

const PROBE_TABLE = "npmpro_move_probe";
const FLOORS = { mysql: [8, 0], mariadb: [10, 6], postgres: [13, 0] };
const FLAVOR_NAMES = { mysql: "MySQL", mariadb: "MariaDB", postgres: "PostgreSQL" };
const VERSION = /^(\d+)\.(\d+)/u;

const invalid = (reason) => new errs.DatabaseMoveError("invalid-target", reason);

/**
 * The target of a test or move from the request body
 */
const validateTarget = (body) => {
	if (!ENGINES.includes(body?.engine)) throw invalid(`engine must be one of ${ENGINES.join(", ")}`);
	if (body.engine === "sqlite") return { engine: "sqlite" };
	const problem = serverFieldError(body);
	if (problem) throw invalid(problem);
	if (body.password !== undefined && typeof body.password !== "string") throw invalid("password must be a text");
	const { engine, host, port, user, name } = body;
	const ssl =
		engine === "mysql"
			? {
					enabled: Boolean(body.ssl?.enabled),
					reject_unauthorized: body.ssl?.reject_unauthorized ?? true,
					verify_identity: body.ssl?.verify_identity ?? true,
				}
			: { enabled: Boolean(body.ssl?.enabled) };
	return { engine, host, port, user, name, password: body.password ?? "", ssl };
};

const parseVersion = (engine, text) => {
	const match = VERSION.exec(String(text ?? ""));
	if (!match) return null;
	let flavor = "postgres";
	if (engine !== "postgres") flavor = /mariadb/iu.test(String(text)) ? "mariadb" : "mysql";
	return { flavor, major: Number(match[1]), minor: Number(match[2]), text: String(text) };
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
	current.name === target.name;

const withTimeout = (promise, timeoutMs) => {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// driver messages can echo the connection string: never show the password
const scrub = (error, password) => {
	const text = String(error?.message ?? error);
	return password ? text.split(password).join("***") : text;
};

const connectError = (error, timeoutMs, password) =>
	error?.code === "timeout" || /timeout/iu.test(String(error?.message))
		? new errs.DatabaseMoveError(
				"timeout",
				`The target database did not answer within ${Math.round(timeoutMs / 1000)} seconds`,
				{},
			)
		: new errs.DatabaseMoveError("connect", "Could not connect to the target database", {
				details: scrub(error, password),
			});

/**
 * Checks a move target without changing it: connect, version, empty, create and drop a table, not the database in use.
 * SQLite needs no test (a new file is used).
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
	try {
		let version;
		try {
			version = await withTimeout(serverVersion(knex), timeoutMs);
		} catch (error) {
			throw connectError(error, timeoutMs, target.password);
		}
		const parsed = parseVersion(target.engine, version);
		const problem = versionProblem(parsed);
		if (problem) throw new errs.DatabaseMoveError("version", problem, { details: version });
		let tables;
		try {
			tables = await listTables(knex, { views: true });
		} catch (error) {
			throw connectError(error, timeoutMs, target.password);
		}
		if (tables.length > 0) {
			throw new errs.DatabaseMoveError("not-empty", "The target database is not empty", {
				details: tables.slice(0, 20).join(", "),
			});
		}
		try {
			await knex.schema.createTable(PROBE_TABLE, (table) => table.integer("id"));
		} catch (error) {
			throw new errs.DatabaseMoveError(
				"permission",
				"The user cannot create and drop tables in the target database",
				{
					details: scrub(error, target.password),
				},
			);
		}
		try {
			await knex.schema.dropTable(PROBE_TABLE);
		} catch (error) {
			throw new errs.DatabaseMoveError(
				"permission",
				"The user cannot create and drop tables in the target database",
				{
					details: scrub(error, target.password),
				},
			);
		}
		return { engine: target.engine, version, flavor: parsed.flavor };
	} finally {
		await knex.destroy();
	}
};

export { PROBE_TABLE, parseVersion, sameDatabase, testTarget, validateTarget, versionProblem };
