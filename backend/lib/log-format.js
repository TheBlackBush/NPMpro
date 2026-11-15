/**
 * The one field list of every writer and reader of the access and stream logs: nginx.conf (`alog`, `slog`), the
 * traffic statistics, GoAccess and the CrowdSec hub parser `TheBlackBush/npmpro-logs`. The classic format only grows
 * at the end: no existing field is removed, reordered or changed.
 */

/** @typedef {{name: string, variable: string, classic: "bracket" | "plain" | "quoted"}} LogField */

const field = (name, classic = "plain", variable = `$${name}`) => ({ classic, name, variable });

const WRAP = {
	bracket: (text) => `[${text}]`,
	plain: (text) => text,
	quoted: (text) => `"${text}"`,
};

const PATTERNS = {
	bracket: String.raw`\[([^\]]*)\]`,
	plain: String.raw`(\S*)`,
	quoted: String.raw`"((?:[^"\\]|\\.)*)"`,
};

const regexes = new WeakMap();

const regexOf = (fields) => {
	let regex = regexes.get(fields);
	if (!regex) {
		regex = new RegExp(`^${fields.map((item) => PATTERNS[item.classic]).join(" ")}$`, "u");
		regexes.set(fields, regex);
	}
	return regex;
};

/** @type {LogField[]} */
export const ACCESS_FIELDS = [
	field("time_local", "bracket"),
	field("host", "plain", "$host$is_request_port$request_port"),
	field("remote_addr"),
	field("request_time"),
	field("request", "quoted"),
	field("status"),
	field("bytes_sent"),
	field("http_referer", "quoted"),
	field("http_user_agent", "quoted"),
	field("remote_user", "quoted"),
	field("sent_http_content_type", "quoted"),
	field("ssl_protocol"),
	field("ssl_cipher"),
	field("ssl_curve"),
	field("upstream_cache_status"),
	field("server_port"),
	field("server_name", "quoted"),
	field("host_id", "plain", "$npmpro_host_id"),
	field("request_id"),
	field("connection"),
	field("upstream_status", "quoted"),
	field("upstream_response_time", "quoted"),
];

/** @type {LogField[]} */
export const STREAM_FIELDS = [
	field("time_local", "bracket"),
	field("server_port"),
	field("remote_addr"),
	field("protocol"),
	field("ssl_preread_protocol"),
	field("status"),
	field("bytes_sent"),
	field("bytes_received"),
	field("session_time"),
	field("stream_id", "plain", "$npmpro_stream_id"),
];

/**
 * The text of a nginx `log_format` for a field list.
 * @param {LogField[]} fields
 * @returns {string}
 */
export const renderClassic = (fields) => fields.map((item) => WRAP[item.classic](item.variable)).join(" ");

/**
 * Splits a classic log line into its fields, or null when the whole line does not match.
 * @param {string} line
 * @param {LogField[]} fields
 * @returns {Object<string, string> | null}
 */
export const tokenizeClassic = (line, fields) => {
	const match = regexOf(fields).exec(line);
	if (!match) {
		return null;
	}
	return Object.fromEntries(fields.map((item, index) => [item.name, match[index + 1]]));
};
