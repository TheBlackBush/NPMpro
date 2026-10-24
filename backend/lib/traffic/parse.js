import { isIP } from "node:net";

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Anchored on the start of the "alog" format up to $bytes_sent; later fields (referrer, user agent, ...) are ignored.
// The quoted request may contain escaped quotes.
const LINE =
	/^\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\] (\S+) (\S+) \S+ "(?:[^"\\]|\\.)*" (\d{3}) (\d+)(?: |$)/u;

const HOST_PORT = /:\d*$/u;
const RAW_PORT = /:(\d+)$/u;
const HEALTHCHECK_UA = ' "NPMpro/healthcheck" ';
const DEFAULT_PORTS = new Set(["80", "443"]);

const cleanHost = (raw) => {
	const host = raw.toLowerCase();
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		return end === -1 ? host : host.slice(0, end + 1);
	}
	return host.replace(HOST_PORT, "");
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
	return { time, host: cleanHost(m[10]), ip: m[11], status: Number(m[12]), bytes: Number(m[13]) };
};

export const statusClass = (status) => {
	if (status >= 200 && status < 600) {
		return `${Math.floor(status / 100)}xx`;
	}
	return "other";
};

/**
 * True for NPMpro's own requests, which are not visitor traffic: the container health check (user agent
 * "NPMpro/healthcheck") and requests to the admin UI port, seen as the port in the raw host field
 * ($host$is_request_port$request_port). The port check is skipped when the admin port is 80 or 443, because
 * proxy hosts are served there; with a remapped Docker port the browser sends the outside port, so those admin
 * UI requests are still counted.
 * @param {string} line a raw alog line
 * @param {string | number | null | undefined} adminPort NPM_PORT
 * @returns {boolean}
 */
export const isOwnRequest = (line, adminPort) => {
	if (line.includes(HEALTHCHECK_UA)) {
		return true;
	}
	const port = String(adminPort ?? "");
	if (port === "" || DEFAULT_PORTS.has(port)) {
		return false;
	}
	const start = line.indexOf("] ");
	if (start === -1) {
		return false;
	}
	const end = line.indexOf(" ", start + 2);
	const host = line.slice(start + 2, end === -1 ? undefined : end);
	return RAW_PORT.exec(host)?.[1] === port;
};
