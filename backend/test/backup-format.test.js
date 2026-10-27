import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { it } from "node:test";
import { BackupError, openBackupFile, readHeader, writeBackupFile } from "../lib/backup/format.js";

const dir = () => mkdtemp(path.join(tmpdir(), "backup-format-"));
const summary = {
	format: 1,
	types: ["proxy_hosts"],
	counts: { proxy_hosts: 2 },
	created_at: "2026-10-26T10:00:00Z",
	npmpro_version: "1.0.0",
};
const payload = Buffer.from("gzip tar bytes ".repeat(1000));
const pass = "correct horse battery";
const SOURCE_FAILED = /source failed/u;

it("round-trips with a passphrase and exposes the summary without it", async () => {
	const file = path.join(await dir(), "a.npmpro");
	await writeBackupFile({ source: Readable.from([payload]), file, mode: "passphrase", passphrase: pass, summary });
	const { header } = await readHeader(file);
	assert.equal(header.kdf, "scrypt");
	assert.deepEqual(header.summary, summary);
	const out = await buffer(await openBackupFile({ file, passphrase: pass }));
	assert.deepEqual(out, payload);
});

it("refuses a wrong passphrase", async () => {
	const file = path.join(await dir(), "a.npmpro");
	await writeBackupFile({ source: Readable.from([payload]), file, mode: "passphrase", passphrase: pass, summary });
	await assert.rejects(
		buffer(await openBackupFile({ file, passphrase: "wrong horse battery" })),
		(err) =>
			err instanceof BackupError &&
			err.code === "wrong-passphrase" &&
			err.message_i18n === "backup.error.wrong-passphrase",
	);
});

it("detects a changed summary (header is authenticated)", async () => {
	const file = path.join(await dir(), "a.npmpro");
	await writeBackupFile({ source: Readable.from([payload]), file, mode: "passphrase", passphrase: pass, summary });
	const bytes = await readFile(file);
	const at = bytes.indexOf(Buffer.from("proxy_hosts"));
	bytes[at] = "P".charCodeAt(0);
	await writeFile(file, bytes);
	await assert.rejects(
		buffer(await openBackupFile({ file, passphrase: pass })),
		(err) => err.code === "wrong-passphrase",
	);
});

it("detects a flipped ciphertext byte and a truncated file", async () => {
	const file = path.join(await dir(), "a.npmpro");
	await writeBackupFile({ source: Readable.from([payload]), file, mode: "passphrase", passphrase: pass, summary });
	const bytes = await readFile(file);
	const flipped = Buffer.from(bytes);
	flipped[flipped.length - 100] += 1;
	await writeFile(file, flipped);
	await assert.rejects(
		buffer(await openBackupFile({ file, passphrase: pass })),
		(err) => err.code === "wrong-passphrase",
	);
	await writeFile(file, bytes.subarray(0, bytes.length - 40));
	await assert.rejects(
		buffer(await openBackupFile({ file, passphrase: pass })),
		(err) => err.code === "wrong-passphrase",
	);
});

it("writes and reads an unencrypted file", async () => {
	const file = path.join(await dir(), "a.npmpro");
	await writeBackupFile({ source: Readable.from([payload]), file, mode: "none", summary });
	assert.equal((await readHeader(file)).header.kdf, "none");
	assert.deepEqual(await buffer(await openBackupFile({ file })), payload);
});

it("instance mode needs the same instance key", async () => {
	const file = path.join(await dir(), "a.npmpro");
	const key = Buffer.alloc(32, 7);
	await writeBackupFile({ source: Readable.from([payload]), file, mode: "instance", instanceKey: key, summary });
	assert.deepEqual(await buffer(await openBackupFile({ file, instanceKey: key })), payload);
	await assert.rejects(
		buffer(await openBackupFile({ file, instanceKey: Buffer.alloc(32, 8) })),
		(err) => err.code === "wrong-passphrase",
	);
});

it("refuses a file without the magic", async () => {
	const file = path.join(await dir(), "x.npmpro");
	await writeFile(file, "PK\u0003\u0004 not a backup");
	await assert.rejects(readHeader(file), (err) => err.code === "not-a-backup");
});

it("asks for a passphrase when the file needs one", async () => {
	const file = path.join(await dir(), "a.npmpro");
	await writeBackupFile({ source: Readable.from([payload]), file, mode: "passphrase", passphrase: pass, summary });
	await assert.rejects(openBackupFile({ file }), (err) => err.code === "wrong-passphrase");
});

it("leaves no partial file when the source fails", async () => {
	const folder = await dir();
	const file = path.join(folder, "a.npmpro");
	const failing = () =>
		Readable.from(
			(function* () {
				yield payload;
				throw new Error("source failed");
			})(),
		);
	for (const mode of ["none", "instance"]) {
		await assert.rejects(
			writeBackupFile({ source: failing(), file, mode, instanceKey: Buffer.alloc(32, 1), summary }),
			SOURCE_FAILED,
		);
	}
	assert.deepEqual(await readdir(folder), []);
});

it("leaves no partial file when the target folder is missing", async () => {
	const folder = await dir();
	const file = path.join(folder, "missing", "a.npmpro");
	await assert.rejects(writeBackupFile({ source: Readable.from([payload]), file, mode: "none", summary }));
	assert.deepEqual(await readdir(folder), []);
});

const MAGIC = Buffer.from("NPMPROBK");
const craft = async (header) => {
	const file = path.join(await dir(), "crafted.npmpro");
	const json = Buffer.from(JSON.stringify(header));
	const length = Buffer.alloc(4);
	length.writeUInt32BE(json.length);
	await writeFile(file, Buffer.concat([MAGIC, length, json, Buffer.alloc(64)]));
	return file;
};
const good = {
	v: 1,
	kdf: "scrypt",
	N: 131072,
	r: 8,
	p: 1,
	salt: Buffer.alloc(16).toString("base64"),
	iv: Buffer.alloc(12).toString("base64"),
	summary,
};
const notABackup = (err) => err.code === "not-a-backup";

it("refuses scrypt cost parameters other than the fixed ones", async () => {
	for (const cost of [{ N: 2 ** 22, r: 64 }, { p: 2 }, { N: 1024 }]) {
		await assert.rejects(readHeader(await craft({ ...good, ...cost })), notABackup);
	}
	const file = await craft({ ...good, N: 2 ** 22 });
	await assert.rejects(openBackupFile({ file, passphrase: pass }), notABackup);
});

it("refuses a missing salt and a short iv", async () => {
	await assert.rejects(
		readHeader(await craft({ ...good, kdf: "instance", N: undefined, salt: undefined })),
		notABackup,
	);
	await assert.rejects(readHeader(await craft({ ...good, iv: Buffer.alloc(8).toString("base64") })), notABackup);
	await assert.rejects(readHeader(await craft({ ...good, salt: Buffer.alloc(4).toString("base64") })), notABackup);
});

it("releases the file when the returned stream is destroyed early", async () => {
	const big = randomBytes(1024 * 1024);
	const fds = async () => (await readdir("/proc/self/fd")).length;
	for (const mode of ["passphrase", "none"]) {
		const file = path.join(await dir(), "big.npmpro");
		await writeBackupFile({ source: Readable.from([big]), file, mode, passphrase: pass, summary });
		const before = await fds();
		for (let i = 0; i < 10; i++) {
			const stream = await openBackupFile({ file, passphrase: pass });
			await new Promise((resolve) => stream.once("data", resolve));
			stream.destroy();
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.ok((await fds()) <= before + 1, `${mode}: file descriptors leaked`);
	}
});
