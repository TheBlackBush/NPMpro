import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BackupError, FORMAT_VERSION } from "./format.js";
import { exportRows } from "./rows.js";
import { TYPES } from "./types.js";

const FILES_PREFIX = "files/";

const sha256 = (file) =>
	new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(file)
			.on("error", reject)
			.on("data", (chunk) => hash.update(chunk))
			.on("end", () => resolve(hash.digest("hex")));
	});

// the regular files below dir as "/" separated paths; anything else (a symlink, a socket) is an error
const listFiles = async (dir, base = dir) => {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
		else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
		else throw new BackupError("invalid-archive", `${path.relative(base, full)} is not a regular file`);
	}
	return out;
};

// the filter for cp: regular files and folders the type allows; symlinks are never copied
const copyFilter = (dataDir, type, secrets) => async (src) => {
	const rel = path.relative(dataDir, src).split(path.sep).join("/");
	if (!type.files.allow(rel) || (!secrets && type.files.secret(rel))) return false;
	const info = await lstat(src);
	return info.isFile() || info.isDirectory();
};

const copyFiles = async ({ dataDir, stageDir, type, secrets }) => {
	for (const root of type.files.roots) {
		const from = path.join(dataDir, root);
		if (!existsSync(from)) continue;
		await cp(from, path.join(stageDir, "files", root), {
			recursive: true,
			verbatimSymlinks: true,
			filter: copyFilter(dataDir, type, secrets),
		});
	}
};

const writeData = async ({ knex, box, stageDir, types, secrets }) => {
	const counts = {};
	await knex.transaction(async (trx) => {
		for (const typeId of types) {
			const type = TYPES[typeId];
			if (type.tables.length === 0) continue;
			let rowsByTable = {};
			for (const { table, where } of type.tables) rowsByTable[table] = await exportRows(trx, table, where);
			rowsByTable = secrets ? type.secrets.export(rowsByTable, box) : type.secrets.strip(rowsByTable);
			counts[typeId] = rowsByTable[type.tables[0].table].length;
			await writeFile(path.join(stageDir, "data", `${typeId}.json`), JSON.stringify(rowsByTable), {
				mode: 0o600,
			});
		}
	});
	return counts;
};

/**
 * Writes the chosen types into stageDir: manifest.json, data/<type>.json and files/...
 *
 * @param   {Object}   options
 * @param   {Object}   options.knex
 * @param   {Object}   options.box       the secret box, used when secrets is true
 * @param   {string}   options.dataDir
 * @param   {string}   options.stageDir
 * @param   {string[]} options.types     type ids
 * @param   {boolean}  options.secrets   whether secrets go into the backup
 * @param   {Object}   options.meta      { npmproVersion, dbVersion, createdBy: { name, email }, createdAt }
 * @returns {Promise<{ manifest: Object, summary: Object }>}
 */
const exportStage = async ({ knex, box, dataDir, stageDir, types, secrets, meta }) => {
	await mkdir(path.join(stageDir, "data"), { recursive: true, mode: 0o700 });
	await mkdir(path.join(stageDir, "files"), { recursive: true, mode: 0o700 });
	const counts = await writeData({ knex, box, stageDir, types, secrets });
	for (const typeId of types) {
		const type = TYPES[typeId];
		await copyFiles({ dataDir, stageDir, type, secrets });
		if (type.tables.length === 0) {
			const copied = await listFiles(path.join(stageDir, "files"));
			counts[typeId] = copied.filter((rel) => type.files.allow(rel)).length;
		}
	}
	const files = [];
	for (const rel of (await listFiles(path.join(stageDir, "files"))).sort((a, b) => (a < b ? -1 : Number(a > b)))) {
		const full = path.join(stageDir, "files", rel);
		files.push({ path: `${FILES_PREFIX}${rel}`, size: (await stat(full)).size, sha256: await sha256(full) });
	}
	const manifest = {
		format: FORMAT_VERSION,
		npmpro_version: meta.npmproVersion,
		created_at: meta.createdAt,
		created_by: meta.createdBy,
		secrets,
		types,
		counts,
		db_version: meta.dbVersion,
		files,
	};
	await writeFile(path.join(stageDir, "manifest.json"), JSON.stringify(manifest, null, "\t"), { mode: 0o600 });
	const { format, created_at, npmpro_version } = manifest;
	return { manifest, summary: { format, types, counts, created_at, npmpro_version, secrets } };
};

const invalid = (reason) => new BackupError("invalid-archive", reason);

// a manifest file path that stays inside files/
const isStagePath = (value) =>
	typeof value === "string" &&
	value.startsWith(FILES_PREFIX) &&
	path.posix.normalize(value) === value &&
	value.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/**
 * Checks an extracted stage against its manifest: every listed file exists with the listed size and hash, nothing
 * else is under files/, and data/ holds only the types the manifest names.
 *
 * @param   {string}  stageDir
 * @param   {Object}  manifest
 * @returns {Promise<void>}  rejects with BackupError("invalid-archive")
 */
const verifyStage = async (stageDir, manifest) => {
	if (!Array.isArray(manifest?.files) || !Array.isArray(manifest.types)) throw invalid("The manifest is incomplete");
	const listed = new Set();
	for (const entry of manifest.files) {
		if (!isStagePath(entry?.path)) throw invalid("The manifest lists an invalid file path");
		if (listed.has(entry.path)) throw invalid(`${entry.path} is listed twice`);
		listed.add(entry.path);
		const full = path.join(stageDir, entry.path);
		const info = await lstat(full).catch(() => null);
		if (!info?.isFile()) throw invalid(`${entry.path} is missing`);
		if (info.size !== entry.size || (await sha256(full)) !== entry.sha256) {
			throw invalid(`${entry.path} does not match the manifest`);
		}
	}
	const filesDir = path.join(stageDir, "files");
	const present = existsSync(filesDir) ? await listFiles(filesDir) : [];
	for (const rel of present) {
		if (!listed.has(`${FILES_PREFIX}${rel}`)) throw invalid(`${FILES_PREFIX}${rel} is not in the manifest`);
	}
	const dataDir = path.join(stageDir, "data");
	const dataFiles = existsSync(dataDir) ? await listFiles(dataDir) : [];
	for (const rel of dataFiles) {
		const typeId = rel.endsWith(".json") ? rel.slice(0, -".json".length) : null;
		if (typeId === null || !manifest.types.includes(typeId)) throw invalid(`data/${rel} is not a chosen type`);
	}
};

export { exportStage, verifyStage };
