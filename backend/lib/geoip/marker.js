import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROVIDER_IDS } from "./providers.js";

const PROVIDER_MARKER = "provider";
let counter = 0;

/**
 * Writes the active provider id into dir/provider (GoAccess reads it to pick the files), atomically; creates dir when
 * it is missing.
 *
 * @param   {string}  dir
 * @param   {string}  id
 * @returns {Promise<void>}
 */
const writeProviderMarker = async (dir, id) => {
	await mkdir(dir, { recursive: true });
	counter += 1;
	const tmp = path.join(dir, `.provider.${process.pid}.${counter}.tmp`);
	await writeFile(tmp, `${id}\n`, { mode: 0o644 });
	await rename(tmp, path.join(dir, PROVIDER_MARKER));
};

/**
 * The provider id in dir/provider, or null when the marker is missing, unreadable or names no provider
 *
 * @param   {string}  dir
 * @returns {Promise<string|null>}
 */
const readProviderMarker = async (dir) => {
	const id = (await readFile(path.join(dir, PROVIDER_MARKER), "utf8").catch(() => "")).trim();
	return PROVIDER_IDS.includes(id) ? id : null;
};

export { PROVIDER_MARKER, readProviderMarker, writeProviderMarker };
