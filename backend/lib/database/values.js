import { isoToLocal, localToIso } from "../backup/rows.js";

// Values between engines for the database move. A row is read from the source, made portable (portableRow), written in
// the form the target takes (targetRow) and later compared by meaning (comparable). The time zone is the process zone
// (TZ), the app's convention for naive dates (lib/backup/rows.js).

const KIND_PATTERNS = [
	["json", /json/iu],
	["bool", /bool/iu],
	["date", /date|time/iu],
	["binary", /blob|binary|bytea/iu],
	["decimal", /decimal|numeric|real|float|double/iu],
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/u;
const DECIMAL_TEXT = /^(?<sign>[-+]?)(?<whole>\d+)(?:\.(?<fraction>\d*))?$/u;
const TRUE_VALUES = new Set([true, 1, "1", "t", "true"]);
// columns (or JSON keys) whose values never appear in a message
const SECRET_NAME = /secret|password|passwd|hash|token|credential|backup_code|private|key/iu;
const SEALED = /^v1:/u;
const LEADING_ZEROS = /^0+(?=\d)/u;
const TRAILING_ZEROS = /0+$/u;
const NON_ZERO = /[1-9]/u;
const SHOWN_LENGTH = 80;

const kindOfType = (type) => KIND_PATTERNS.find(([, pattern]) => pattern.test(String(type ?? "")))?.[0] ?? null;

/**
 * The kind of every source column on both sides
 *
 * @param   {Object}  sourceInfo  knex(table).columnInfo() of the source
 * @param   {Object}  targetInfo  the same on the target
 * @returns {Object<string, { source: string|null, target: string|null }>}
 */
const columnKinds = (sourceInfo, targetInfo) =>
	Object.fromEntries(
		Object.entries(sourceInfo).map(([column, info]) => [
			column,
			{ source: kindOfType(info?.type), target: kindOfType(targetInfo?.[column]?.type) },
		]),
	);

const isTrue = (value) => TRUE_VALUES.has(typeof value === "string" ? value.toLowerCase() : value);

const portableValue = (kind, value, sourceEngine) => {
	if (value === null || value === undefined) return null;
	if (Buffer.isBuffer(value)) return value;
	if (kind === "json") return sourceEngine === "sqlite" && typeof value === "string" ? value : JSON.stringify(value);
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

const parsedJson = (value, engine) => (engine === "sqlite" && typeof value === "string" ? JSON.parse(value) : value);

const canonicalJson = (value, engine) => {
	try {
		return `json:${sortedJson(parsedJson(value, engine))}`;
	} catch {
		return `text:${value}`;
	}
};

// a decimal number as text without a plus sign, leading zeros or trailing fraction zeros: 1.50 and 1.5 are the same
const canonicalDecimal = (value) => {
	const text = String(value).trim();
	const match = DECIMAL_TEXT.exec(text);
	if (!match) return text;
	const whole = match.groups.whole.replace(LEADING_ZEROS, "");
	const fraction = (match.groups.fraction ?? "").replace(TRAILING_ZEROS, "");
	const number = fraction ? `${whole}.${fraction}` : whole;
	return match.groups.sign === "-" && NON_ZERO.test(number) ? `-${number}` : number;
};

const epoch = (value) => {
	if (value instanceof Date) return value.getTime();
	const text = String(value);
	return Date.parse(ISO_DATE.test(text) ? text : localToIso(text));
};

/**
 * The meaning of a value, for comparing a source row with its copy
 *
 * @param   {string|null}  kind    the column kind (source ?? target)
 * @param   {*}            value   as the engine's driver returned it
 * @param   {string}       engine  sqlite, mysql or postgres
 * @returns {string|null}  null only for null
 */
const comparable = (kind, value, engine) => {
	if (value === null || value === undefined) return null;
	if (Buffer.isBuffer(value)) return `hex:${value.toString("hex")}`;
	if (kind === "bool") return isTrue(value) ? "1" : "0";
	if (kind === "json") return canonicalJson(value, engine);
	if (kind === "date") {
		const ms = epoch(value);
		return Number.isNaN(ms) ? `text:${value}` : `ms:${ms}`;
	}
	if (kind === "decimal") return canonicalDecimal(value);
	if (typeof value === "boolean") return value ? "1" : "0";
	return String(value);
};

const kindOf = (kinds, column) => kinds[column]?.source ?? kinds[column]?.target ?? null;

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
		const kind = kindOf(kinds, column);
		if (!Object.hasOwn(copiedRow, column)) return column;
		if (comparable(kind, sourceRow[column], sourceEngine) !== comparable(kind, copiedRow[column], targetEngine)) {
			return column;
		}
	}
	return null;
};

const holdsSecret = (value) => {
	if (Array.isArray(value)) return value.some(holdsSecret);
	if (value === null || typeof value !== "object") return typeof value === "string" && SEALED.test(value);
	return Object.entries(value).some(([key, item]) => SECRET_NAME.test(key) || holdsSecret(item));
};

const textOf = (value) => {
	if (value instanceof Date) return value.toISOString();
	return typeof value === "string" ? value : JSON.stringify(value);
};

// a value for a message: secrets and sealed values as <hidden>, long values shortened
const shown = (kind, column, value, engine) => {
	if (value === null || value === undefined) return "null";
	if (SECRET_NAME.test(column)) return "<hidden>";
	if (Buffer.isBuffer(value)) return `${value.length} bytes`;
	if (kind === "json") {
		let parsed;
		try {
			parsed = parsedJson(value, engine);
		} catch {
			parsed = value;
		}
		if (holdsSecret(parsed)) return "<hidden>";
	}
	const text = textOf(value);
	if (SEALED.test(text)) return "<hidden>";
	return JSON.stringify(text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH)}...` : text);
};

/**
 * A column's two values for a message, with secrets hidden
 *
 * @returns {string}  e.g. `name: "a" in use, "" in the target`
 */
const describeDifference = (kinds, column, sourceRow, copiedRow, sourceEngine, targetEngine) => {
	const kind = kindOf(kinds, column);
	const copied = Object.hasOwn(copiedRow, column) ? shown(kind, column, copiedRow[column], targetEngine) : "missing";
	return `${column}: ${shown(kind, column, sourceRow[column], sourceEngine)} in use, ${copied} in the target`;
};

export { columnKinds, comparable, describeDifference, firstDifference, kindOfType, portableRow, targetRow };
