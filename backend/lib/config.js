import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { global as logger } from "../logger.js";
import { chooseDatabase, DATABASE_FILE, DEFAULT_SQLITE, unsealWith } from "./database/connection-file.js";
import { failingKnexConfig, knexConfigOf } from "./database/knex-config.js";
import { createRetryLog, knexLogOf } from "./retry-log.js";
import { defaultSecretBox } from "./secret-box.js";

// the startup retry (index.js) and knex's connection warnings share it: one full line per error, then short ones
const startupRetryLog = createRetryLog({ log: logger });

const keysFile = "/data/npmpro/keys-ec.json";
const SQLITE_FILE = DEFAULT_SQLITE;

let instance = null;

const SOURCE_TEXT = {
	env: "the DB_* environment variables",
	file: "/data/npmpro/database.json",
	default: "the default database file",
};
const ENGINE_TEXT = { sqlite: "SQLite", mysql: "MySQL/MariaDB", postgres: "PostgreSQL" };

// configure runs when the first module loads the models (before appStart): an invalid database.json must not throw
// here. It is logged once, and every query fails with the same message, so the startup retry shows it until the file
// is deleted or renamed and NPMpro restarted. There is no fallback to SQLite.
const configure = () => {
	let chosen;
	try {
		chosen = chooseDatabase({
			env: process.env,
			exists: existsSync,
			read: (file) => readFileSync(file, "utf8"),
			unseal: unsealWith(defaultSecretBox),
		});
	} catch (error) {
		logger.error(error.message);
		return {
			database: {
				source: "invalid",
				connection: { engine: null },
				moved_at: null,
				moved_from: null,
				knex: failingKnexConfig(error),
			},
			keys: getKeys(),
		};
	}
	const { connection } = chosen;
	const where =
		connection.engine === "sqlite" ? connection.file : `${connection.host}:${connection.port}/${connection.name}`;
	if (chosen.source === "env" && existsSync(DATABASE_FILE)) {
		logger.info(`Ignoring ${DATABASE_FILE}: the connection comes from the DB_* environment variables`);
	}
	logger.info(`Using ${ENGINE_TEXT[connection.engine]} ${where} from ${SOURCE_TEXT[chosen.source]}`);
	return {
		database: {
			...chosen,
			knex: knexConfigOf(connection, {
				note: (line) => logger.warn(line),
				log: knexLogOf(startupRetryLog, (message) => logger.warn(message)),
			}),
		},
		keys: getKeys(),
	};
};

const getKeys = () => {
	// Get keys from file
	logger.info("Checking for keys file:", keysFile);
	if (!existsSync(keysFile)) {
		generateKeys();
	} else {
		logger.info("Keys file exists OK");
	}
	try {
		// Load this json keysFile synchronously and return the json object
		const rawData = readFileSync(keysFile, "utf8");
		return JSON.parse(rawData);
	} catch (err) {
		logger.error(`Could not read JWT key pair from config file: ${keysFile}`, err);
		process.exit(1);
	}
};

const generateKeys = () => {
	logger.info("Creating a new JWT key pair...");

	// Now create the keys and save them in the config.
	const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
		namedCurve: "P-521",
		publicKeyEncoding: {
			type: "spki",
			format: "pem",
		},
		privateKeyEncoding: {
			type: "pkcs8",
			format: "pem",
		},
	});

	// Write keys config
	try {
		writeFileSync(keysFile, JSON.stringify({ key: privateKey, pub: publicKey }, null, 2), { mode: 0o600 });
	} catch (err) {
		logger.error(`Could not write JWT key pair to config file: ${keysFile}: ${err.message}`);
		process.exit(1);
	}
	logger.info(`Wrote JWT key pair to config file: ${keysFile}`);
};

/**
 * Gets a specific key from the top level
 *
 * @param {string} key
 * @returns {*}
 */
const configGet = (key) => {
	instance ??= configure();
	if (key && instance[key] !== undefined) return instance[key];
	return instance;
};

/**
 * Returns a public key
 *
 * @returns {string}
 */
const getPublicKey = () => {
	instance ??= configure();
	return instance.keys.pub;
};

/**
 * Returns a private key
 *
 * @returns {string}
 */
const getPrivateKey = () => {
	instance ??= configure();
	return instance.keys.key;
};

const engine = () => configGet("database").connection.engine;
const isSqlite = () => engine() === "sqlite";
const isMysql = () => engine() === "mysql";
const isPostgres = () => engine() === "postgres";

/**
 * The SQLite file in use, or null on MySQL/Postgres
 *
 * @returns {string|null}
 */
const sqliteFile = () => (isSqlite() ? configGet("database").connection.file : null);

/**
 * Where the connection comes from and what it is (with the password, for the database service only)
 *
 * @returns {{ source: string, connection: Object, moved_at: string|null, moved_from: Object|null }}
 */
const getDatabaseInfo = () => {
	const { source, connection, moved_at, moved_from } = configGet("database");
	return { source, connection, moved_at, moved_from };
};

export {
	configGet,
	getDatabaseInfo,
	getPrivateKey,
	getPublicKey,
	isMysql,
	isPostgres,
	isSqlite,
	SQLITE_FILE,
	sqliteFile,
	startupRetryLog,
};
