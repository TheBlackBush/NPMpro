import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { create, Parser } from "tar";
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
 * Extracts a backup's gzip tar into dir. tar only parses; the files are written here, so this function knows exactly
 * which writes are in flight. Every entry is checked before anything is written for it. The first bad entry, an
 * error from the source or from tar, truncated input or a source that closes early ends the extraction: the source
 * is destroyed, no further entry is started and the file being written is cut short. The promise settles exactly
 * once, and only after every write it started has closed, so once it has settled nothing more is created or
 * written in dir and the caller may remove dir. A bad entry rejects with BackupError("invalid-archive"); an error
 * from the source (for example a BackupError from decryption) is passed on unchanged; any other error is wrapped
 * as invalid-archive.
 */
const extractTo = ({ source, dir, allow, limits = LIMITS }) =>
	new Promise((resolve, reject) => {
		const parser = new Parser({ strict: true });
		const writing = new Set();
		let entries = 0;
		let bytes = 0;
		let failure = null;
		let parsed = false;
		let sourceEnded = false;
		let settled = false;

		const maybeSettle = () => {
			if (settled || writing.size > 0 || !(failure || parsed)) {
				return;
			}
			settled = true;
			if (failure) {
				reject(failure);
			} else {
				resolve({ entries, bytes });
			}
		};
		const fail = (err) => {
			failure ??=
				err instanceof BackupError
					? err
					: new BackupError("invalid-archive", "Invalid backup archive", { cause: err });
			source.unpipe(parser);
			source.destroy?.();
			for (const item of writing) {
				item.destroy?.();
			}
			maybeSettle();
		};
		// Every started piece of filesystem work is tracked until it has finished and its file is closed.
		// destroy, when set, cuts a running write short.
		const track = async (work) => {
			const item = { destroy: null };
			writing.add(item);
			try {
				await work(item);
			} catch (err) {
				fail(err);
			} finally {
				writing.delete(item);
				maybeSettle();
			}
		};
		const writeFile = (entry, abs) =>
			void track(async (item) => {
				await mkdir(path.dirname(abs), { recursive: true, mode: 0o755 });
				if (failure) {
					entry.resume();
					return;
				}
				const out = createWriteStream(abs, { flags: "wx", mode: 0o644 });
				const closed = new Promise((done) => out.once("close", done));
				item.destroy = () => out.destroy();
				out.on("error", fail);
				entry.pipe(out);
				await closed;
			});

		parser.on("entry", (entry) => {
			if (failure) {
				entry.resume();
				return;
			}
			const rel = entry.path.replace(TRAILING_SLASH, "");
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
				entry.resume();
				fail(new BackupError("invalid-archive", `Invalid backup archive: ${reason} (${rel})`));
				return;
			}
			const abs = path.join(dir, rel);
			if (entry.type === "Directory") {
				entry.resume();
				void track(() => mkdir(abs, { recursive: true, mode: 0o755 }));
			} else {
				void writeFile(entry, abs);
			}
		});
		parser.on("error", fail);
		parser.on("end", () => {
			parsed = true;
			maybeSettle();
		});
		source.on("error", fail);
		source.on("end", () => {
			sourceEnded = true;
		});
		source.on("close", () => {
			if (!sourceEnded) {
				fail(new BackupError("invalid-archive", "Invalid backup archive: the data ended early"));
			}
		});
		source.pipe(parser);
	});

export { extractTo, LIMITS, packStage };
