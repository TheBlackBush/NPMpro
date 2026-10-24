import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import maxmind from "maxmind";
import * as tar from "tar";

const DOWNLOAD_URL = "https://download.maxmind.com/geoip/databases";
const TIMEOUT_MS = 60000;

/**
 * Finds `${edition}.mmdb` anywhere below dir
 *
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

/**
 * Downloads one edition and replaces dir/edition.mmdb after the new file was opened successfully
 *
 * @throws Error without credentials or response bodies in the message
 */
const updateEdition = async ({ edition, authorization, dir, fetch }) => {
	const response = await fetch(`${DOWNLOAD_URL}/${encodeURIComponent(edition)}/download?suffix=tar.gz`, {
		headers: { Authorization: authorization },
		redirect: "follow",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`${edition}: MaxMind responded with HTTP ${response.status}`);

	const work = await mkdtemp(path.join(dir, ".update-"));
	try {
		const archive = path.join(work, "download.tar.gz");
		await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
		const extracted = path.join(work, "extracted");
		await mkdir(extracted);
		await tar.x({ file: archive, cwd: extracted, strict: true });
		const name = `${edition}.mmdb`;
		const found = await findFile(extracted, name);
		if (!found) throw new Error(`${edition}: the download does not contain ${name}`);
		try {
			await maxmind.open(found);
		} catch {
			throw new Error(`${edition}: the downloaded database is invalid`);
		}
		// same filesystem as the target, so the rename is atomic
		const staged = path.join(work, `staged-${name}`);
		await rename(found, staged);
		await rename(staged, path.join(dir, name));
	} finally {
		await rm(work, { recursive: true, force: true });
	}
};

/**
 * Downloads the given MaxMind editions into dir (an existing file is only replaced by a valid new one)
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
	for (const edition of editions) {
		try {
			await updateEdition({ edition, authorization, dir, fetch });
			updated.push(edition);
		} catch (err) {
			const message = err.name === "TimeoutError" ? `${edition}: the download timed out` : String(err.message);
			errors.push(licenseKey ? message.replaceAll(licenseKey, "***") : message);
		}
	}
	if (errors.length > 0) return { ok: false, updated, error: errors.join("; ") };
	return { ok: true, updated };
};

export { updateGeoip };
