import assert from "node:assert/strict";
import { appendFile, mkdtemp, rename, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { createLogReader } from "../lib/traffic/log-reader.js";

const tmpLog = async () => path.join(await mkdtemp(path.join(tmpdir(), "alog-")), "access.log");

it("returns new complete lines and keeps a partial last line for the next read", async () => {
	const file = await tmpLog();
	await writeFile(file, "a\nb\npart");
	const r = createLogReader({ path: file, state: null });
	assert.deepEqual((await r.read()).lines, ["a", "b"]);
	await appendFile(file, "ial\nc\n");
	assert.deepEqual((await r.read()).lines, ["partial", "c"]);
});

it("continues from a saved state", async () => {
	const file = await tmpLog();
	await writeFile(file, "a\nb\n");
	const first = await createLogReader({ path: file, state: null }).read();
	await appendFile(file, "c\n");
	assert.deepEqual((await createLogReader({ path: file, state: first.state }).read()).lines, ["c"]);
});

it("saves the offset at the start of a partial line so a restart re-reads it", async () => {
	const file = await tmpLog();
	await writeFile(file, "a\nb\npart");
	const first = await createLogReader({ path: file, state: null }).read();
	assert.equal(first.state.offset, 4);
	await appendFile(file, "ial\n");
	assert.deepEqual((await createLogReader({ path: file, state: first.state }).read()).lines, ["partial"]);
});

it("restarts at 0 after copytruncate", async () => {
	const file = await tmpLog();
	await writeFile(file, "a\nb\n");
	const r = createLogReader({ path: file, state: null });
	await r.read();
	await truncate(file, 0);
	await appendFile(file, "x\n");
	assert.deepEqual((await r.read()).lines, ["x"]);
});

it("restarts at 0 for a new file (new inode)", async () => {
	const file = await tmpLog();
	await writeFile(file, "a\n");
	const r = createLogReader({ path: file, state: null });
	await r.read();
	await rename(file, `${file}.1`);
	await writeFile(file, "new\n");
	assert.deepEqual((await r.read()).lines, ["new"]);
});

it("reads in bounded chunks", async () => {
	const file = await tmpLog();
	await writeFile(file, `${"x".repeat(9)}\n`.repeat(10));
	const r = createLogReader({ path: file, state: null, maxChunk: 25 });
	const counts = [];
	for (let i = 0; i < 5; i++) counts.push((await r.read()).lines.length);
	assert.equal(
		counts.reduce((s, n) => s + n, 0),
		10,
	);
	assert.ok(counts.every((n) => n <= 3));
});

it("does not corrupt a multi-byte character split across a chunk boundary", async () => {
	const file = await tmpLog();
	// "aé\n" is 4 bytes; with maxChunk 2 the chunk ends inside the two-byte "é". Emoji is 4 bytes.
	await writeFile(file, "aé\n😀b\n");
	const r = createLogReader({ path: file, state: null, maxChunk: 7 });
	const lines = [];
	for (let i = 0; i < 6; i++) lines.push(...(await r.read()).lines);
	assert.deepEqual(lines, ["aé", "😀b"]);
	const r2 = createLogReader({ path: file, state: null, maxChunk: 3 });
	const lines2 = [];
	let dropped = 0;
	for (let i = 0; i < 10; i++) {
		const res = await r2.read();
		lines2.push(...res.lines);
		dropped += res.dropped;
	}
	assert.ok(lines2.every((l) => !l.includes("\uFFFD")));
	assert.ok(dropped > 0);
});

it("advances the offset by bytes", async () => {
	const file = await tmpLog();
	await writeFile(file, "é😀\n");
	const res = await createLogReader({ path: file, state: null }).read();
	assert.deepEqual(res.lines, ["é😀"]);
	assert.equal(res.state.offset, 7);
});

it("drops a line longer than maxChunk and resumes at the next line", async () => {
	const file = await tmpLog();
	await writeFile(file, `${"y".repeat(50)}\nok\n`);
	const r = createLogReader({ path: file, state: null, maxChunk: 20 });
	const lines = [];
	let dropped = 0;
	for (let i = 0; i < 6; i++) {
		const res = await r.read();
		lines.push(...res.lines);
		dropped += res.dropped;
	}
	assert.deepEqual(lines, ["ok"]);
	assert.equal(dropped, 1);
});

it("strips carriage returns", async () => {
	const file = await tmpLog();
	await writeFile(file, "a\r\nb\n");
	assert.deepEqual((await createLogReader({ path: file, state: null }).read()).lines, ["a", "b"]);
});

it("reports a missing file", async () => {
	const r = createLogReader({ path: path.join(tmpdir(), "does-not-exist", "a.log"), state: null });
	assert.deepEqual(await r.read(), { lines: [], state: null, missing: true });
});
