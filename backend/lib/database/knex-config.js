// the pragmas every SQLite connection gets (moved from lib/config.js)
const sqlitePragmas = (conn, done) => {
	conn.pragma("synchronous = NORMAL");
	// deleted rows (old secrets) are overwritten, not left in free pages
	conn.pragma("secure_delete = FAST");
	conn.pragma("temp_store = MEMORY");
	conn.pragma("optimize = 0x10002");
	done(null, conn);
};

/**
 * The knex config of a connection
 *
 * @param   {Object}  connection           { engine: "sqlite", file } or { engine, host, port, user, name, password, ssl }
 * @param   {Object}  [options]
 * @param   {number}  [options.timeoutMs]  connect and pool acquire timeout (the move's target test)
 * @returns {Object}
 */
const knexConfigOf = (connection, { timeoutMs } = {}) => {
	const timeout = timeoutMs ? { acquireConnectionTimeout: timeoutMs } : {};
	if (connection.engine === "sqlite") {
		return {
			client: "better-sqlite3",
			connection: { filename: connection.file },
			useNullAsDefault: true,
			pool: { afterCreate: sqlitePragmas },
			...timeout,
		};
	}
	// a test connection: one connection, closed within the limit (the pool destroy still waits for a running query)
	const pool = timeoutMs ? { pool: { min: 0, max: 1, destroyTimeoutMillis: timeoutMs } } : {};
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
			},
			migrations: { tableName: "migrations" },
			...pool,
			...timeout,
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

export { failingKnexConfig, knexConfigOf };
