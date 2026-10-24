import { open, stat } from "node:fs/promises";

const NEWLINE = 0x0a;

/**
 * Follows a log file that is rotated with copytruncate.
 *
 * The returned state is `{ inode, offset }` where `offset` is the byte position of the first byte that was not
 * handed out as a complete line, i.e. the start of a trailing partial line. Nothing else is kept in memory between
 * reads except a flag for a line that is being skipped, so a restart from a saved state loses nothing: the partial
 * line is simply read again. Lines are cut on the newline byte before decoding, so a multi-byte UTF-8 character
 * split across a chunk boundary is never corrupted.
 *
 * Result of read(): `{ lines, state, missing, dropped }`. `dropped` counts lines longer than `maxChunk` that were
 * discarded (their bytes are skipped up to the next newline).
 *
 * Known limitation: rotation is detected by an inode change or by a size smaller than the saved offset. If the file
 * is truncated and refilled beyond the old offset between two reads, the size is not smaller and the new content
 * cannot be told apart from old content cheaply, so the bytes before the old offset are missed and the read
 * continues at a mid-file position (a broken first line is then skipped by the parser).
 */
export const createLogReader = ({ path, state, maxChunk = 64 * 1024 * 1024 }) => {
	let current = state ? { inode: state.inode, offset: state.offset } : null;
	let skipping = false;

	const read = async () => {
		let st;
		try {
			st = await stat(path);
		} catch (err) {
			if (err.code === "ENOENT" || err.code === "ENOTDIR") {
				return { lines: [], state: null, missing: true };
			}
			throw err;
		}

		const inode = Number(st.ino);
		if (!current || current.inode !== inode || st.size < current.offset) {
			current = { inode, offset: 0 };
			skipping = false;
		}

		const length = Math.min(maxChunk, st.size - current.offset);
		if (length <= 0) {
			return { lines: [], state: { ...current }, missing: false, dropped: 0 };
		}

		const handle = await open(path, "r");
		let buf;
		try {
			const target = Buffer.alloc(length);
			const { bytesRead } = await handle.read(target, 0, length, current.offset);
			buf = target.subarray(0, bytesRead);
		} finally {
			await handle.close();
		}

		let consumed = 0;
		let dropped = 0;

		if (skipping) {
			const nl = buf.indexOf(NEWLINE);
			if (nl === -1) {
				current.offset += buf.length;
				return { lines: [], state: { ...current }, missing: false, dropped };
			}
			skipping = false;
			consumed = nl + 1;
		}

		const rest = buf.subarray(consumed);
		const last = rest.lastIndexOf(NEWLINE);
		const lines = [];
		if (last !== -1) {
			for (const raw of rest.subarray(0, last).toString("utf8").split("\n")) {
				lines.push(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
			}
			consumed += last + 1;
		} else if (rest.length > 0 && length === maxChunk) {
			// A full chunk without a newline: the line is longer than maxChunk. Drop it instead of growing forever.
			dropped = 1;
			skipping = true;
			consumed += rest.length;
		}

		current.offset += consumed;
		return { lines, state: { ...current }, missing: false, dropped };
	};

	return { read };
};
