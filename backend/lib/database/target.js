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

const settled = (promise) =>
	promise.then(
		() => true,
		() => true,
	);

/**
 * Checks a move target without changing it: connect, version, empty, create and drop a table, not the database in use.
 * SQLite needs no test (a new file is used).
 *
 * Time: the checks get timeoutMs in all; after that a cancel flag stops them between steps, and one cleanup of at most
 * timeoutMs (wait for the running step, drop the probe table, close the connection) follows, so the answer comes after
 * at most twice the timeout. A step that never settles is not waited for beyond that; the error then says the probe
 * table may be left.
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
	const state = { cancelled: false, running: Promise.resolve(), probe: false };
	// one step at a time; none starts after the cancel
	const step = (action) => {
		if (state.cancelled) throw timeoutError(timeoutMs);
		const run = Promise.resolve().then(action);
		state.running = settled(run);
		return run;
	};
	const dropProbe = async () => {
		let last;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				await step(() => knex.schema.dropTable(PROBE_TABLE));
				state.probe = false;
				return;
			} catch (error) {
				if (state.cancelled) throw error;
				last = error;
			}
		}
		state.probe = false;
		throw new errs.DatabaseMoveError("permission", PERMISSION_MESSAGE, {
			details: `The probe table ${PROBE_TABLE} was left on the target and can be dropped by hand: ${scrub(last, target.password)}`,
		});
	};
	const checks = async () => {
		const version = await step(() => serverVersion(knex));
		const parsed = parseVersion(target.engine, version);
		const problem = versionProblem(parsed);
		if (problem) throw new errs.DatabaseMoveError("version", problem, { details: version });
		const tables = await step(() => listTables(knex, { views: true }));
		if (tables.length > 0) {
			throw new errs.DatabaseMoveError("not-empty", "The target database is not empty", {
				details: tables.slice(0, 20).join(", "),
			});
		}
		try {
			await step(() => {
				state.probe = true;
				return knex.schema.createTable(PROBE_TABLE, (table) => table.integer("id"));
			});
		} catch (error) {
			if (state.cancelled || !(error instanceof Error)) throw error;
			state.probe = false;
			throw new errs.DatabaseMoveError("permission", PERMISSION_MESSAGE, {
				details: scrub(error, target.password),
			});
		}
		await dropProbe();
		return { engine: target.engine, version, flavor: parsed.flavor };
	};
	// after the cancel: the running step settles, then the probe table goes, then the connection closes
	let maybeLeft = false;
	const cleanup = async () => {
		const sequence = (async () => {
			await state.running;
			if (state.probe) {
				try {
					await knex.schema.dropTableIfExists(PROBE_TABLE);
				} catch {
					maybeLeft = true;
				}
			}
			await knex.destroy();
		})();
		let timer;
		const limit = new Promise((resolve) => {
			timer = setTimeout(resolve, timeoutMs, "late");
		});
		const outcome = await Promise.race([settled(sequence).then(() => "done"), limit]);
		clearTimeout(timer);
		if (outcome === "late") {
			maybeLeft = maybeLeft || state.probe;
			// close anyway, without waiting
			Promise.resolve()
				.then(() => knex.destroy())
				.catch(() => {});
		}
	};
	let result;
	let failure;
	try {
		result = await withTimeout(checks(), timeoutMs);
	} catch (error) {
		failure = error;
		state.cancelled = true;
	}
	await cleanup();
	if (!failure) return result;
	if (failure instanceof errs.DatabaseMoveError) throw failure;
	const mapped = connectError(failure, timeoutMs, target.password);
	if (maybeLeft) {
		mapped.details = `${mapped.details ? `${mapped.details}. ` : ""}The probe table ${PROBE_TABLE} may be left on the target`;
	}
	throw mapped;
};

export { PROBE_TABLE, parseVersion, sameDatabase, testTarget, validateTarget, versionProblem };
