import { closeSync, openSync, readSync, statSync } from "node:fs";
import nodeFs from "node:fs/promises";
import path from "node:path";

const ZONEINFO_DIR = "/usr/share/zoneinfo";
// zone names only: letters, digits, _ + - and / between the parts (no dots, so no ".." and no file name extensions);
// rootfs/usr/local/bin/startup-settings.sh uses the same charset
const ZONE_NAME = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/u;
// copies of the zones in other formats or aliases of the local one, not zone names to pick
const SKIPPED = new Set(["posix", "right", "posixrules", "localtime", "Factory"]);
const MAGIC = "TZif";
const MAX_LENGTH = 64;

const isZoneName = (name) =>
	typeof name === "string" && name.length <= MAX_LENGTH && ZONE_NAME.test(name) && !SKIPPED.has(name.split("/")[0]);

const hasMagic = (file) => {
	let fd;
	try {
		fd = openSync(file, "r");
		const buffer = Buffer.alloc(MAGIC.length);
		return readSync(fd, buffer, 0, MAGIC.length, 0) === MAGIC.length && buffer.toString("latin1") === MAGIC;
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
};

/**
 * Whether the name is a time zone the image ships: a zone name (posix/ and right/ copies excluded) whose zoneinfo
 * file is a TZif file
 *
 * @param   {string}  name
 * @param   {string}  [dir]  the zoneinfo folder (tests)
 * @returns {boolean}
 */
const isTimeZone = (name, dir = ZONEINFO_DIR) => {
	if (!isZoneName(name)) return false;
	const file = path.join(dir, name);
	try {
		if (!statSync(file).isFile()) return false;
	} catch {
		return false;
	}
	return hasMagic(file);
};

const walk = async (fs, dir, prefix, out) => {
	for (const entry of await fs.readdir(path.join(dir, prefix), { withFileTypes: true })) {
		const name = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (!isZoneName(name)) continue;
		// tzdata links zones with symlinks or hard links: both count as files
		if (entry.isDirectory()) await walk(fs, dir, name, out);
		else if (isTimeZone(name, dir)) out.push(name);
	}
};

const cache = new Map();

/**
 * The time zone names the image ships, sorted; read once per folder
 *
 * @param   {Object}  [deps]
 * @param   {string}  [deps.dir]  the zoneinfo folder (tests)
 * @param   {Object}  [deps.fs]   node:fs/promises compatible
 * @returns {Promise<string[]>}  empty when the folder cannot be read
 */
const listTimeZones = async ({ dir = ZONEINFO_DIR, fs = nodeFs } = {}) => {
	if (!cache.has(dir)) {
		cache.set(
			dir,
			(async () => {
				const out = [];
				try {
					await walk(fs, dir, "", out);
				} catch {
					cache.delete(dir);
					return [];
				}
				return out.sort((a, b) => a.localeCompare(b, "en"));
			})(),
		);
	}
	return [...(await cache.get(dir))];
};

export { isTimeZone, isZoneName, listTimeZones, ZONEINFO_DIR };
