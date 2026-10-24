const MINUTE = 60000;
const HOUR = 3600000;
const CLASSES = ["2xx", "3xx", "4xx", "5xx"];

/**
 * Adds per-minute rows (bucket = unix minute) into per-hour rows (bucket = unix hour).
 *
 * @param   {Array<Object>}  rows  {bucket, host, status_class, requests, bytes}
 * @returns {Array<Object>}
 */
export const minutesToHours = (rows) => {
	const out = new Map();
	for (const row of rows) {
		const bucket = Math.floor(row.bucket / 60);
		const key = `${bucket}|${row.host}|${row.status_class}`;
		const hit = out.get(key);
		if (hit) {
			hit.requests += Number(row.requests);
			hit.bytes += Number(row.bytes);
		} else {
			out.set(key, {
				bucket,
				host: row.host,
				status_class: row.status_class,
				requests: Number(row.requests),
				bytes: Number(row.bytes),
			});
		}
	}
	return [...out.values()];
};

/**
 * @param   {Object}  options
 * @param   {Number}  options.now            epoch milliseconds
 * @param   {Number}  options.retentionDays
 * @returns {{minuteBefore: Number, hourBefore: Number}}  buckets strictly below are rolled up / deleted
 */
export const cutoffs = ({ now, retentionDays }) => ({
	minuteBefore: Math.floor(now / MINUTE) - 24 * 60,
	hourBefore: Math.floor(now / HOUR) - retentionDays * 24,
});

/**
 * Builds a series with every bucket from start to start + count - 1; missing ones are zero.
 * Buckets outside the range are ignored.
 *
 * @param   {Array<Object>}  rows   {bucket, status_class, requests}
 * @param   {Number}         start  first bucket
 * @param   {Number}         count
 * @returns {Array<{bucket: Number, by_class: Object}>}
 */
export const fillSeries = (rows, start, count) => {
	const series = [];
	for (let i = 0; i < count; i++) {
		series.push({ bucket: start + i, by_class: Object.fromEntries(CLASSES.map((c) => [c, 0])) });
	}
	for (const row of rows) {
		const point = series[row.bucket - start];
		if (point) {
			point.by_class[row.status_class] = (point.by_class[row.status_class] || 0) + Number(row.requests);
		}
	}
	return series;
};

/**
 * @param   {Array<Object>}  rows  {status_class, requests}
 * @returns {Number}  share of 4xx and 5xx requests, 0 without requests
 */
export const errorRate = (rows) => {
	let total = 0;
	let errors = 0;
	for (const row of rows) {
		const n = Number(row.requests);
		total += n;
		if (row.status_class === "4xx" || row.status_class === "5xx") {
			errors += n;
		}
	}
	return total === 0 ? 0 : errors / total;
};
