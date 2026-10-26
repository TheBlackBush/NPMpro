import { chmod, cp, lstat, mkdir, readdir, rename, rm, rmdir, symlink } from "node:fs/promises";
import path from "node:path";
import { BackupError } from "./format.js";
import { TYPES } from "./types.js";

// Replace restore of the files: the instance's files of a type are moved aside, the staged ones moved into place, and
// every step is journaled so undo() puts the folder back as it was. Symlinks in the instance are moved as links,
// never followed.

const LIVE_NAMES = ["cert", "chain", "fullchain", "privkey"];
const LIVE_FOLDER = /^npm-(?<id>\d+)$/u;
const ARCHIVE_FILE = /^(?<kind>[a-z]+)(?<number>\d+)\.pem$/u;
const DIGITS = /^\d+$/u;

// files the nginx workers serve, and the folders that lead to them
const isServed = (rel) =>
	rel === "public" || ["public/html", "public/avatar"].some((root) => rel === root || rel.startsWith(`${root}/`));
const permissions = (mode) => mode % 0o10000;
const fileMode = (rel) => (isServed(rel) ? 0o644 : 0o600);
const folderMode = (rel) => (isServed(rel) ? 0o755 : 0o700);

const exists = (full) =>
	lstat(full).then(
		(info) => info,
		(error) => {
			if (error.code === "ENOENT") return null;
			throw error;
		},
	);

// rename, or copy and remove when the two paths are on different filesystems
const move = async (from, to) => {
	try {
		await rename(from, to);
	} catch (error) {
		if (error.code !== "EXDEV") throw error;
		await cp(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true });
		await rm(from, { recursive: true, force: true });
	}
};

const createSwap = ({ dataDir, stageDir, asideDir }) => {
	const journal = [];
	const inData = (rel) => path.join(dataDir, rel);
	const inAside = (rel) => path.join(asideDir, rel);

	// creates the missing folders of rel below dataDir; refuses a path through anything but real folders
	const ensureFolder = async (rel) => {
		const parts = rel === "." ? [] : rel.split("/");
		for (let index = 1; index <= parts.length; index++) {
			const prefix = parts.slice(0, index).join("/");
			const info = await exists(inData(prefix));
			if (info?.isDirectory()) continue;
			if (info) throw new Error(`${prefix} is in the way of the restored files`);
			await mkdir(inData(prefix), { mode: folderMode(prefix) });
			await chmod(inData(prefix), folderMode(prefix));
			journal.push({ op: "mkdir", rel: prefix });
		}
	};

	// moves the allowed entries at rel aside, noting the modes of the regular files in modes; folders below a root
	// that end up empty are removed
	const moveAside = async (files, rel, modes, isRoot) => {
		const info = await exists(inData(rel));
		if (!(info && files.allow(rel))) return;
		if (info.isDirectory()) {
			for (const name of (await readdir(inData(rel))).sort())
				await moveAside(files, `${rel}/${name}`, modes, false);
			if (!isRoot && (await readdir(inData(rel))).length === 0) {
				await rmdir(inData(rel));
				journal.push({ op: "rmdir", rel, mode: permissions(info.mode) });
			}
			return;
		}
		await mkdir(path.dirname(inAside(rel)), { recursive: true, mode: 0o700 });
		await move(inData(rel), inAside(rel));
		journal.push({ op: "aside", rel });
		if (info.isFile()) modes.set(rel, permissions(info.mode));
	};

	// moves the staged entries at rel into place
	const place = async (files, rel, modes) => {
		const from = path.join(stageDir, "files", rel);
		const info = await exists(from);
		if (!info) return;
		if (!files.allow(rel)) throw new BackupError("invalid-archive", `files/${rel} is not allowed`);
		if (info.isDirectory()) {
			await ensureFolder(rel);
			for (const name of (await readdir(from)).sort()) await place(files, `${rel}/${name}`, modes);
			return;
		}
		if (!info.isFile()) throw new BackupError("invalid-archive", `files/${rel} is not a regular file`);
		await ensureFolder(path.posix.dirname(rel));
		if (await exists(inData(rel))) throw new Error(`${rel} is in the way of the restored file`);
		await move(from, inData(rel));
		journal.push({ op: "place", rel });
		await chmod(inData(rel), modes.get(rel) ?? fileMode(rel));
	};

	const swapType = async (files) => {
		const modes = new Map();
		for (const root of files.roots) await moveAside(files, root, modes, true);
		for (const root of files.roots) await place(files, root, modes);
	};

	const undoEntry = async ({ op, rel, mode }) => {
		if (op === "place") await rm(inData(rel));
		else if (op === "mkdir") await rmdir(inData(rel));
		else if (op === "rmdir") {
			await mkdir(inData(rel), { mode });
			await chmod(inData(rel), mode);
		} else await move(inAside(rel), inData(rel));
	};

	// every step back, newest first; a step that fails does not stop the others
	const undo = async () => {
		const errors = [];
		while (journal.length > 0) {
			const entry = journal.pop();
			try {
				await undoEntry(entry);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length > 0) throw new AggregateError(errors, "Some restored files could not be moved back");
	};

	return { swapType, undo };
};

/**
 * Puts the staged files of the chosen types in place of the instance's, which are moved to asideDir.
 *
 * @param   {Object}    options
 * @param   {string}    options.dataDir
 * @param   {string}    options.stageDir    holds files/<path below dataDir>
 * @param   {string[]}  options.types
 * @param   {string}    options.asideDir    an empty folder (mode 700) on the same filesystem as dataDir, ideally
 * @returns {Promise<{ undo: () => Promise<void> }>}  on failure everything is moved back before it rejects
 */
const swapFiles = async ({ dataDir, stageDir, types, asideDir }) => {
	const swap = createSwap({ dataDir, stageDir, asideDir });
	try {
		for (const typeId of new Set(types)) {
			if (!Object.hasOwn(TYPES, typeId)) throw new BackupError("invalid-archive", `Unknown type ${typeId}`);
			await swap.swapType(TYPES[typeId].files);
		}
	} catch (error) {
		await swap.undo();
		throw error;
	}
	return { undo: swap.undo };
};

// name -> the archive file with the highest number, e.g. cert -> cert10.pem over cert9.pem
const newestArchiveFiles = (names) => {
	const newest = new Map();
	for (const name of names) {
		const match = ARCHIVE_FILE.exec(name);
		if (!(match && LIVE_NAMES.includes(match.groups.kind))) continue;
		const number = Number(match.groups.number);
		const current = newest.get(match.groups.kind);
		if (!current || number > current.number) newest.set(match.groups.kind, { number, name });
	}
	return newest;
};

/**
 * Recreates tls/certbot/live/npm-<id>/{cert,chain,fullchain,privkey}.pem as relative links to the newest archive
 * files of each certificate id with an archive folder, and removes the live folders of other ids.
 *
 * @param   {Object}              options
 * @param   {string}              options.dataDir
 * @param   {Array<number|string>} options.ids   the certificate ids that exist after the restore
 * @returns {Promise<void>}
 */
const relinkCertbotLive = async ({ dataDir, ids }) => {
	const live = path.join(dataDir, "tls/certbot/live");
	const archive = path.join(dataDir, "tls/certbot/archive");
	const wanted = new Set(ids.map(String).filter((id) => DIGITS.test(id)));
	for (const id of wanted) {
		const archiveDir = path.join(archive, `npm-${id}`);
		if (!(await exists(archiveDir))?.isDirectory()) continue;
		const newest = newestArchiveFiles(await readdir(archiveDir));
		const liveDir = path.join(live, `npm-${id}`);
		const info = await exists(liveDir);
		if (info && !info.isDirectory()) await rm(liveDir, { force: true });
		await mkdir(liveDir, { recursive: true, mode: 0o700 });
		for (const name of LIVE_NAMES) {
			const link = path.join(liveDir, `${name}.pem`);
			await rm(link, { recursive: true, force: true });
			const target = newest.get(name);
			if (target) await symlink(path.relative(liveDir, path.join(archiveDir, target.name)), link);
		}
	}
	if (!(await exists(live))?.isDirectory()) return;
	for (const name of await readdir(live)) {
		const match = LIVE_FOLDER.exec(name);
		if (match && !wanted.has(match.groups.id)) await rm(path.join(live, name), { recursive: true, force: true });
	}
};

export { relinkCertbotLive, swapFiles };
