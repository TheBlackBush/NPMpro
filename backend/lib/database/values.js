import { isoToLocal, JSON_COLUMNS, localToIso } from "../backup/rows.js";

// Values between engines for the database move. A row is read from the source, made portable (portableRow), written in
// the form the target takes (targetRow) and later compared by meaning (comparable). The time zone is the process zone
// (TZ), the app's convention for naive dates (lib/backup/rows.js).

const KIND_PATTERNS = [
	["json", /json/iu],
	["bool", /bool/iu],
	["date", /date|time/iu],
	["binary", /blob|binary|bytea/iu],
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/u;
const TRUE_VALUES = new Set([true, 1, "1", "t", "true"]);
const FALSE_VALUES = new Set([false, 0, "0", "f", "false"]);
// columns (or JSON keys) whose values never appear in a message
const SECRET_NAME = /secret|password|passwd|hash|token|credential|passphrase|backup_code|private|key/iu;
const SEALED = /^v1:/u;
const JSON_LIKE = /^\s*[[{"]/u;
const SHOWN_LENGTH = 80;

const kindOfType = (type) => KIND_PATTERNS.find(([, pattern]) => pattern.test(String(type ?? "")))?.[0] ?? null;

// Kinds: json (a json type: Postgres and MySQL 8 return it parsed, SQLite as text), jsontext (a JSON column of the
// app stored as text, e.g. on MariaDB where json is LONGTEXT: the driver returns the text), bool, date, binary.
// An app JSON column (JSON_COLUMNS) is JSON on both sides whatever type the engine reports.
const kindOfColumn = (type, appJson) => {
	const kind = kindOfType(type);
	return appJson && kind !== "json" ? "jsontext" : kind;
};

/**
 * The kind of every source column on both sides
 *
 * @param   {Object}  sourceInfo  knex(table).columnInfo() of the source
 * @param   {Object}  targetInfo  the same on the target
 * @param   {string}  [table]     the table name, for the app's JSON columns (JSON_COLUMNS)
 * @returns {Object<string, { source: string|null, target: string|null }>}
 */
const columnKinds = (sourceInfo, targetInfo, table) => {
	const appJson = JSON_COLUMNS[table] ?? [];
	return Object.fromEntries(
		Object.entries(sourceInfo).map(([column, info]) => [
			column,
			{
				source: kindOfColumn(info?.type, appJson.includes(column)),
				target: kindOfColumn(targetInfo?.[column]?.type, appJson.includes(column)),
			},
		]),
	);
};

const isJsonKind = (kind) => kind === "json" || kind === "jsontext";

// a string from a JSON column is JSON text unless the driver parsed it (a json type on MySQL 8 or Postgres)
const isJsonText = (kind, value, engine) => typeof value === "string" && (kind === "jsontext" || engine === "sqlite");

const isTrue = (value) => TRUE_VALUES.has(typeof value === "string" ? value.toLowerCase() : value);

const portableValue = (kind, value, sourceEngine) => {
	if (value === null || value === undefined) return null;
	if (Buffer.isBuffer(value)) return value;
	if (isJsonKind(kind)) return isJsonText(kind, value, sourceEngine) ? value : JSON.stringify(value);
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "bigint") return value.toString();
	return value;
};

/**
 * A row read from the source in a form every target can take
 *
 * @param   {Object}  kinds         columnKinds()
 * @param   {Object}  row           a row as the source driver returned it
 * @param   {string}  sourceEngine  sqlite, mysql or postgres
 * @returns {Object}  Dates as ISO, JSON columns as JSON text, bigints as strings, Buffers and nulls kept
 */
const portableRow = (kinds, row, sourceEngine) =>
	Object.fromEntries(
		Object.entries(row).map(([column, value]) => [
			column,
			portableValue(kinds[column]?.source, value, sourceEngine),
		]),
	);

const targetValue = (kind, value, targetEngine) => {
	if (value === null || value === undefined) return null;
	if (Buffer.isBuffer(value)) return value;
	if (kind === "bool" || typeof value === "boolean") {
		if (targetEngine === "postgres" && kind === "bool") return isTrue(value);
		return isTrue(value) ? 1 : 0;
	}
	if (kind === "date" && typeof value === "string") {
		if (targetEngine === "postgres") return ISO_DATE.test(value) ? value : localToIso(value);
		return ISO_DATE.test(value) ? isoToLocal(value) : value;
	}
	return value;
};

/**
 * A portable row as the target engine takes it
 *
 * @param   {Object}  kinds         columnKinds()
 * @param   {Object}  row           portableRow()
 * @param   {string}  targetEngine  sqlite, mysql or postgres
 * @returns {Object}
 */
const targetRow = (kinds, row, targetEngine) =>
	Object.fromEntries(
		Object.entries(row).map(([column, value]) => [column, targetValue(kinds[column]?.target, value, targetEngine)]),
	);

// JSON with object keys sorted at every level: MySQL and Postgres jsonb store keys in their own order
const sortedJson = (value) => {
	if (Array.isArray(value)) return `[${value.map((item) => sortedJson(item ?? null)).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort((a, b) => (a < b ? -1 : Number(a > b)))
			.map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value);
};

const canonicalJson = (kind, value, engine) => {
	try {
		return `json:${sortedJson(isJsonText(kind, value, engine) ? JSON.parse(value) : value)}`;
	} catch {
		return `text:${value}`;
	}
};

// Dates: NPMpro stores whole seconds, so a date compares as epoch milliseconds floored to the second, and the copy to
// SQLite and MySQL (isoToLocal) drops sub-second parts the same way. Naive YYYY-MM-DD HH:MM:SS text is process-local
// time. Other text in a date column (ISO without a zone, epoch milliseconds as a number in SQLite) is never written by
// the app: it does not convert like a date, so it shows up as a difference in the verification instead of passing.
const SECOND = 1000;
const epoch = (value) => {
	if (value instanceof Date) return value.getTime();
	const text = String(value);
	return Date.parse(ISO_DATE.test(text) ? text : localToIso(text));
};
const epochSeconds = (value) => Math.floor(epoch(value) / SECOND) * SECOND;

// 1 or 0; anything else is not a boolean and only equals the same text
const boolMeaning = (value) => {
	const normal = typeof value === "string" ? value.toLowerCase() : value;
	if (TRUE_VALUES.has(normal)) return "1";
	return FALSE_VALUES.has(normal) ? "0" : `text:${value}`;
};

/**
 * The meaning of a value, for comparing a source row with its copy
 *
 * @param   {string|null}  kind    the column kind on that value's side (sideKinds)
 * @param   {*}            value   as the engine's driver returned it
 * @param   {string}       engine  sqlite, mysql or postgres
 * @returns {string|null}  null only for null
 */
const comparable = (kind, value, engine) => {
	if (value === null || value === undefined) return null;
	if (Buffer.isBuffer(value)) return `hex:${value.toString("hex")}`;
	if (kind === "bool") return boolMeaning(value);
	if (isJsonKind(kind)) return canonicalJson(kind, value, engine);
	if (kind === "date") {
		const ms = epochSeconds(value);
		return Number.isNaN(ms) ? `text:${value}` : `ms:${ms}`;
	}
	if (typeof value === "boolean") return value ? "1" : "0";
	return String(value);
};

// the kind each side's value is read with: its own, else bool or date from the other side (a MySQL tinyint against a
// boolean), else JSON text when the other side is a JSON column (a text column holding the JSON)
const fallbackKind = (own, other) => {
	if (own) return own;
	if (other === "bool" || other === "date") return other;
	return isJsonKind(other) ? "jsontext" : null;
};
const sideKinds = (kinds, column) => {
	const { source = null, target = null } = kinds[column] ?? {};
	return { source: fallbackKind(source, target), target: fallbackKind(target, source) };
};

/**
 * The first column whose meaning differs between a source row and its copy, or null
 *
 * @param   {Object}  kinds         columnKinds()
 * @param   {Object}  sourceRow     as the source driver returned it
 * @param   {Object}  copiedRow     the same row read back from the target
 * @param   {string}  sourceEngine
 * @param   {string}  targetEngine
 * @returns {string|null}
 */
const firstDifference = (kinds, sourceRow, copiedRow, sourceEngine, targetEngine) => {
	for (const column of Object.keys(sourceRow)) {
		if (!Object.hasOwn(copiedRow, column)) return column;
		const { source, target } = sideKinds(kinds, column);
		if (
			comparable(source, sourceRow[column], sourceEngine) !== comparable(target, copiedRow[column], targetEngine)
		) {
			return column;
		}
	}
	return null;
};

// a column whose values never appear in a message
const isSecretColumn = (column) => SECRET_NAME.test(String(column));

const holdsSecret = (value) => {
	if (Array.isArray(value)) return value.some(holdsSecret);
	if (value === null || typeof value !== "object") return typeof value === "string" && SEALED.test(value);
	return Object.entries(value).some(([key, item]) => SECRET_NAME.test(key) || holdsSecret(item));
};

const textOf = (value) => {
	if (value instanceof Date) return value.toISOString();
	return typeof value === "string" ? value : JSON.stringify(value);
};

// a string that looks like JSON text, parsed; anything else as it is
const parsedIfJson = (value) => {
	if (typeof value !== "string" || !JSON_LIKE.test(value)) return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

// a value for a message: secret columns, sealed values and JSON holding a secret as <hidden>, long values shortened
const shown = (column, value) => {
	if (value === null || value === undefined) return "null";
	if (isSecretColumn(column)) return "<hidden>";
	if (Buffer.isBuffer(value)) return `${value.length} bytes`;
	if (holdsSecret(parsedIfJson(value))) return "<hidden>";
	const text = textOf(value);
	// text that names a secret but does not parse (for example cut JSON) is hidden too
	if (SECRET_NAME.test(text)) return "<hidden>";
	return JSON.stringify(text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH)}...` : text);
};

/**
 * A column's two values for a message, with secrets hidden
 *
 * @returns {string}  e.g. `name: "a" in use, "" in the target`
 */
const describeDifference = (column, sourceRow, copiedRow) => {
	const copied = Object.hasOwn(copiedRow, column) ? shown(column, copiedRow[column]) : "missing";
	return `${column}: ${shown(column, sourceRow[column])} in use, ${copied} in the target`;
};

export {
	columnKinds,
	comparable,
	describeDifference,
	firstDifference,
	isSecretColumn,
	kindOfType,
	portableRow,
	targetRow,
};
