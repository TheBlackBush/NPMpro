import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import maxmind from "maxmind";
import { rooted } from "../paths.js";
import { countryFileOf, normalizeProvider, providerOf } from "./providers.js";

const CUSTOM_HTTP_FILES = [rooted("/data/custom_nginx/http_top.conf"), rooted("/data/custom_nginx/http.conf")];

const DIRECTIVE = /^\s*geoip_country\s/u;
const COMMENT = /#.*$/u;

/**
 * True when an uncommented geoip_country directive starts a line of one of the files (included files are not followed)
 *
 * @param   {string[]}  [files]
 * @returns {Promise<boolean>}
 */
const hasCustomDirective = async (files = CUSTOM_HTTP_FILES) => {
	for (const file of files) {
		let text;
		try {
			text = await readFile(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			if (DIRECTIVE.test(line.replace(COMMENT, ""))) return true;
		}
	}
	return false;
};

// path -> { mtimeMs, size, usable }
const cache = new Map();

/**
 * The Country file of the active provider: exists, opens as a MaxMind database and has the type of the provider. The
 * answer is cached by path, mtime and size.
 *
 * @param   {Object}    args
 * @param   {string}    [args.dir]
 * @param   {string}    args.provider
 * @param   {Function}  [args.open]  the reader opener (maxmind.open), a parameter for tests
 * @returns {Promise<{usable: boolean, file: string}>}
 */
const countryDatabase = async ({ dir = rooted("/data/goaccess/geoip"), provider, open = maxmind.open }) => {
	const id = normalizeProvider(provider);
	const file = path.join(dir, countryFileOf(id));
	let info;
	try {
		info = await stat(file);
	} catch {
		cache.delete(file);
		return { usable: false, file };
	}
	const hit = cache.get(file);
	if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size && hit.provider === id) {
		return { usable: hit.usable, file };
	}
	let usable = false;
	try {
		const reader = await open(file);
		const { country } = providerOf(id);
		usable = providerOf(id).typeMatches(country, reader.metadata.databaseType);
	} catch {
		usable = false;
	}
	cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, provider: id, usable });
	return { usable, file };
};

export { CUSTOM_HTTP_FILES, countryDatabase, hasCustomDirective };
