import { readFile } from "node:fs/promises";
import https from "node:https";

const MAX_BODY = 64 * 1024 * 1024;
const NEWEST_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRAILING_SLASHES = /\/+$/u;
const LEADING_PLUS = /^\+/u;
const DURATION_PART = /^(?<num>\d+(?:\.\d+)?|\.\d+)(?<unit>ns|us|µs|ms|h|m|s)/u;

const decisionsUrl = (apiUrl, query = "") => `${String(apiUrl).replace(TRAILING_SLASHES, "")}/v1/decisions${query}`;

const parseBody = (text) => {
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("CrowdSec returned invalid JSON");
	}
	if (data === null) {
		return [];
	}
	if (!Array.isArray(data)) {
		throw new Error("CrowdSec returned an unexpected response");
	}
	return data;
};

const failure = (err) => {
	if (err?.tooLarge) {
		return new Error("CrowdSec response is too large");
	}
	if (err?.name === "TimeoutError" || err?.name === "AbortError" || err?.message === "timed out") {
		return Object.assign(new Error("CrowdSec request failed: timed out"), { code: "ETIMEDOUT" });
	}
	const code = err?.cause?.code ?? err?.code;
	return Object.assign(new Error(`CrowdSec request failed: ${code ?? err?.name ?? "error"}`), { code });
};

// an HTTP answer that is not 2xx: the status for the connection test, the message as before
const statusError = (status) => Object.assign(new Error(`CrowdSec answered with status ${status}`), { status });
// the TLS client files or an http URL with TLS auth (a setup problem, shown as a TLS error by the connection test)
const tlsSetupError = (message) => Object.assign(new Error(message), { code: "ERR_CROWDSEC_TLS_SETUP" });

const deadline = (ms) => {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
		ms,
	);
	return { signal: controller.signal, clear: () => clearTimeout(timer) };
};

const tooLarge = () => Object.assign(new Error("too large"), { tooLarge: true });

/**
 * Collects an async iterable of chunks into a string, failing past maxBytes or when the signal aborts.
 * @param {AsyncIterable<Uint8Array | Buffer | string>} body
 * @param {{ maxBytes?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<string>}
 */
export const readLimited = async (body, { maxBytes = MAX_BODY, signal } = {}) => {
	const iterator = body[Symbol.asyncIterator]();
	let onAbort;
	const aborted = new Promise((_, reject) => {
		onAbort = () => reject(signal.reason ?? Object.assign(new Error("timed out"), { name: "TimeoutError" }));
		if (signal?.aborted) {
			onAbort();
		} else {
			signal?.addEventListener("abort", onAbort, { once: true });
		}
	});
	aborted.catch(() => undefined);
	const chunks = [];
	let size = 0;
	try {
		for (;;) {
			const next = await (signal ? Promise.race([iterator.next(), aborted]) : iterator.next());
			if (next.done) {
				break;
			}
			const chunk = typeof next.value === "string" ? Buffer.from(next.value) : next.value;
			size += chunk.length;
			if (size > maxBytes) {
				throw tooLarge();
			}
			chunks.push(chunk);
		}
	} catch (err) {
		iterator.return?.()?.catch?.(() => undefined);
		throw err;
	} finally {
		signal?.removeEventListener("abort", onAbort);
	}
	return Buffer.concat(chunks).toString("utf8");
};

const fetchPlain = async (conf, fetchFn, timeoutMs) => {
	const { signal, clear } = deadline(timeoutMs);
	let text;
	try {
		const res = await fetchFn(decisionsUrl(conf.apiUrl, conf.query), {
			headers: { "X-Api-Key": conf.apiKey, Accept: "application/json" },
			signal,
		});
		if (!res.ok) {
			res.body?.cancel?.()?.catch?.(() => undefined);
			throw Object.assign(new Error("status"), { status: res.status });
		}
		const length = Number(res.headers?.get?.("content-length"));
		if (length > MAX_BODY) {
			res.body?.cancel?.()?.catch?.(() => undefined);
			throw tooLarge();
		}
		text = res.body ? await readLimited(res.body, { signal }) : await res.text();
	} catch (err) {
		if (err.status) {
			throw statusError(err.status);
		}
		throw failure(err);
	} finally {
		clear();
	}
	return parseBody(text);
};

const readCredentialFile = async (path, label) => {
	if (!path) {
		throw tlsSetupError(`CrowdSec TLS ${label} is not set`);
	}
	try {
		return await readFile(path);
	} catch (err) {
		throw tlsSetupError(`Cannot read the CrowdSec TLS ${label} file (${err.code ?? "error"})`);
	}
};

/** GET over node:https, used for TLS client auth and whenever SSL_VERIFY=false (fetch cannot skip verification). */
const getHttps = (url, { headers, cert, key, rejectUnauthorized }, timeoutMs) => {
	const { signal, clear } = deadline(timeoutMs);
	return new Promise((resolve, reject) => {
		const req = https.request(
			url,
			{
				method: "GET",
				cert,
				key,
				rejectUnauthorized,
				headers: { ...headers, Accept: "application/json" },
				timeout: timeoutMs,
				signal,
			},
			(res) => {
				if (res.statusCode < 200 || res.statusCode > 299) {
					reject(statusError(res.statusCode));
					req.destroy();
					return;
				}
				if (Number(res.headers?.["content-length"]) > MAX_BODY) {
					reject(failure(tooLarge()));
					req.destroy();
					return;
				}
				readLimited(res, { signal })
					.then((text) => resolve(parseBody(text)))
					.catch((err) => {
						req.destroy();
						reject(err?.message?.startsWith("CrowdSec") ? err : failure(err));
					});
			},
		);
		req.on("timeout", () => req.destroy(new Error("timed out")));
		req.on("error", (err) => reject(failure(err)));
		req.end();
	}).finally(clear);
};

const fetchTls = async (conf, timeoutMs) => {
	const cert = await readCredentialFile(conf.certFile, "client certificate");
	const key = await readCredentialFile(conf.keyFile, "client key");
	const url = new URL(decisionsUrl(conf.apiUrl, conf.query));
	if (url.protocol !== "https:") {
		throw tlsSetupError("CrowdSec TLS authentication needs an https API URL");
	}
	return getHttps(url, { cert, key, rejectUnauthorized: conf.sslVerify !== false }, timeoutMs);
};

const isHttps = (apiUrl) => {
	try {
		return new URL(decisionsUrl(apiUrl)).protocol === "https:";
	} catch {
		return false;
	}
};

/**
 * Reads the active decisions from the LAPI (`GET /v1/decisions`) with the bouncer credentials. Errors never contain
 * the API key. With sslVerify false an https LAPI is reached over node:https without certificate checks (like the
 * bouncer's SSL_VERIFY=false); otherwise the API key path uses fetch. query is appended to `/v1/decisions`.
 * Errors carry `status` (an HTTP answer) or `code` (network, TLS).
 * @param {{ apiUrl: string, apiKey: string, useTls: boolean, certFile: string, keyFile: string, sslVerify?: boolean, query?: string }} conf
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opts] fetch is used for the verified API key path only
 * @returns {Promise<object[]>} the decisions (an empty list when the LAPI answers null)
 */
export const fetchDecisions = (conf, { fetch: fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) => {
	if (conf.useTls) {
		return fetchTls(conf, timeoutMs);
	}
	if (conf.sslVerify === false && isHttps(conf.apiUrl)) {
		return getHttps(
			new URL(decisionsUrl(conf.apiUrl, conf.query)),
			{ headers: { "X-Api-Key": conf.apiKey }, rejectUnauthorized: false },
			timeoutMs,
		);
	}
	return fetchPlain(conf, fetchFn, timeoutMs);
};

const UNITS = { h: 3600, m: 60, s: 1, ms: 0.001, us: 1e-6, µs: 1e-6, ns: 1e-9 };

/**
 * Parses a Go duration ("3h59m2s", "1h2m3.5s", "-1h") into whole seconds; negative or invalid gives 0.
 * @param {unknown} text
 * @returns {number}
 */
export const parseGoDuration = (text) => {
	const str = String(text ?? "").trim();
	if (str === "" || str.startsWith("-")) {
		return 0;
	}
	let total = 0;
	let rest = str.replace(LEADING_PLUS, "");
	while (rest !== "") {
		const m = DURATION_PART.exec(rest);
		if (!m) {
			return 0;
		}
		total += Number(m.groups.num) * UNITS[m.groups.unit];
		rest = rest.slice(m[0].length);
	}
	return Number.isFinite(total) ? Math.min(Math.floor(total), Number.MAX_SAFE_INTEGER) : 0;
};

const countBy = (list, pick, label) => {
	const counts = new Map();
	for (const item of list) {
		const key = pick(item);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts].map(([name, count]) => ({ [label]: name, count })).sort((a, b) => b.count - a.count);
};

/**
 * Summarises the decisions: by_scenario / by_origin / by_type and countries as { scenario|origin|type|country, count }
 * arrays sorted by count,
 * newest (up to 100, highest id first; country null unless scope is Ip). added_24h counts decisions whose id is in
 * firstSeen (id -> ms) with a time within 24 hours; ids absent from the map are not counted (the caller seeds the map
 * on its first poll so old decisions are not "new").
 * @param {object[] | null} list
 * @param {number} now ms
 * @param {(ip: string) => string | null} geoLookup
 * @param {Map<number, number>} firstSeen
 */
export const summariseDecisions = (list, now, geoLookup, firstSeen) => {
	const items = Array.isArray(list) ? list.filter((d) => d && typeof d === "object") : [];
	let added = 0;
	for (const d of items) {
		const seen = firstSeen?.get(d.id);
		if (seen !== undefined && now - seen <= DAY_MS) {
			added++;
		}
	}
	const cache = new Map();
	const country = (d) => {
		if (d.scope?.toLowerCase() !== "ip") {
			return null;
		}
		if (!cache.has(d.value)) {
			cache.set(d.value, geoLookup?.(d.value) ?? null);
		}
		return cache.get(d.value);
	};
	const newest = items
		.toSorted((a, b) => (b.id ?? 0) - (a.id ?? 0))
		.slice(0, NEWEST_LIMIT)
		.map((d) => ({
			id: d.id,
			value: d.value,
			scope: d.scope,
			scenario: d.scenario,
			origin: d.origin,
			type: d.type,
			duration: d.duration,
			seconds_left: parseGoDuration(d.duration),
			country: country(d),
		}));
	const countryCounts = new Map();
	for (const d of items) {
		const c = country(d);
		if (c) {
			countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
		}
	}
	return {
		total: items.length,
		added_24h: added,
		by_scenario: countBy(items, (d) => d.scenario ?? "", "scenario"),
		by_origin: countBy(items, (d) => d.origin ?? "", "origin"),
		by_type: countBy(items, (d) => d.type ?? "", "type"),
		newest,
		countries: [...countryCounts].map(([c, count]) => ({ country: c, count })).sort((a, b) => b.count - a.count),
	};
};
