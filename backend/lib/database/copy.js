import errs from "../error.js";
import { engineOf, rawRows } from "./engine.js";
import { describeDifference, firstDifference, isSecretColumn, portableRow, targetRow } from "./values.js";

// The data side of a database move: copy a table in pages, set the id sequences past the copied ids, verify.
// Pages are read with limit and offset, ordered by the table's key: the database in use is frozen while this runs
// (maintenance refuses writes and the background writers are paused), so the offsets cannot shift between pages and
// no keyset paging (which would need comparable key values across engines and collations) is needed.

const BATCH_SIZE = 500;
const VERIFY_ROWS = 50;
// bound values per insert statement, below SQLite's 32766 (Postgres allows 65535, MySQL more)
const MAX_BINDINGS = 30_000;
// rows per insert statement on SQLite: knex writes a multi-row insert there as one compound SELECT
// (select ... union all select ...), and SQLite allows at most 500 terms in one
const SQLITE_MAX_ROWS = 500;
// row values shorter than this are not removed from a driver message (they would cut words, not hide anything)
const MIN_REDACTED = 3;

const verifyError = (message, details = null) => new errs.DatabaseMoveError("verify", message, { details });

// Integers above 2^53 must not be rounded on the read: SQLite returns them as BigInt (safe integers), MySQL as strings
// (big numbers); Postgres returns bigint as a string already. Every engine gets one branch.
const readOptions = (knex) => {
	switch (engineOf(knex)) {
		case "sqlite":
			return { safeIntegers: true };
		case "postgres":
			return {};
		default:
			return { supportBigNumbers: true };
	}
};

const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
// a BigInt as a number when that is exact, else as its decimal text (what Postgres and MySQL give for big numbers)
const fromBigInt = (value) => {
	if (typeof value !== "bigint") return value;
	return value >= SAFE_MIN && value <= SAFE_MAX ? Number(value) : value.toString();
};
const exactRow = (row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, fromBigInt(value)]));

// the rows of a query, with exact integers
const readRows = async (knex, query) => (await query.options(readOptions(knex))).map(exactRow);

const countRows = async (knex, table) => {
	const [{ count }] = await knex(table).count({ count: "*" });
	return Number(count);
};

// a row's key for a message; a key column named like a secret is hidden
const keyText = (key, row) =>
	key.map((column) => `${column}=${isSecretColumn(column) ? "<hidden>" : String(row[column])}`).join(", ");

// The driver's own message without the statement knex puts in front of it (with the bound values) and without any of
// the rows' values, so a refused secret never reaches the error output.
const driverMessage = (error, rows) => {
	const full = String(error?.message ?? error);
	let message = full.includes(" - ") ? full.slice(full.lastIndexOf(" - ") + 3) : full;
	for (const row of rows) {
		for (const value of Object.values(row ?? {})) {
			if (value === null || value === undefined || Buffer.isBuffer(value)) continue;
			const text = typeof value === "string" ? value : String(value);
			if (text.length >= MIN_REDACTED) message = message.split(text).join("<hidden>");
		}
	}
	return message;
};

const refused = (table, key, row, error) =>
	new errs.DatabaseMoveError("copy", `${table}: the target refused the row ${keyText(key, row)}`, {
		details: driverMessage(error, [row]),
	});

// the copy itself failed (the connection, the server): no row is to blame
const copyFailed = (table, rows, error) =>
	new errs.DatabaseMoveError("copy", `${table}: the copy failed`, {
		details: driverMessage(error, rows),
	});

// MySQL errors for a value or a row the table does not take (null, range, truncation, date, string, length, JSON)
const MYSQL_ROW_ERRORS = new Set([1048, 1062, 1264, 1265, 1292, 1366, 1406, 1452, 3140]);
const SQLITE_ROW_ERROR = /^SQLITE_(?:CONSTRAINT|MISMATCH|TOOBIG|RANGE)/u;
// SQLSTATE classes 22 (data exception) and 23 (integrity constraint violation)
const DATA_STATE = /^2[23]/u;

// True when the target refused the data (a constraint or a value of the wrong type), false for anything else, such
// as a lost connection, a timeout or a full disk. Every engine gets one branch.
const isRowRefusal = (target, error) => {
	switch (engineOf(target)) {
		case "sqlite":
			return SQLITE_ROW_ERROR.test(String(error?.code ?? ""));
		case "postgres":
			return DATA_STATE.test(String(error?.code ?? ""));
		default:
			return MYSQL_ROW_ERRORS.has(error?.errno) || DATA_STATE.test(String(error?.sqlState ?? ""));
	}
};

// the source row a target row was made from (for messages); a symbol, so knex does not insert it
const SOURCE = Symbol("source");

// Inserts the rows in statements within the binding limit (and SQLite's 500 rows). A statement the target refuses is
// retried row by row (each in a savepoint, so a Postgres transaction stays usable) to name the row it refuses.
const insertRows = async (trx, table, key, rows) => {
	const columns = Math.max(1, Object.keys(rows[0]).length);
	let size = Math.max(1, Math.floor(MAX_BINDINGS / columns));
	if (engineOf(trx) === "sqlite") size = Math.min(size, SQLITE_MAX_ROWS);
	for (let start = 0; start < rows.length; start += size) {
		const chunk = rows.slice(start, start + size);
		try {
			await trx.transaction((savepoint) => savepoint(table).insert(chunk));
		} catch (error) {
			if (!isRowRefusal(trx, error))
				throw copyFailed(
					table,
					chunk.map((row) => row[SOURCE]),
					error,
				);
			// a refused statement: insert its rows one by one to find (and name) the row the target refuses
			for (const row of chunk) {
				try {
					await trx.transaction((savepoint) => savepoint(table).insert(row));
				} catch (rowError) {
					if (!isRowRefusal(trx, rowError)) throw copyFailed(table, [row[SOURCE]], rowError);
					throw refused(table, key, row[SOURCE], rowError);
				}
			}
		}
	}
};

/**
 * Copies every row of a table, in one target transaction, in pages ordered by the key
 *
 * @param   {Object}    options
 * @param   {Object}    options.source     knex of the database in use (frozen)
 * @param   {Object}    options.target     knex of the target
 * @param   {string}    options.table
 * @param   {string[]}  options.key        keyColumns() of the table
 * @param   {Object}    options.kinds      columnKinds() of the table
 * @param   {number}    [options.batchSize]
 * @param   {Function}  [options.onRows]   called with the rows copied so far after every page
 * @returns {Promise<number>}  the rows copied
 */
const copyTable = async ({ source, target, table, key, kinds, batchSize = BATCH_SIZE, onRows = () => {} }) => {
	const sourceEngine = engineOf(source);
	const targetEngine = engineOf(target);
	let copied = 0;
	const copyPages = async (trx) => {
		for (;;) {
			const rows = await readRows(source, source(table).select("*").orderBy(key).limit(batchSize).offset(copied));
			if (rows.length === 0) break;
			await insertRows(
				trx,
				table,
				key,
				rows.map((row) => {
					const converted = targetRow(kinds, portableRow(kinds, row, sourceEngine), targetEngine);
					Object.defineProperty(converted, SOURCE, { value: row });
					return converted;
				}),
			);
			copied += rows.length;
			onRows(copied);
			if (rows.length < batchSize) break;
		}
	};
	// the error thrown inside the transaction: a failed rollback (the connection is gone) must not replace it
	let failure = null;
	try {
		await target.transaction(async (trx) => {
			try {
				await copyPages(trx);
			} catch (error) {
				failure = error;
				throw error;
			}
		});
	} catch (error) {
		const cause = failure ?? error;
		throw cause instanceof errs.DatabaseMoveError ? cause : copyFailed(table, [], cause);
	}
	return copied;
};

// the highest id of a table as a BigInt (ids above 2^53 stay exact)
const maxId = async (knex, table) => {
	const [row] = await readRows(knex, knex(table).max({ max: "id" }));
	return BigInt(String(row?.max ?? 0));
};

const bigOf = (value) => BigInt(String(value ?? 0));
const AUTOINCREMENT = /\bautoincrement\b/iu;
const AUTO_INCREMENT_OPTION = /\bAUTO_INCREMENT=(?<next>\d+)/u;
const AUTO_INCREMENT_EXTRA = /auto_increment/iu;

// the Postgres sequence of a table's id, or null
const pgSequence = async (knex, table) =>
	rawRows(knex, await knex.raw("select pg_get_serial_sequence(?, 'id') as seq", [`"${table}"`]))[0]?.seq ?? null;

// true when the SQLite table keeps an id counter (AUTOINCREMENT, in sqlite_sequence)
const sqliteAutoincrement = async (knex, table) => {
	const [row] = rawRows(
		knex,
		await knex.raw("select sql from sqlite_master where type = 'table' and name = ?", [table]),
	);
	return AUTOINCREMENT.test(String(row?.sql ?? ""));
};

// true when the MySQL table's id is auto-increment
const mysqlAutoincrement = async (knex, table) =>
	rawRows(
		knex,
		await knex.raw(
			"select extra from information_schema.columns where table_schema = database() and table_name = ? and column_name = 'id'",
			[table],
		),
	).some((row) => AUTO_INCREMENT_EXTRA.test(String(row.extra ?? row.EXTRA ?? "")));

/**
 * The last id the table's counter handed out (0 when it has none or never ran). Ids of deleted rows count: they must
 * not be handed out again after the move. SQLite: sqlite_sequence (AUTOINCREMENT tables; others have no counter beyond
 * the highest rowid). Postgres: the sequence's last value once called. MySQL: AUTO_INCREMENT - 1, read from SHOW CREATE
 * TABLE (information_schema caches it on MySQL 8).
 */
const idCounter = async (knex, table) => {
	switch (engineOf(knex)) {
		case "sqlite": {
			if (!(await sqliteAutoincrement(knex, table))) return 0n;
			const rows = await readRows(knex, knex("sqlite_sequence").where("name", table).select("seq"));
			return bigOf(rows[0]?.seq);
		}
		case "postgres": {
			const seq = await pgSequence(knex, table);
			if (!seq) return 0n;
			const [row] = rawRows(
				knex,
				await knex.raw(
					`select s.last_value from pg_sequences s
					join pg_namespace n on n.nspname = s.schemaname
					join pg_class c on c.relnamespace = n.oid and c.relname = s.sequencename
					where c.oid = ?::regclass`,
					[seq],
				),
			);
			return bigOf(row?.last_value);
		}
		default: {
			if (!(await mysqlAutoincrement(knex, table))) return 0n;
			const [row] = rawRows(knex, await knex.raw("show create table ??", [table]));
			const option = AUTO_INCREMENT_OPTION.exec(String(row?.["Create Table"] ?? ""));
			return option ? BigInt(option.groups.next) - 1n : 0n;
		}
	}
};

// true when the table's id has a counter (an integer id handed out by the database)
const hasCounter = async (knex, table) => {
	switch (engineOf(knex)) {
		case "sqlite":
			return await sqliteAutoincrement(knex, table);
		case "postgres":
			return (await pgSequence(knex, table)) !== null;
		default:
			return await mysqlAutoincrement(knex, table);
	}
};

// sets the target's counter (hasCounter) so the next insert without an id gets next
const setCounter = async (target, table, next) => {
	switch (engineOf(target)) {
		case "sqlite":
			await target("sqlite_sequence").where("name", table).delete();
			// a BigInt binding: sqlite_sequence.seq has no type, a text value would stay text
			await target("sqlite_sequence").insert({ name: table, seq: next - 1n });
			return;
		case "postgres":
			await target.raw("select setval(?::regclass, ?::bigint, false)", [
				await pgSequence(target, table),
				next.toString(),
			]);
			return;
		default:
			// a BigInt's decimal text, never user input
			await target.raw(`alter table ?? auto_increment = ${next.toString()}`, [table]);
	}
};

/**
 * Sets every id counter of the target (SQLite sqlite_sequence, Postgres sequence, MySQL auto-increment) so the next
 * insert without an id gets max(the source's counter, the highest copied id) + 1: ids of rows deleted in the database
 * in use are never handed out again (old audit rows would attach to new objects).
 *
 * @param   {Object}    source  knex of the database in use
 * @param   {Object}    target  knex of the target
 * @param   {string[]}  tables
 */
const resetSequences = async (source, target, tables) => {
	for (const table of tables) {
		const columns = await target(table).columnInfo();
		if (!(columns.id && (await hasCounter(target, table)))) continue;
		const counter = await idCounter(source, table);
		let last = await maxId(target, table);
		// BigInts: Math.max does not take them
		if (counter > last) last = counter;
		await setCounter(target, table, last + 1n);
	}
};

// a where clause on the key; null keys (a table without a primary key) match with is null
const whereKey = (query, key, row) => {
	for (const column of key) {
		if (row[column] === null || row[column] === undefined) query.whereNull(column);
		else query.where(column, row[column]);
	}
	return query;
};

/**
 * Same row count, and the first and last rows (by the source's key order) equal by meaning. Rows are matched by
 * their key, never by position: text keys sort differently per engine and collation. The key values are looked up in
 * the form the copy wrote them (targetRow), so booleans and dates in a key match on every engine.
 *
 * @param   {Object}    options
 * @param   {Object}    options.source
 * @param   {Object}    options.target
 * @param   {string}    options.table
 * @param   {string[]}  options.key
 * @param   {Object}    options.kinds
 * @param   {number}    [options.rows]  rows from each end
 * @returns {Promise<{ count: number }>}
 */
const verifyTable = async ({ source, target, table, key, kinds, rows = VERIFY_ROWS }) => {
	const sourceEngine = engineOf(source);
	const targetEngine = engineOf(target);
	const count = await countRows(source, table);
	const copied = await countRows(target, table);
	if (count !== copied) {
		throw verifyError(`${table}: ${count} rows in the database in use, ${copied} rows in the target`);
	}
	const first = await readRows(source, source(table).select("*").orderBy(key).limit(rows));
	const last = await readRows(
		source,
		source(table)
			.select("*")
			.orderBy(key.map((column) => ({ column, order: "desc" })))
			.limit(rows),
	);
	const seen = new Set();
	for (const row of [...first, ...last]) {
		const text = keyText(key, row);
		if (seen.has(text)) continue;
		seen.add(text);
		const written = targetRow(kinds, portableRow(kinds, row, sourceEngine), targetEngine);
		const [match] = await readRows(target, whereKey(target(table).select("*"), key, written).limit(1));
		if (!match) throw verifyError(`${table}: the row ${text} is missing in the target`);
		const column = firstDifference(kinds, row, match, sourceEngine, targetEngine);
		if (column) {
			throw verifyError(
				`${table}: ${column} of the row ${text} differs in the target`,
				describeDifference(column, row, match),
			);
		}
	}
	return { count };
};

export { BATCH_SIZE, copyTable, countRows, resetSequences, VERIFY_ROWS, verifyTable };
