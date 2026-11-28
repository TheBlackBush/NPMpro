import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import maxmind from "maxmind";
import { x as extractArchive } from "tar";
import { isTimeout, saveBody, sweepLeftovers, TIMEOUT_MS, UpdateError } from "./download.js";

const DOWNLOAD_URL = "https://download.maxmind.com/geoip/databases";
const MAX_BYTES = 300 * 1024 * 1024;
const WANTED_ENTRY = /\.(?:mmdb|txt)$/u;

/**
 * Archive entries that are extracted: directories and regular files named *.mmdb or *.txt up to MAX_BYTES; links and
 * other types are skipped, also when their name matches.
 *
 * @param   {string}  entryPath
 * @param   {{type: string, size: number}}  entry
 * @returns {boolean}
 */
const archiveFilter = (entryPath, entry) =>
	entry.type === "Directory" || (entry.type === "File" && WANTED_ENTRY.test(entryPath) && entry.size <= MAX_BYTES);

/**
 * @param   {string}  dir
 * @param   {string}  name
 * @returns {Promise<string|null>}
 */
const findFile = async (dir, name) => {
	for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
		if (entry.isFile() && entry.name === name) return path.join(entry.parentPath, entry.name);
	}
	return null;
};

/** Downloads the archive, mapping every failure to a fixed message */
const download = async ({ url, authorization, fetch, file }) => {
	try {
		const response = await fetch(url, {
			headers: { Authorization: authorization },
			redirect: "follow",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) throw new UpdateError(`MaxMind returned HTTP ${response.status}`);
		await saveBody(response, file, MAX_BYTES);
	} catch (err) {
		if (err instanceof UpdateError) throw err;
		if (isTimeout(err)) throw new UpdateError("Download timed out");
		throw new UpdateError("Download failed (network error)");
	}
};

/**
 * Downloads one edition and replaces dir/edition.mmdb after the new file was opened successfully
 *
 * @throws UpdateError
 */
const updateEdition = async ({ edition, authorization, dir, fetch }) => {
	const work = await mkdtemp(path.join(dir, ".update-"));
	try {
		const archive = path.join(work, "download.tar.gz");
		await download({
			url: `${DOWNLOAD_URL}/${encodeURIComponent(edition)}/download?suffix=tar.gz`,
			authorization,
			fetch,
			file: archive,
		});
		const extracted = path.join(work, "extracted");
		await mkdir(extracted);
		try {
			await extractArchive({
				file: archive,
				cwd: extracted,
				strict: true,
				filter: archiveFilter,
			});
		} catch {
			throw new UpdateError("The downloaded archive could not be read");
		}
		const name = `${edition}.mmdb`;
		const found = await findFile(extracted, name);
		if (!found) throw new UpdateError(`The archive does not contain ${name}`);
		try {
			const reader = await maxmind.open(found);
			if (!reader.metadata.databaseType.includes(edition.replace("GeoLite2-", ""))) throw new Error("wrong type");
		} catch {
			throw new UpdateError("The downloaded database is invalid");
		}
		// the work dir is inside dir, so this rename is atomic
		await rename(found, path.join(dir, name));
	} finally {
		await rm(work, { recursive: true, force: true });
	}
};

/**
 * Downloads the given MaxMind editions into dir (an existing file is only replaced by a valid new one). `ok` is true
 * only when every requested edition succeeded; `updated` lists the editions whose file was replaced (it can be
 * non-empty while `ok` is false).
 *
 * @param   {Object}    options
 * @param   {string}    options.accountId
 * @param   {string}    options.licenseKey
 * @param   {string[]}  options.editions
 * @param   {string}    options.dir
 * @param   {Function}  [options.fetch]
 * @returns {Promise<{ok: boolean, updated: string[], error?: string}>}
 */
const updateGeoip = async ({ accountId, licenseKey, editions, dir, fetch = globalThis.fetch }) => {
	const authorization = `Basic ${Buffer.from(`${accountId}:${licenseKey}`).toString("base64")}`;
	const updated = [];
	const errors = [];
	await mkdir(dir, { recursive: true });
	await sweepLeftovers(dir);
	for (const edition of editions) {
		try {
			await updateEdition({ edition, authorization, dir, fetch });
			updated.push(edition);
		} catch (err) {
			errors.push(`${edition}: ${err instanceof UpdateError ? err.message : "Update failed"}`);
		}
	}
	if (errors.length > 0) return { ok: false, updated, error: errors.join("; ") };
	return { ok: true, updated };
};

export { archiveFilter, updateGeoip };
