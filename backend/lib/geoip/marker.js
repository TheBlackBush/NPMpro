import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PROVIDER_MARKER = "provider";

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
	const tmp = path.join(dir, ".provider.tmp");
	await writeFile(tmp, `${id}\n`, { mode: 0o644 });
	await rename(tmp, path.join(dir, PROVIDER_MARKER));
};

export { PROVIDER_MARKER, writeProviderMarker };
