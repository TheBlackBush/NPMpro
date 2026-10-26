import path from "node:path";
import { create, extract } from "tar";
import { BackupError } from "./format.js";

const LIMITS = { entries: 200_000, unpacked: 8 * 1024 ** 3 };
const TRAILING_SLASH = /\/$/u;
const DATA_FILE = /^data\/[a-z_]+\.json$/u;

const packStage = (stageDir) =>
	create({ gzip: true, cwd: stageDir, portable: true, follow: false }, ["manifest.json", "data", "files"]);

const checkPath = (rel, type, allow) => {
	if (
		rel === "" ||
		path.posix.isAbsolute(rel) ||
		rel.split("/").includes("..") ||
		path.posix.normalize(rel) !== rel
	) {
		return "path is not a plain relative path";
	}
	if (type !== "File" && type !== "Directory") {
		return `entry type ${type} is not allowed`;
	}
	if (type === "Directory") {
		return rel === "data" || rel === "files" || rel.startsWith("files/") ? null : "unexpected folder";
	}
	if (rel === "manifest.json" || DATA_FILE.test(rel)) {
		return null;
	}
	return rel.startsWith("files/") && allow(rel) ? null : "file outside the allowed folders";
};

/**
 * Extracts a backup's gzip tar into dir. Every entry is checked before it is written. The first bad entry (or an
 * error from the source or from tar) ends the extraction: nothing further is read from the source, the source is
 * destroyed, and entries tar had already accepted are finished (the one being written is cut short, later ones are
 * written as far as the data went). The promise settles only after tar is done writing, so once it has settled
 * nothing more is created or written in dir and the caller may remove dir. A bad entry rejects with
 * BackupError("invalid-archive"); an error from the source (for example a BackupError from decryption) is passed on
 * unchanged.
 */
const extractTo = async ({ source, dir, allow, limits = LIMITS }) => {
	let entries = 0;
	let bytes = 0;
	let failure = null;
	const extractor = extract({
		cwd: dir,
		strict: true,
		preservePaths: false,
		noMtime: true,
		preserveOwner: false,
		filter: (rawPath, entry) => {
			if (failure) {
				return false;
			}
			const rel = rawPath.replace(TRAILING_SLASH, "");
			entries += 1;
			bytes += entry.size ?? 0;
			let reason = checkPath(rel, entry.type, allow);
			if (!reason && entries > limits.entries) {
				reason = "too many entries";
			}
			if (!reason && bytes > limits.unpacked) {
				reason = "unpacked size too large";
			}
			if (reason) {
				failure = new BackupError("invalid-archive", `Invalid backup archive: ${reason} (${rel})`);
				queueMicrotask(halt);
				return false;
			}
			return true;
		},
	});

	let finished = false;
	let settle = () => undefined;
	const done = new Promise((resolve) => {
		settle = resolve;
	});
	// Stop reading, then let tar flush what it already accepted; 'finish' fires once all its writes have ended.
	function halt() {
		if (finished) {
			return;
		}
		finished = true;
		source.unpipe(extractor);
		source.destroy();
		extractor.end();
	}
	const fail = (err) => {
		failure ??=
			err instanceof BackupError
				? err
				: new BackupError("invalid-archive", "Invalid backup archive", { cause: err });
		halt();
	};
	source.on("error", fail);
	extractor.on("error", fail);
	extractor.on("finish", settle);
	extractor.on("close", settle);
	source.pipe(extractor);
	await done;
	if (failure) {
		throw failure;
	}
	return { entries, bytes };
};

export { extractTo, LIMITS, packStage };
