// the pragmas every SQLite connection gets (moved from lib/config.js)
const sqlitePragmas = (conn, done) => {
	conn.pragma("synchronous = NORMAL");
	// deleted rows (old secrets) are overwritten, not left in free pages
	conn.pragma("secure_delete = FAST");
	conn.pragma("temp_store = MEMORY");
	conn.pragma("optimize = 0x10002");
	done(null, conn);
};

// MySQL and MariaDB answer ER_UNKNOWN_TIME_ZONE for a zone name when the server has no time zone tables
const ER_UNKNOWN_TIME_ZONE = 1298;
let offsetNoted = false;
// a TZ of the form :Area/City (POSIX allows the colon)
const TZ_COLON = /^:/u;

/** The process's IANA time zone (the container's TZ), UTC when none is known */
const processZone = () =>
	process.env.TZ?.trim().replace(TZ_COLON, "") || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * The UTC offset of a date in the process's zone as MySQL takes it, e.g. +02:00 or -03:30
 *
 * @param   {Date}  date
 * @returns {string}
 */
const utcOffsetOf = (date) => {
	const minutes = -date.getTimezoneOffset();
	const abs = Math.abs(minutes);
	const pad = (value) => String(value).padStart(2, "0");
	return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/**
 * The pool's afterCreate for MySQL and MariaDB: the session uses the process's time zone, so NOW() writes the same
 * naive local time that mysql2 (timezone "local") reads and writes, and SQLite keeps. The zone name when the server
 * knows it, else the current UTC offset (noted once: without zone tables a DST change needs a restart).
 *
 * @param   {Object}    [options]
 * @param   {string}    [options.zone]  IANA zone, the process's by default
 * @param   {Function}  [options.now]   () => Date, for the offset
 * @param   {Function}  [options.note]  (line) => void, called once per process when the offset is used
 * @returns {Function}  (conn, done) => void
 */
const mysqlSessionZone =
	({ zone = processZone(), now = () => new Date(), note = () => {} } = {}) =>
	(conn, done) => {
		conn.query("SET time_zone = ?", [zone], (error) => {
			if (!error) {
				done(null, conn);
				return;
			}
			if (error.errno !== ER_UNKNOWN_TIME_ZONE) {
				done(error, conn);
				return;
			}
			const offset = utcOffsetOf(now());
			conn.query("SET time_zone = ?", [offset], (offsetError) => {
				if (!(offsetError || offsetNoted)) {
					offsetNoted = true;
					note(
						`The database server has no time zone tables, so it cannot use ${zone}: the connections use the current UTC offset ${offset}. After a daylight saving time change restart NPMpro (or load the zone tables into the server).`,
					);
				}
				done(offsetError ?? null, conn);
			});
		});
	};

// for tests
const resetZoneNote = () => {
	offsetNoted = false;
};

/**
 * The knex config of a connection
 *
 * @param   {Object}  connection           { engine: "sqlite", file } or { engine, host, port, user, name, password, ssl }
 * @param   {Object}  [options]
 * @param   {number}  [options.timeoutMs]  connect and pool acquire timeout (the move's target test)
 * @param   {Object}  [options.log]        knex's log ({ warn, error, deprecate, debug }), knex's own by default
 * @param   {Function} [options.note]      (line) => void, for the MySQL time zone note
 * @returns {Object}
 */
const knexConfigOf = (connection, { timeoutMs, log, note } = {}) => {
	const logOption = log ? { log } : {};
	const timeout = timeoutMs ? { acquireConnectionTimeout: timeoutMs } : {};
	if (connection.engine === "sqlite") {
		return {
			client: "better-sqlite3",
			connection: { filename: connection.file },
			useNullAsDefault: true,
			pool: { afterCreate: sqlitePragmas },
			...timeout,
			...logOption,
		};
	}
	// a test connection: one connection, closed within the limit (the pool destroy still waits for a running query)
	const testPool = timeoutMs ? { min: 0, max: 1, destroyTimeoutMillis: timeoutMs } : null;
	const pool = testPool ? { pool: testPool } : {};
	const base = {
		host: connection.host,
		port: connection.port,
		user: connection.user,
		password: connection.password,
		database: connection.name,
	};
	if (connection.engine === "mysql") {
		const { ssl } = connection;
		return {
			client: "mysql2",
			connection: {
				...base,
				...(ssl?.enabled
					? { ssl: { rejectUnauthorized: ssl.reject_unauthorized, verifyIdentity: ssl.verify_identity } }
					: {}),
				...(timeoutMs ? { connectTimeout: timeoutMs } : {}),
				// dates as naive local time, the same zone the session uses (mysqlSessionZone)
				timezone: "local",
			},
			migrations: { tableName: "migrations" },
			pool: { ...testPool, afterCreate: mysqlSessionZone({ note }) },
			...timeout,
			...logOption,
		};
	}
	return {
		client: "pg",
		connection: {
			...base,
			...(connection.ssl?.enabled ? { ssl: true } : {}),
			...(timeoutMs
				? { connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, statement_timeout: timeoutMs }
				: {}),
		},
		migrations: { tableName: "migrations" },
		...pool,
		...timeout,
		...logOption,
	};
};

/**
 * The config of a database that cannot be used (an invalid database.json): knex and the models load, every connection
 * attempt throws the error, so the startup fails with its message and retries; there is no fallback to SQLite.
 *
 * @param   {Error}  error
 * @returns {Object}
 */
const failingKnexConfig = (error) => ({
	client: "better-sqlite3",
	useNullAsDefault: true,
	connection: () => {
		throw error;
	},
});

export { failingKnexConfig, knexConfigOf, mysqlSessionZone, processZone, resetZoneNote, utcOffsetOf };
