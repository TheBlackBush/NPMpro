const CHUNK_BUCKETS = 500;
const CHUNK_INSERT = 200;

const chunks = (list, size) => {
	const out = [];
	for (let i = 0; i < list.length; i += size) {
		out.push(list.slice(i, i + size));
	}
	return out;
};

const keyOfColumns = (keys) => (row) => keys.map((c) => String(row[c])).join("|");

/** Rows with the same key merged: `adds` summed, `maxes` the larger value. */
const mergeBatch = (rows, keys, adds, maxes = []) => {
	const keyOf = keyOfColumns(keys);
	const merged = new Map();
	for (const row of rows) {
		const hit = merged.get(keyOf(row));
		if (hit) {
			for (const c of adds) hit[c] += row[c];
			for (const c of maxes) hit[c] = Math.max(hit[c], row[c]);
		} else {
			merged.set(keyOf(row), { ...row });
		}
	}
	return [...merged.values()];
};

/**
 * Adds the counters to the stored rows with the same unique key and inserts the rest: one select per bucket chunk,
 * chunked inserts for new rows, one update per existing row (`col = col + ?`). Portable across SQLite, MySQL and
 * Postgres; the caller runs it in a transaction and is the only writer of the table. Used by the tables that existed
 * before missing pages; new tables use mergeRows.
 *
 * @param   {Object}    trx
 * @param   {{table: string, keys: string[], adds: string[]}}  spec  keys: the unique index columns
 * @param   {Object[]}  [rows]
 */
const upsertRows = async (trx, { table, keys, adds }, rows = []) => {
	const keyOf = keyOfColumns(keys);
	const merged = mergeBatch(rows, keys, adds);
	if (merged.length === 0) {
		return;
	}
	const existing = new Map();
	const buckets = [...new Set(merged.map((r) => r.bucket))];
	for (const part of chunks(buckets, CHUNK_BUCKETS)) {
		for (const found of await trx(table)
			.whereIn("bucket", part)
			.select("id", ...keys)) {
			existing.set(keyOf(found), found.id);
		}
	}
	const fresh = [];
	for (const row of merged) {
		const id = existing.get(keyOf(row));
		if (id === undefined) {
			fresh.push(row);
			continue;
		}
		const patch = {};
		for (const c of adds) patch[c] = trx.raw("?? + ?", [c, row[c]]);
		await trx(table).where({ id }).update(patch);
	}
	for (const part of chunks(fresh, CHUNK_INSERT)) {
		await trx(table).insert(part);
	}
};

/**
 * Set-based upsert for a table with a unique index on `keys`: the batch is merged first, then chunks of 200 rows go
 * in with `insert ... on conflict (keys) do update` (SQLite, Postgres) or `on duplicate key update` (MySQL, MariaDB).
 * `adds` are summed, `maxes` keep the larger value. No select and no update per row, so a flush holds the connection
 * for ceil(rows / 200) statements.
 *
 * @param   {Object}    trx
 * @param   {{table: string, keys: string[], adds: string[], maxes?: string[]}}  spec
 * @param   {Object[]}  [rows]
 */
const mergeRows = async (trx, { table, keys, adds, maxes = [] }, rows = []) => {
	const merged = mergeBatch(rows, keys, adds, maxes);
	if (merged.length === 0) {
		return;
	}
	const client = trx.client.config.client;
	const mysql = client === "mysql" || client === "mysql2";
	// the value of the row that conflicted, and the stored one
	const incoming = (c) => (mysql ? trx.raw("values(??)", [c]) : trx.raw("excluded.??", [c]));
	const stored = (c) => trx.raw("??", [mysql ? c : `${table}.${c}`]);
	const patch = {};
	for (const c of adds) patch[c] = trx.raw("? + ?", [stored(c), incoming(c)]);
	for (const c of maxes) {
		patch[c] = trx.raw("case when ? < ? then ? else ? end", [stored(c), incoming(c), incoming(c), stored(c)]);
	}
	for (const part of chunks(merged, CHUNK_INSERT)) {
		await trx(table).insert(part).onConflict(keys).merge(patch);
	}
};

export { CHUNK_INSERT, chunks, mergeRows, upsertRows };
