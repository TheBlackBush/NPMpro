import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractTo, packStage } from "../../lib/backup/archive.js";
import { openBackupFile, readHeader, writeBackupFile } from "../../lib/backup/format.js";

// a backup file changed by hand, the way a crafted upload would be: unpacked, edited, the manifest's file list
// written again so the stage still verifies, and packed without encryption

const listFiles = async (dir, base = dir) => {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
		else out.push(path.relative(base, full).split(path.sep).join("/"));
	}
	return out.sort((a, b) => (a < b ? -1 : Number(a > b)));
};

/**
 * @param   {string}    file        the backup file
 * @param   {string}    out         the crafted file
 * @param   {Function}  edit        async ({ dir, data, write, writeData }) => void
 * @param   {Object}    [options]
 * @param   {string}    [options.passphrase]
 * @returns {Promise<string>}  out
 */
const craftBackup = async (file, out, edit, { passphrase } = {}) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "backup-craft-"));
	try {
		await extractTo({ source: await openBackupFile({ file, passphrase }), dir, allow: () => true });
		const data = async (typeId) => JSON.parse(await readFile(path.join(dir, "data", `${typeId}.json`), "utf8"));
		const writeData = (typeId, value) => writeFile(path.join(dir, "data", `${typeId}.json`), JSON.stringify(value));
		const write = (rel, content) => writeFile(path.join(dir, "files", rel), content);
		await edit({ dir, data, write, writeData });
		const manifestFile = path.join(dir, "manifest.json");
		const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
		manifest.files = [];
		for (const rel of await listFiles(path.join(dir, "files"))) {
			const full = path.join(dir, "files", rel);
			manifest.files.push({
				path: `files/${rel}`,
				size: (await stat(full)).size,
				sha256: createHash("sha256")
					.update(await readFile(full))
					.digest("hex"),
			});
		}
		await writeFile(manifestFile, JSON.stringify(manifest));
		const { header } = await readHeader(file);
		await writeBackupFile({ source: packStage(dir), file: out, mode: "none", summary: header.summary });
		return out;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};

export { craftBackup };
