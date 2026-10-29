import { isIP } from "node:net";

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Anchored on the start of the "alog" format up to $bytes_sent; later fields (referrer, user agent, ...) are ignored.
// The format ends with $server_port since it was added; older lines end with $upstream_cache_status (never a number).
// The quoted request may contain escaped quotes.
const LINE =
	/^\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\] (\S+) (\S+) \S+ "((?:[^"\\]|\\.)*)" (\d{3}) (\d+)(?: |$)/u;

const HOST_PORT = /:\d*$/u;
// "METHOD target" with an optional protocol; anything else (for example "-" or binary garbage) has no method and path
const REQUEST = /^(?<method>[A-Za-z]{1,32}) (?<target>\S+)(?: \S+)?$/u;
const PATH_END = /[;?#]/u;
// absolute-form target ("GET http://user:pass@host/path"): scheme and authority, the userinfo is removed
const ABSOLUTE = /^(?<scheme>[A-Za-z][A-Za-z0-9+.-]*:\/\/)(?<authority>[^/?#]*)/u;
const MAX_PATH = 200;
// the path handed to the missing pages cleanup: long enough that the cleanup sees whole emails and tokens, bounded
const MAX_FULL_PATH = 2048;
const RAW_PORT = /:(\d+)$/u;
const HEALTHCHECK_UA = ' "NPMpro/healthcheck" ';
const DEFAULT_PORTS = new Set(["80", "443"]);
// Empty for requests over a unix socket listener (the line then ends with a space)
const SERVER_PORT = / (?<port>\d{0,5})$/u;
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

// The raw host field ($host$is_request_port$request_port) and $remote_addr, the first two fields after the time
const hostAndClient = (line) => {
	const start = line.indexOf("] ");
	if (start === -1) {
		return [null, null];
	}
	const [host = null, client = null] = line.slice(start + 2).split(" ", 2);
	return [host, client];
};

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
 * (`;jsessionid=...`), the query string and fragment are cut off. `path` is at most 200 characters (the recent
 * requests list), `fullPath` at most 2048 (cleaned before it is cut, for missing pages; a longer path loses its
 * partial last segment, everything after the last "/" within the first 2048 characters).
 * Method "-" and paths "" when the field is not a request line.
 */
const parseRequest = (request) => {
	const m = REQUEST.exec(request);
	if (!m) {
		return { method: "-", path: "", fullPath: "" };
	}
	const { method } = m.groups;
	const target = withoutUserinfo(m.groups.target);
	const end = target.search(PATH_END);
	const uncut = end === -1 ? target : target.slice(0, end);
	let fullPath = uncut;
	if (uncut.length > MAX_FULL_PATH) {
		// the last segment is cut in part (half an email or token the cleanup no longer recognises): drop it
		fullPath = uncut.slice(0, MAX_FULL_PATH);
		fullPath = fullPath.slice(0, fullPath.lastIndexOf("/") + 1);
	}
	return { method, path: uncut.slice(0, MAX_PATH), fullPath };
};

export const parseAlogLine = (line) => {
	const m = LINE.exec(line);
	if (!m) {
		return null;
	}
	const month = MONTHS[m[2]];
	if (month === undefined || isIP(m[11]) === 0) {
		return null;
	}
	const offset = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) * 60000;
	const time = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - offset;
	const { method, path, fullPath } = parseRequest(m[12]);
	return {
		time,
		host: cleanHost(m[10]),
		ip: m[11],
		status: Number(m[13]),
		bytes: Number(m[14]),
		method,
		path,
		fullPath,
	};
};

export const statusClass = (status) => {
	if (status >= 200 && status < 600) {
		return `${Math.floor(status / 100)}xx`;
	}
	return "other";
};

/**
 * True for NPMpro's own requests, which are not visitor traffic: requests nginx received on the admin UI port
 * ($server_port at the end of the line), which includes the container health check. When the admin port is 80 or
 * 443, proxy hosts share it, and for requests over a unix socket (empty $server_port), only a health check (user
 * agent "NPMpro/healthcheck") from a loopback address or the configured binding address is skipped. Lines written before $server_port was added fall back to the port in the raw host field, which is the
 * port the browser sent (a remapped Docker port is not recognised there).
 * @param {string} line a raw alog line
 * @param {string | number | null | undefined} adminPort NPM_PORT
 * @param {string[]} [bindAddresses] addresses the health check may come from besides loopback (NPM_IPV4_BINDING)
 * @returns {boolean}
 */
export const isOwnRequest = (line, adminPort, bindAddresses = []) => {
	const port = String(adminPort ?? "");
	const adminOnOwnPort = port !== "" && !DEFAULT_PORTS.has(port);
	const serverPort = SERVER_PORT.exec(line)?.groups.port;
	const [host, client] = hostAndClient(line);
	if (serverPort !== undefined) {
		if (serverPort !== "" && adminOnOwnPort) {
			return serverPort === port;
		}
		const local = LOOPBACK.has(client) || (client !== null && bindAddresses.includes(client));
		return line.includes(HEALTHCHECK_UA) && local;
	}
	if (line.includes(HEALTHCHECK_UA)) {
		return true;
	}
	return adminOnOwnPort && host !== null && RAW_PORT.exec(host)?.[1] === port;
};
