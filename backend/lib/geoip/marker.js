import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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

export { PROVIDER_MARKER, writeProviderMarker };
