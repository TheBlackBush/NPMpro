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
// the row's values, so a refused secret never reaches the error output.
const driverMessage = (error, row) => {
	const full = String(error?.message ?? error);
	let message = full.includes(" - ") ? full.slice(full.lastIndexOf(" - ") + 3) : full;
	for (const value of Object.values(row)) {
		if (value === null || value === undefined || Buffer.isBuffer(value)) continue;
		const text = typeof value === "string" ? value : String(value);
		if (text.length >= MIN_REDACTED) message = message.split(text).join("<hidden>");
	}
	return message;
};

const refused = (table, key, row, error) =>
	new errs.DatabaseMoveError("copy", `${table}: the target refused the row ${keyText(key, row)}`, {
		details: driverMessage(error, row),
	});

// the source row a target row was made from (for messages); a symbol, so knex does not insert it
const SOURCE = Symbol("source");

// Inserts the rows in statements within the binding limit. A statement the target refuses is retried row by row
// (each in a savepoint, so a Postgres transaction stays usable) to name the row it refuses.
const insertRows = async (trx, table, key, rows) => {
	const columns = Math.max(1, Object.keys(rows[0]).length);
	const size = Math.max(1, Math.floor(MAX_BINDINGS / columns));
	for (let start = 0; start < rows.length; start += size) {
		const chunk = rows.slice(start, start + size);
		try {
			await trx.transaction((savepoint) => savepoint(table).insert(chunk));
		} catch {
			for (const row of chunk) {
				try {
					await trx.transaction((savepoint) => savepoint(table).insert(row));
				} catch (error) {
					throw refused(table, key, row[SOURCE], error);
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
	await target.transaction(async (trx) => {
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
	});
	return copied;
};

// the highest id of a table as a BigInt (ids above 2^53 stay exact)
const maxId = async (knex, table) => {
	const [row] = await readRows(knex, knex(table).max({ max: "id" }));
	return BigInt(String(row?.max ?? 0));
};

/**
 * Moves every id sequence (Postgres) or auto-increment (MySQL) past the highest copied id, so the next insert without
 * an id gets max id + 1. SQLite needs nothing: an insert with an explicit id moves sqlite_sequence (AUTOINCREMENT) or
 * the next rowid (max + 1) by itself.
 *
 * @param   {Object}    target  knex of the target
 * @param   {string[]}  tables
 */
const resetSequences = async (target, tables) => {
	const engine = engineOf(target);
	if (engine === "sqlite") return;
	for (const table of tables) {
		const columns = await target(table).columnInfo();
		if (!columns.id) continue;
		switch (engine) {
			case "postgres": {
				const [row] = rawRows(
					target,
					await target.raw("select pg_get_serial_sequence(?, 'id') as seq", [`"${table}"`]),
				);
				if (!row?.seq) break;
				const next = (await maxId(target, table)) + 1n;
				await target.raw("select setval(?::regclass, ?::bigint, false)", [row.seq, next.toString()]);
				break;
			}
			default: {
				const [row] = rawRows(
					target,
					await target.raw(
						"select auto_increment as next_id from information_schema.tables where table_schema = database() and table_name = ?",
						[table],
					),
				);
				if (row?.next_id === null || row?.next_id === undefined) break;
				const next = (await maxId(target, table)) + 1n;
				// a BigInt's decimal text, never user input
				await target.raw(`alter table ?? auto_increment = ${next.toString()}`, [table]);
			}
		}
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
