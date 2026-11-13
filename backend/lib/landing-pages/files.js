import { randomUUID } from "node:crypto";
import nodeFs from "node:fs/promises";
import { rooted } from "../paths.js";
import { BUILTIN_DIR, GLOBAL_DIR, PAGE_FILES, PAGE_TYPES, PLACES, placeDir } from "./types.js";

// The page files nginx serves: the global pages (always written, the built-in page or the custom one) and the custom
// pages of a place. 0644 in 0755 folders: the nginx workers run as npmpro-worker.
const FILE_MODE = 0o644;

/**
 * @param   {Object} pages  effectivePages
 * @param   {Object} [deps]
 * @returns {Promise<{ path: string, content: string }[]>}  the seven global files, rooted
 */
export const globalPageFiles = async (pages, { fs = nodeFs } = {}) =>
	await Promise.all(
		PAGE_TYPES.map(async (type) => ({
			path: rooted(`${GLOBAL_DIR}/${PAGE_FILES[type]}`),
			content:
				pages[type].choice === "custom"
					? pages[type].html
					: await fs.readFile(rooted(`${BUILTIN_DIR}/${PAGE_FILES[type]}`), "utf8"),
		})),
	);

/**
 * Writes a page so that nginx never reads a partial file: a temporary file next to it, then a rename.
 *
 * @param {string} file     rooted path
 * @param {string} content
 * @param {Object} [deps]
 */
export const writePageFile = async (file, content, { fs = nodeFs } = {}) => {
	const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await fs.writeFile(temp, content, { encoding: "utf8", mode: FILE_MODE });
		await fs.chmod(temp, FILE_MODE);
		await fs.rename(temp, file);
	} catch (err) {
		await fs.rm(temp, { force: true });
		throw err;
	}
};

/**
 * @param {string[]} paths  rooted files
 * @param {Object}   [deps]
 */
export const makeReadable = async (paths, { fs = nodeFs } = {}) => {
	for (const file of paths) await fs.chmod(file, FILE_MODE);
};

/**
 * Writes the custom pages of a place and removes the files of its other pages (the folder when none is custom)
 *
 * @param {"proxy_host"|"dead_host"|"access_list"} kind
 * @param {Object} row  the full saved row: every page column and its _html column (a row without them, as a list
 *                      returns it, would read as "no custom page" and wipe the saved pages, so it is refused)
 * @param {Object} [deps]
 */
export const writePlacePages = async (kind, row, { fs = nodeFs } = {}) => {
	const dir = rooted(placeDir(kind, row.id));
	for (const field of PLACES[kind].fields) {
		if (typeof row[`${field.column}_html`] !== "string") {
			throw new Error(`writePlacePages needs the full saved row: ${field.column}_html is missing`);
		}
	}
	const custom = PLACES[kind].fields.filter(
		(field) =>
			row[field.column] === "custom" &&
			typeof row[`${field.column}_html`] === "string" &&
			row[`${field.column}_html`] !== "",
	);
	if (custom.length === 0) {
		await fs.rm(dir, { recursive: true, force: true });
		return;
	}
	await fs.mkdir(dir, { recursive: true, mode: 0o755 });
	for (const field of PLACES[kind].fields) {
		const file = `${dir}/${PAGE_FILES[field.type]}`;
		if (custom.includes(field)) {
			await writePageFile(file, row[`${field.column}_html`], { fs });
		} else {
			await fs.rm(file, { force: true });
		}
	}
};

/**
 * @param {"proxy_host"|"dead_host"|"access_list"} kind
 * @param {number} id
 * @param {Object} [deps]
 */
export const removePlacePages = async (kind, id, { fs = nodeFs } = {}) =>
	fs.rm(rooted(placeDir(kind, id)), { recursive: true, force: true });
