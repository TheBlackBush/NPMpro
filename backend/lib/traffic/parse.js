import { isIP } from "node:net";

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Anchored on the start of the "alog" format up to $bytes_sent; the user agent and the server port are read separately.
// $server_port follows $upstream_cache_status since it was added (then the fields added after it); older lines end
// with $upstream_cache_status (never a number).
// The quoted request may contain escaped quotes.
const TIME = String.raw`(?<day>\d{2})\/(?<month>[A-Za-z]{3})\/(?<year>\d{4}):(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) (?<sign>[+-])(?<offsetHours>\d{2})(?<offsetMinutes>\d{2})`;
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`;
const LINE = new RegExp(
	String.raw`^\[${TIME}\] (?<host>\S+) (?<ip>\S+) \S+ "(?<request>(?:[^"\\]|\\.)*)" (?<status>\d{3}) (?<bytes>\d+)(?: ${QUOTED} "(?<agent>(?:[^"\\]|\\.)*)")?(?: |$)`,
	"u",
);

const HOST_PORT = /:\d*$/u;
// "METHOD target" with an optional protocol; anything else (for example "-" or binary garbage) has no method and path
const REQUEST = /^(?<method>[A-Za-z]{1,32}) (?<target>\S+)(?: \S+)?$/u;
const PATH_END = /[;?#]/u;
// absolute-form target ("GET http://user:pass@host/path"): scheme and authority, the userinfo is removed
const ABSOLUTE = /^(?<scheme>[A-Za-z][A-Za-z0-9+.-]*:\/\/)(?<authority>[^/?#]*)/u;
const MAX_PATH = 200;
const RAW_PORT = /:(\d+)$/u;
const HEALTHCHECK_UA = "NPMpro/healthcheck";
// the time of a JSON line ($time_local without the brackets) and its status and bytes fields
const JSON_TIME = new RegExp(`^${TIME}$`, "u");
const STATUS = /^\d{3}$/u;
const DIGITS = /^\d+$/u;
const DEFAULT_PORTS = new Set(["80", "443"]);
// The fields after the quoted content type: $ssl_protocol $ssl_cipher $ssl_curve $upstream_cache_status, then
// $server_port (empty over a unix socket listener; missing in lines written before it was added, which end with
// $upstream_cache_status, never a number) and, since they were added, "$server_name" $npmpro_host_id $request_id
// $connection "$upstream_status" "$upstream_response_time". Quoted fields never hold a raw quote (nginx writes \x22).
// The four fields may be empty: nginx writes a found but empty value as nothing ($ssl_curve over TLS when no group
// was negotiated); their fixed count and the end anchor keep the match unique.
const SERVER_PORT = /"[^"]*" \S* \S* \S* \S*(?: (?<port>\d{0,5})(?: "[^"]*" \S+ \S+ \d+ "[^"]*" "[^"]*")?)?$/u;
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

const cleanHost = (raw) => {
	const host = raw.toLowerCase();
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		return end === -1 ? host : host.slice(0, end + 1);
	}
	return host.replace(HOST_PORT, "");
};

/** Removes `user:pass@` from an absolute-form target, so credentials sent in the request line are not shown. */
const withoutUserinfo = (target) => {
	const m = ABSOLUTE.exec(target);
	if (!m) {
		return target;
	}
	const { scheme, authority } = m.groups;
	const at = authority.lastIndexOf("@");
	return at === -1 ? target : `${scheme}${authority.slice(at + 1)}${target.slice(m[0].length)}`;
};

/**
 * Method and path of the quoted request field: userinfo of an absolute-form target is removed, path parameters
 * (`;jsessionid=...`), the query string and fragment are cut off, the path is at most 200 characters.
 * Method "-" and path "" when the field is not a request line.
 */
const parseRequest = (request) => {
	const m = REQUEST.exec(request);
	if (!m) {
		return { method: "-", path: "" };
	}
	const { method } = m.groups;
	const target = withoutUserinfo(m.groups.target);
	const end = target.search(PATH_END);
	return { method, path: (end === -1 ? target : target.slice(0, end)).slice(0, MAX_PATH) };
};

const toTime = ({ day, month, year, hour, minute, second, sign, offsetHours, offsetMinutes }) => {
	const monthIndex = MONTHS[month];
	if (monthIndex === undefined) {
		return null;
	}
	const offset = (sign === "-" ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60000;
	return Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute), Number(second)) - offset;
};

const toRecord = ({ time, rawHost, ip, status, bytes, request, userAgent, serverPort }) => {
	if (time === null || isIP(ip) === 0) {
		return null;
	}
	const { method, path } = parseRequest(request);
	return {
		time,
		host: cleanHost(rawHost),
		rawHost,
		ip,
		status: Number(status),
		bytes: Number(bytes),
		method,
		path,
		serverPort,
		userAgent,
	};
};

// classic lines write an empty value as "-"
const userAgentOf = (value) => (value === undefined || value === "-" ? "" : value);

const parseClassic = (line) => {
	const m = LINE.exec(line);
	if (!m) {
		return null;
	}
	const { host, ip, status, bytes, request, agent } = m.groups;
	return toRecord({
		time: toTime(m.groups),
		rawHost: host,
		ip,
		status,
		bytes,
		request,
		userAgent: userAgentOf(agent),
		serverPort: SERVER_PORT.exec(line)?.groups.port,
	});
};

const parseJson = (line) => {
	let fields;
	try {
		fields = JSON.parse(line);
	} catch {
		return null;
	}
	if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
		return null;
	}
	const { time_local: timeLocal, host, remote_addr: ip, status, bytes_sent: bytes, request } = fields;
	if (![timeLocal, host, ip, status, bytes, request].every((value) => typeof value === "string")) {
		return null;
	}
	const t = JSON_TIME.exec(timeLocal);
	if (!t || !STATUS.test(status) || !DIGITS.test(bytes) || host === "") {
		return null;
	}
	const text = (name) => (typeof fields[name] === "string" ? fields[name] : "");
	return toRecord({
		time: toTime(t.groups),
		rawHost: host,
		ip,
		status,
		bytes,
		request,
		userAgent: text("http_user_agent"),
		serverPort: text("server_port"),
	});
};

/**
 * Reads one access log line, classic or JSON (a line starting with `{`), into the same record: `time` (ms), `host`
 * (lower case, no port), `rawHost` ($host$is_request_port$request_port as written), `ip`, `status`, `bytes`, `method`,
 * `path` (see parseRequest), `serverPort` (`undefined` for classic lines written before $server_port was added,
 * otherwise a string, empty over the unix socket listener) and `userAgent`. Null for anything else, including a line
 * without a valid client IP. The JSON field names are the ones of ACCESS_FIELDS.
 * @param {string} line a raw log line
 * @returns {{time: number, host: string, rawHost: string, ip: string, status: number, bytes: number, method: string,
 *            path: string, serverPort: string | undefined, userAgent: string} | null}
 */
export const parseLogLine = (line) => (line.startsWith("{") ? parseJson(line) : parseClassic(line));

/** The traffic fields of a line in either format (see parseLogLine). */
export const parseAlogLine = (line) => {
	const record = parseLogLine(line);
	if (!record) {
		return null;
	}
	const { time, host, ip, status, bytes, method, path } = record;
	return { time, host, ip, status, bytes, method, path };
};

export const statusClass = (status) => {
	if (status >= 200 && status < 600) {
		return `${Math.floor(status / 100)}xx`;
	}
	return "other";
};

/**
 * True for NPMpro's own requests, which are not visitor traffic: requests nginx received on the admin UI port
 * ($server_port, which ends the line or is followed by the fields added after it), including the container health
 * check. When the admin port is 80 or 443, proxy hosts share it, and for requests over a unix socket (empty
 * $server_port) only a health check (user agent "NPMpro/healthcheck") from a loopback address or the configured
 * binding address is skipped. Lines written before $server_port was added fall back to the port the browser sent (a
 * remapped Docker port is not recognised there).
 * @param {{rawHost: string, ip: string, serverPort: string | undefined, userAgent: string}} record see parseLogLine
 * @param {string | number | null | undefined} adminPort NPM_PORT
 * @param {string[]} [bindAddresses] addresses the health check may come from besides loopback (NPM_IPV4_BINDING)
 * @returns {boolean}
 */
export const isOwnRecord = (record, adminPort, bindAddresses = []) => {
	const port = String(adminPort ?? "");
	const adminOnOwnPort = port !== "" && !DEFAULT_PORTS.has(port);
	const { serverPort, userAgent, ip, rawHost } = record;
	const health = userAgent === HEALTHCHECK_UA;
	if (serverPort !== undefined) {
		if (serverPort !== "" && adminOnOwnPort) {
			return serverPort === port;
		}
		return health && (LOOPBACK.has(ip) || bindAddresses.includes(ip));
	}
	return health || (adminOnOwnPort && RAW_PORT.exec(rawHost)?.[1] === port);
};

/** isOwnRecord() for a raw line of either format; false for a line that is not a log line. */
export const isOwnRequest = (line, adminPort, bindAddresses = []) => {
	const record = parseLogLine(line);
	return record !== null && isOwnRecord(record, adminPort, bindAddresses);
};
