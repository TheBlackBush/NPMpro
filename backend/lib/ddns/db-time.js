import { isSqlite } from "../config.js";

// The three DDNS time columns (last_checked_on, last_changed_on, next_try_on). SQLite has no time type: a Date is
// stored as UTC text and read back as UTC. MySQL and Postgres drivers take and return a Date themselves.

const SQLITE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u;

/**
 * @param   {Date|string|number|null|undefined} value
 * @returns {Date|string|null}  what the column takes
 */
const toDbTime = (value) => {
	if (value === null || value === undefined) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (!isSqlite()) return date;
	return date.toISOString().replace("T", " ").slice(0, -1);
};

/**
 * @param   {Date|string|number|null|undefined} value  a column as the driver returns it
 * @returns {Date|null}
 */
const fromDbTime = (value) => {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value;
	if (typeof value === "number") return new Date(value);
	const text = String(value);
	return new Date(SQLITE_TIME.test(text) ? `${text.replace(" ", "T")}Z` : text);
};

export { fromDbTime, toDbTime };
