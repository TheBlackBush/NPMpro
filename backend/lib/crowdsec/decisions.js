import { readFile } from "node:fs/promises";
import https from "node:https";

const MAX_BODY = 64 * 1024 * 1024;
const NEWEST_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const decisionsUrl = (apiUrl) => `${String(apiUrl).replace(/\/+$/u, "")}/v1/decisions`;

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

const fetchPlain = async (conf, fetchFn, timeoutMs) => {
	let res;
	try {
		res = await fetchFn(decisionsUrl(conf.apiUrl), {
			headers: { "X-Api-Key": conf.apiKey, Accept: "application/json" },
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		throw new Error(`CrowdSec request failed: ${err?.cause?.code ?? err?.name ?? "error"}`);
	}
	if (!res.ok) {
		throw new Error(`CrowdSec answered with status ${res.status}`);
	}
	return parseBody(await res.text());
};

const readCredentialFile = async (path, label) => {
	if (!path) {
		throw new Error(`CrowdSec TLS ${label} is not set`);
	}
	try {
		return await readFile(path);
	} catch (err) {
		throw new Error(`Cannot read the CrowdSec TLS ${label} file (${err.code ?? "error"})`);
	}
};

const fetchTls = async (conf, timeoutMs) => {
	const cert = await readCredentialFile(conf.certFile, "client certificate");
	const key = await readCredentialFile(conf.keyFile, "client key");
	const url = new URL(decisionsUrl(conf.apiUrl));
	if (url.protocol !== "https:") {
		throw new Error("CrowdSec TLS authentication needs an https API URL");
	}
	return new Promise((resolve, reject) => {
		const req = https.request(
			url,
			{ method: "GET", cert, key, headers: { Accept: "application/json" }, timeout: timeoutMs },
			(res) => {
				if (res.statusCode < 200 || res.statusCode > 299) {
					res.resume();
					reject(new Error(`CrowdSec answered with status ${res.statusCode}`));
					return;
				}
				const chunks = [];
				let size = 0;
				res.on("data", (chunk) => {
					size += chunk.length;
					if (size > MAX_BODY) {
						req.destroy(new Error("CrowdSec response is too large"));
						return;
					}
					chunks.push(chunk);
				});
				res.on("end", () => {
					try {
						resolve(parseBody(Buffer.concat(chunks).toString("utf8")));
					} catch (err) {
						reject(err);
					}
				});
				res.on("error", () => reject(new Error("CrowdSec response failed")));
			},
		);
		req.on("timeout", () => req.destroy(new Error("CrowdSec request timed out")));
		req.on("error", (err) => reject(new Error(`CrowdSec request failed: ${err.code ?? err.message}`)));
		req.end();
	});
};

/**
 * Reads the active decisions from the LAPI (`GET /v1/decisions`) with the bouncer credentials.
 * Errors never contain the API key.
 * @param {{ apiUrl: string, apiKey: string, useTls: boolean, certFile: string, keyFile: string }} conf
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opts] fetch is used for the API key path only
 * @returns {Promise<object[]>} the decisions (an empty list when the LAPI answers null)
 */
export const fetchDecisions = (conf, { fetch: fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) =>
	conf.useTls ? fetchTls(conf, timeoutMs) : fetchPlain(conf, fetchFn, timeoutMs);

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
	let rest = str.replace(/^\+/u, "");
	while (rest !== "") {
		const m = /^(\d+(?:\.\d+)?|\.\d+)(ns|us|µs|ms|h|m|s)/u.exec(rest);
		if (!m) {
			return 0;
		}
		total += Number(m[1]) * UNITS[m[2]];
		rest = rest.slice(m[0].length);
	}
	return Math.floor(total);
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
 * Summarises the decisions.
 * by_scenario / by_origin / by_type are arrays of { scenario|origin|type, count } and countries an array of
 * { country, count }, all sorted by count descending. newest holds up to 100 decisions, highest id first, as
 * { id, value, scope, scenario, origin, type, duration, seconds_left, country } (country null unless scope is Ip).
 * added_24h counts decisions whose id is in firstSeen (id -> ms) with a time within the last 24 hours; ids absent
 * from the map are not counted (the caller seeds the map on its first poll so old decisions are not "new").
 * @param {object[] | null} list
 * @param {number} now ms
 * @param {(ip: string) => string | null} geoLookup
 * @param {Map<number, number>} firstSeen
 */
export const summariseDecisions = (list, now, geoLookup, firstSeen) => {
	const items = Array.isArray(list) ? list : [];
	let added = 0;
	for (const d of items) {
		const seen = firstSeen?.get(d.id);
		if (seen !== undefined && now - seen <= DAY_MS) {
			added++;
		}
	}
	const country = (d) => (d.scope?.toLowerCase() === "ip" ? (geoLookup?.(d.value) ?? null) : null);
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
		if (d.scope?.toLowerCase() === "ip") {
			const c = geoLookup?.(d.value) ?? null;
			if (c) {
				countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
			}
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
