import { isoToLocal } from "../backup/rows.js";
import { engineOf } from "../database/engine.js";

// The times of the notification tables, in the convention of the rest of the database: SQLite has no time type and
// keeps naive local time (TZ) as YYYY-MM-DD HH:mm:ss, as models/now_helper.js (datetime('now','localtime')) and the
// certificate dates write it; MySQL keeps a DATETIME that mysql2 (timezone "local") and the session zone read and write
// as local time; Postgres keeps a timestamptz. The MySQL and Postgres drivers take a Date. The database move and the
// backups read naive text as local time too (lib/backup/rows.js), so a stored time keeps its instant everywhere.

const ZONED = /(?:Z|[+-]\d\d:?\d\d)$/u;

/**
 * @param   {Object}  knex
 * @returns {Function}  (ms) => the value a time column of that database takes (whole seconds on SQLite)
 */
const dbTimeOf = (knex) => {
	const sqlite = engineOf(knex) === "sqlite";
	return (ms) => (sqlite ? isoToLocal(new Date(ms).toISOString()) : new Date(ms));
};

/**
 * A time column as the driver returns it, in epoch ms: a Date, or text without a zone read as local time
 *
 * @param   {Date|String|Number|null|undefined}  value
 * @returns {Number}  NaN when it is not a time
 */
const msOfDbTime = (value) => {
	if (value === null || value === undefined) return Number.NaN;
	if (value instanceof Date) return value.getTime();
	if (typeof value === "number") return value;
	const text = String(value).trim();
	return Date.parse(ZONED.test(text) ? text : text.replace(" ", "T"));
};

export { dbTimeOf, msOfDbTime };
