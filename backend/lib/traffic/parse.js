import { isIP } from "node:net";

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Anchored on the start of the "alog" format up to $bytes_sent; later fields (referrer, user agent, ...) are ignored.
// The quoted request may contain escaped quotes.
const LINE =
	/^\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\] (\S+) (\S+) \S+ "(?:[^"\\]|\\.)*" (\d{3}) (\d+)(?: |$)/u;

const cleanHost = (raw) => {
	const host = raw.toLowerCase();
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		return end === -1 ? host : host.slice(0, end + 1);
	}
	return host.replace(/:\d*$/u, "");
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
