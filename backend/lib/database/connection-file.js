import { chmod, open, rename, rm } from "node:fs/promises";
import path from "node:path";

// The connection a database move saved: /data/npmpro/database.json. Read at startup after the DB_* env vars and before
// the default SQLite file; an invalid file stops the startup instead of falling back.

const DATA_DIR = "/data/npmpro";
const DATABASE_FILE = `${DATA_DIR}/database.json`;
const DEFAULT_SQLITE = `${DATA_DIR}/database.sqlite`;
const ENGINES = ["sqlite", "mysql", "postgres"];
const SQLITE_NAME = /^database(?:-\d{8}-\d{6})?\.sqlite$/u;
const HOST = /^[A-Za-z0-9._:%-]{1,253}$/u;
const DB_NAME = /^[A-Za-z0-9_][A-Za-z0-9_$-]{0,63}$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters in a user name are refused on purpose
const CONTROL = /[\u0000-\u001f\u007f]/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const TRUTHY = /^(?:1|true|yes|on)$/iu;

const COMMON_KEYS = ["version", "engine", "moved_at", "moved_from"];
const KEYS = {
	sqlite: [...COMMON_KEYS, "file"],
	mysql: [...COMMON_KEYS, "host", "port", "user", "name", "password", "ssl"],
	postgres: [...COMMON_KEYS, "host", "port", "user", "name", "password", "ssl"],
};
const SSL_KEYS = { mysql: ["enabled", "reject_unauthorized", "verify_identity"], postgres: ["enabled"] };

class ConnectionFileError extends Error {
	name = this.constructor.name;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (reason) => {
	throw new ConnectionFileError(reason);
};
const onlyKeys = (value, allowed, where) => {
	const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) fail(`${where} has unknown keys: ${unknown.join(", ")}`);
};

/**
 * The first problem of the server fields of a connection, or null
 *
 * @param   {Object}  fields  { host, port, user, name }
 * @returns {string|null}
 */
const serverFieldError = ({ host, port, user, name }) => {
	if (typeof host !== "string" || !HOST.test(host)) return "host must be a host name or IP address";
	if (!Number.isInteger(port) || port < 1 || port > 65_535) return "port must be a number from 1 to 65535";
	if (typeof user !== "string" || user === "" || user.length > 255 || CONTROL.test(user)) {
		return "user must have 1 to 255 characters";
	}
	if (typeof name !== "string" || !DB_NAME.test(name)) {
		return "name must be a database name (letters, digits, _ $ -, at most 64 characters)";
	}
	return null;
};

const sqliteFileOk = (file, dataDir) =>
	typeof file === "string" &&
	path.normalize(file) === file &&
	path.dirname(file) === dataDir &&
	SQLITE_NAME.test(path.basename(file));

const movedOf = (value) => {
	if (value.moved_at !== undefined && !(typeof value.moved_at === "string" && ISO.test(value.moved_at))) {
		fail("moved_at must be an ISO date");
	}
	const from = value.moved_from;
	if (from !== undefined) {
		if (!isObject(from)) fail("moved_from must be an object");
		onlyKeys(from, ["engine", "host", "name"], "moved_from");
		if (!ENGINES.includes(from.engine)) fail("moved_from.engine is unknown");
		for (const key of ["host", "name"]) {
			if (from[key] !== undefined && !(typeof from[key] === "string" && from[key].length <= 255)) {
				fail(`moved_from.${key} must be a text of at most 255 characters`);
			}
		}
	}
	return { moved_at: value.moved_at ?? null, moved_from: from ? { ...from } : null };
};

/**
 * @param   {string}    raw                  the file content
 * @param   {Object}    options
 * @param   {Function}  options.unseal       (sealed) => password
 * @param   {string}    [options.dataDir]    where SQLite files may be
 * @returns {Object}    the connection with moved_at and moved_from
 */
const parseConnectionFile = (raw, { unseal, dataDir = DATA_DIR }) => {
	let value;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		fail(`it is not valid JSON (${error.message})`);
	}
	if (!isObject(value)) fail("it is not a JSON object");
	if (value.version !== 1) fail("version must be 1");
	if (!ENGINES.includes(value.engine)) fail(`engine must be one of ${ENGINES.join(", ")}`);
	onlyKeys(value, KEYS[value.engine], "the file");
	const moved = movedOf(value);
	if (value.engine === "sqlite") {
		if (!sqliteFileOk(value.file, dataDir)) fail(`file must be a database*.sqlite file in ${dataDir}`);
		return { engine: "sqlite", file: value.file, ...moved };
	}
	const problem = serverFieldError(value);
	if (problem) fail(problem);
	if (typeof value.password !== "string") fail("password must be a sealed text");
	if (!isObject(value.ssl)) fail("ssl must be an object");
	onlyKeys(value.ssl, SSL_KEYS[value.engine], "ssl");
	for (const key of SSL_KEYS[value.engine]) {
		if (typeof value.ssl[key] !== "boolean") fail(`ssl.${key} must be true or false`);
	}
	let password;
	try {
		password = unseal(value.password);
	} catch (error) {
		fail(`the password cannot be unsealed (${error.message})`);
	}
	if (typeof password !== "string") fail("the password cannot be unsealed");
	const { host, port, user, name } = value;
	return { engine: value.engine, host, port, user, name, password, ssl: { ...value.ssl }, ...moved };
};

const sslOf = (connection) =>
	connection.engine === "mysql"
		? {
				enabled: Boolean(connection.ssl?.enabled),
				reject_unauthorized: connection.ssl?.reject_unauthorized ?? true,
				verify_identity: connection.ssl?.verify_identity ?? true,
			}
		: { enabled: Boolean(connection.ssl?.enabled) };

/**
 * The content of database.json for a connection
 *
 * @param   {Object}    connection
 * @param   {Object}    options    { seal(password), movedAt, movedFrom }
 * @returns {Object}
 */
const connectionFileOf = (connection, { seal, movedAt, movedFrom }) => {
	const moved = { moved_at: movedAt, moved_from: movedFrom };
	if (connection.engine === "sqlite") return { version: 1, engine: "sqlite", file: connection.file, ...moved };
	const { engine, host, port, user, name } = connection;
	return {
		version: 1,
		engine,
		host,
		port,
		user,
		name,
		password: seal(connection.password ?? ""),
		ssl: sslOf(connection),
		...moved,
	};
};

/**
 * Writes the file atomically: a temporary file in the same folder, synced, then renamed over the old one
 */
const writeConnectionFile = async (file, content) => {
	const temporary = `${file}.${process.pid}.tmp`;
	try {
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(`${JSON.stringify(content, null, 2)}\n`);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await chmod(temporary, 0o600);
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
};

const toBool = (value) => TRUTHY.test(String(value ?? "").trim());

// an unset password stays undefined, as before, so the drivers keep their own defaults (PGPASSWORD, .pgpass)
const envConnection = (env) => {
	if (env.DB_MYSQL_HOST && env.DB_MYSQL_USER && env.DB_MYSQL_NAME) {
		return {
			engine: "mysql",
			host: env.DB_MYSQL_HOST,
			port: Number(env.DB_MYSQL_PORT || 3306),
			user: env.DB_MYSQL_USER,
			name: env.DB_MYSQL_NAME,
			password: env.DB_MYSQL_PASSWORD,
			ssl: {
				enabled: toBool(env.DB_MYSQL_SSL),
				reject_unauthorized:
					env.DB_MYSQL_SSL_REJECT_UNAUTHORIZED === undefined
						? true
						: toBool(env.DB_MYSQL_SSL_REJECT_UNAUTHORIZED),
				verify_identity:
					env.DB_MYSQL_SSL_VERIFY_IDENTITY === undefined ? true : toBool(env.DB_MYSQL_SSL_VERIFY_IDENTITY),
			},
		};
	}
	if (env.DB_POSTGRES_HOST && env.DB_POSTGRES_USER && env.DB_POSTGRES_NAME) {
		return {
			engine: "postgres",
			host: env.DB_POSTGRES_HOST,
			port: Number(env.DB_POSTGRES_PORT || 5432),
			user: env.DB_POSTGRES_USER,
			name: env.DB_POSTGRES_NAME,
			password: env.DB_POSTGRES_PASSWORD,
			ssl: { enabled: false },
		};
	}
	return null;
};

/**
 * Which database to use: complete DB_MYSQL_* or DB_POSTGRES_* env vars, then database.json, then the default SQLite file
 */
const chooseDatabase = ({ env, file = DATABASE_FILE, dataDir = DATA_DIR, exists, read, unseal }) => {
	const fromEnv = envConnection(env);
	if (fromEnv) return { source: "env", connection: fromEnv, moved_at: null, moved_from: null };
	if (exists(file)) {
		try {
			const { moved_at, moved_from, ...connection } = parseConnectionFile(read(file), { unseal, dataDir });
			return { source: "file", connection, moved_at, moved_from };
		} catch (error) {
			throw new ConnectionFileError(
				`Could not use ${file}: ${error.message}. Delete or rename it and restart NPMpro to start on the default SQLite database ${path.join(dataDir, "database.sqlite")}.`,
				{ cause: error },
			);
		}
	}
	return {
		source: "default",
		connection: { engine: "sqlite", file: path.join(dataDir, "database.sqlite") },
		moved_at: null,
		moved_from: null,
	};
};

const publicConnection = ({ password: _password, ...rest }) => rest;
const sealWith = (box) => (password) => box.encrypt({ password });
const unsealWith = (box) => (sealed) => box.decrypt(sealed).password;

export {
	ConnectionFileError,
	chooseDatabase,
	connectionFileOf,
	DATA_DIR,
	DATABASE_FILE,
	DEFAULT_SQLITE,
	ENGINES,
	parseConnectionFile,
	publicConnection,
	SQLITE_NAME,
	sealWith,
	serverFieldError,
	unsealWith,
	writeConnectionFile,
};
