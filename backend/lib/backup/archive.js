import path from "node:path";
import { pipeline } from "node:stream/promises";
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
 * Extracts a backup's gzip tar into dir. Every entry is checked before it is written; the first bad one stops the
 * extraction with BackupError("invalid-archive") and destroys the source stream. An error coming from the source
 * itself (for example a BackupError from decryption) is passed on unchanged.
 */
const extractTo = async ({ source, dir, allow, limits = LIMITS }) => {
	let entries = 0;
	let bytes = 0;
	let refused = null;
	const extractor = extract({
		cwd: dir,
		strict: true,
		preservePaths: false,
		noMtime: true,
		preserveOwner: false,
		filter: (rawPath, entry) => {
			if (refused) {
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
				refused = new BackupError("invalid-archive", `Invalid backup archive: ${reason} (${rel})`);
				extractor.abort(refused);
				return false;
			}
			return true;
		},
	});
	try {
		await pipeline(source, extractor);
	} catch (err) {
		if (refused) {
			source.destroy?.();
			throw refused;
		}
		throw err instanceof BackupError
			? err
			: new BackupError("invalid-archive", "Invalid backup archive", { cause: err });
	}
	if (refused) {
		source.destroy?.();
		throw refused;
	}
	return { entries, bytes };
};

export { extractTo, LIMITS, packStage };
