import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import maxmind from "maxmind";
import { byteLimit, isTimeout, saveBody, sweepLeftovers, TIMEOUT_MS, UpdateError } from "./download.js";
import { providerOf } from "./providers.js";

const DBIP_URL = "https://download.db-ip.com/free";
const DAY_MS = 24 * 60 * 60 * 1000;
const DBIP_MAX_BYTES = 100 * 1024 * 1024; // packed and unpacked (R8)

/** UTC "YYYY-MM" */
const monthOf = (date) => date.toISOString().slice(0, 7);

/** "2026-01" -> "2025-12" */
const previousMonth = (month) => {
	const [year, mon] = month.split("-").map(Number);
	return mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
};

const dbipUrl = (edition, month) => `${DBIP_URL}/dbip-${edition.toLowerCase()}-lite-${month}.mmdb.gz`;

const request = async (fetch, url, method) => {
	try {
		return await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch (err) {
		if (isTimeout(err)) throw new UpdateError("Download timed out");
		throw new UpdateError("Download failed (network error)");
	}
};

/** HEAD for the current month, then for the previous one; returns the URL and the response of the first that exists */
const findFile = async (fetch, edition, month) => {
	const previous = previousMonth(month);
	for (const candidate of [month, previous]) {
		const url = dbipUrl(edition, candidate);
		const response = await request(fetch, url, "HEAD");
		if (response.ok) return { url, response };
		if (response.status !== 404) throw new UpdateError(`DB-IP returned HTTP ${response.status}`);
	}
	throw new UpdateError(`DB-IP has no file for ${month} or ${previous}`);
};

const isCurrent = async (file, lastModified) => {
	if (Number.isNaN(lastModified)) return false;
	try {
		return (await stat(file)).mtimeMs >= lastModified;
	} catch {
		return false;
	}
};

const unpack = async (gz, mmdb, maxBytes) => {
	try {
		await pipeline(
			createReadStream(gz),
			createGunzip(),
			byteLimit(maxBytes, "The unpacked database is too large"),
			createWriteStream(mmdb),
		);
	} catch (err) {
		if (err instanceof UpdateError) throw err;
		throw new UpdateError("The downloaded file could not be unpacked");
	}
};

/** @returns {Promise<boolean>} true when the file was replaced, false when the local file is already current */
const updateEdition = async ({ edition, dir, fetch, month, maxBytes, now }) => {
	const { url, response: head } = await findFile(fetch, edition, month);
	const target = path.join(dir, providerOf("dbip").file(edition));
	const parsed = Date.parse(head.headers.get("last-modified") ?? "");
	// a date far in the future would block every later update: treat it as now
	const lastModified = parsed > now.getTime() + DAY_MS ? now.getTime() : parsed;
	if (await isCurrent(target, lastModified)) return false;

	const work = await mkdtemp(path.join(dir, ".update-"));
	try {
		const gz = path.join(work, "download.mmdb.gz");
		const mmdb = path.join(work, path.basename(target));
		const response = await request(fetch, url, "GET");
		if (!response.ok) {
			await response.body?.cancel();
			throw new UpdateError(`DB-IP returned HTTP ${response.status}`);
		}
		try {
			await saveBody(response, gz, maxBytes);
		} catch (err) {
			if (err instanceof UpdateError) throw err;
			throw new UpdateError(isTimeout(err) ? "Download timed out" : "Download failed (network error)");
		}
		await unpack(gz, mmdb, maxBytes);
		try {
			const reader = await maxmind.open(mmdb);
			if (!providerOf("dbip").typeMatches(edition, reader.metadata.databaseType)) throw new Error("wrong type");
		} catch {
			throw new UpdateError("The downloaded database is invalid");
		}
		if (!Number.isNaN(lastModified)) {
			const date = new Date(lastModified);
			await utimes(mmdb, date, date);
		}
		// the work dir is inside dir, so this rename is atomic
		await rename(mmdb, target);
		return true;
	} finally {
		await rm(work, { recursive: true, force: true });
	}
};

/**
 * Downloads the given DB-IP Lite editions into dir (an existing file is only replaced by a valid, newer one). `updated`
 * lists the editions whose file was replaced (it can be non-empty while `ok` is false).
 *
 * @param   {Object}    options
 * @param   {string[]}  options.editions
 * @param   {string}    options.dir
 * @param   {Function}  options.fetch  the guarded fetch (required, there is no default)
 * @param   {Function}  [options.now]
 * @param   {number}    [options.maxBytes]  size cap of the packed and the unpacked file (a parameter for tests)
 * @returns {Promise<{ok: boolean, updated: string[], error?: string}>}
 */
const updateDbip = async ({ editions, dir, fetch, now = () => new Date(), maxBytes = DBIP_MAX_BYTES }) => {
	if (typeof fetch !== "function") throw new TypeError("updateDbip needs the guarded fetch");
	const updated = [];
	const errors = [];
	try {
		await mkdir(dir, { recursive: true });
		await sweepLeftovers(dir);
	} catch {
		return { ok: false, updated, error: "The GeoIP folder is not writable" };
	}
	const current = now();
	const month = monthOf(current);
	for (const edition of editions) {
		try {
			if (await updateEdition({ edition, dir, fetch, month, maxBytes, now: current })) updated.push(edition);
		} catch (err) {
			errors.push(`${edition}: ${err instanceof UpdateError ? err.message : "Update failed"}`);
		}
	}
	if (errors.length > 0) return { ok: false, updated, error: errors.join("; ") };
	return { ok: true, updated };
};

export { DBIP_MAX_BYTES, DBIP_URL, dbipUrl, monthOf, previousMonth, updateDbip };
