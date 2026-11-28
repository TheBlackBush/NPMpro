import { createWriteStream } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const TIMEOUT_MS = 60000;
const TIMEOUT_NAMES = new Set(["TimeoutError", "AbortError"]);

/** Failure with a fixed, safe message (no response bodies, no credentials) */
class UpdateError extends Error {}

const isTimeout = (err) => TIMEOUT_NAMES.has(err?.name);

/**
 * A pass-through stream that fails with an UpdateError(message) once more than maxBytes went through
 *
 * @param   {number}  maxBytes
 * @param   {string}  message
 * @returns {Transform}
 */
const byteLimit = (maxBytes, message) => {
	let seen = 0;
	return new Transform({
		transform(chunk, _encoding, callback) {
			seen += chunk.length;
			if (seen > maxBytes) callback(new UpdateError(message));
			else callback(null, chunk);
		},
	});
};

/** Streams the response body into file, failing when it exceeds maxBytes */
const saveBody = async (response, file, maxBytes) => {
	const declared = Number(response.headers.get("content-length"));
	if (declared > maxBytes) {
		await response.body?.cancel();
		throw new UpdateError("The download is too large");
	}
	await pipeline(
		Readable.fromWeb(response.body),
		byteLimit(maxBytes, "The download is too large"),
		createWriteStream(file),
	);
};

/** Removes work dirs left behind by an interrupted update */
const sweepLeftovers = async (dir) => {
	for (const entry of await readdir(dir)) {
		if (entry.startsWith(".update-")) await rm(path.join(dir, entry), { recursive: true, force: true });
	}
};

export { byteLimit, isTimeout, saveBody, sweepLeftovers, TIMEOUT_MS, UpdateError };
