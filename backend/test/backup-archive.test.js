import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { it } from "node:test";
import { gzipSync } from "node:zlib";
import { create, Header } from "tar";
import { extractTo, packStage } from "../lib/backup/archive.js";
import { BackupError } from "../lib/backup/format.js";

const tmp = (p) => mkdtemp(path.join(tmpdir(), p));
const allowFiles = (rel) => rel.startsWith("files/custom_nginx/");

const stage = async () => {
	const dir = await tmp("stage-");
	await writeFile(path.join(dir, "manifest.json"), "{}");
	await mkdir(path.join(dir, "data"));
	await writeFile(path.join(dir, "data", "proxy_hosts.json"), "[]");
	await mkdir(path.join(dir, "files", "custom_nginx"), { recursive: true });
	await writeFile(path.join(dir, "files", "custom_nginx", "http.conf"), "# x");
	return dir;
};

it("packs and extracts a stage", async () => {
	const out = await tmp("out-");
	const result = await extractTo({ source: packStage(await stage()), dir: out, allow: allowFiles });
	assert.equal(await readFile(path.join(out, "files", "custom_nginx", "http.conf"), "utf8"), "# x");
	assert.ok(result.entries >= 3);
});

const tarOf = async (build) => {
	const src = await tmp("src-");
	const entries = await build(src);
	return create({ gzip: true, cwd: src, portable: true }, entries);
};

it("refuses a symlink", async () => {
	const source = await tarOf(async (src) => {
		await mkdir(path.join(src, "files", "custom_nginx"), { recursive: true });
		await symlink("/etc/passwd", path.join(src, "files", "custom_nginx", "x.conf"));
		return ["files"];
	});
	await assert.rejects(
		extractTo({ source, dir: await tmp("out-"), allow: allowFiles }),
		(err) => err.code === "invalid-archive",
	);
});

it("refuses a path outside the allowlist", async () => {
	const source = await tarOf(async (src) => {
		await mkdir(path.join(src, "files", "npmpro"), { recursive: true });
		await writeFile(path.join(src, "files", "npmpro", "keys-ec.json"), "{}");
		return ["files"];
	});
	await assert.rejects(
		extractTo({ source, dir: await tmp("out-"), allow: allowFiles }),
		(err) => err.code === "invalid-archive",
	);
});

it("refuses a traversal path", async () => {
	// a hand-made archive with one entry named ../evil (tar.c cannot create one)
	const header = new Header({ path: "../evil", type: "File", size: 1, mode: 0o644, mtime: new Date(0) });
	header.encode();
	const body = Buffer.alloc(512);
	body.write("x");
	const source = Readable.from([gzipSync(Buffer.concat([header.block, body, Buffer.alloc(1024)]))]);
	await assert.rejects(
		extractTo({ source, dir: await tmp("out-"), allow: allowFiles }),
		(err) => err.code === "invalid-archive",
	);
});

it("stops at the entry limit", async () => {
	const source = packStage(await stage());
	await assert.rejects(
		extractTo({ source, dir: await tmp("out-"), allow: allowFiles, limits: { entries: 2, unpacked: 1e9 } }),
		(err) => err.code === "invalid-archive",
	);
});

it("stops at the size limit", async () => {
	const source = packStage(await stage());
	await assert.rejects(
		extractTo({ source, dir: await tmp("out-"), allow: allowFiles, limits: { entries: 100, unpacked: 2 } }),
		(err) => err.code === "invalid-archive",
	);
});

it("refuses a hard link", async () => {
	const header = new Header({
		path: "files/custom_nginx/h.conf",
		type: "Link",
		linkpath: "../../etc/passwd",
		mode: 0o644,
		mtime: new Date(0),
	});
	header.encode();
	const source = Readable.from([gzipSync(Buffer.concat([header.block, Buffer.alloc(1024)]))]);
	await assert.rejects(
		extractTo({ source, dir: await tmp("out-"), allow: allowFiles }),
		(err) => err.code === "invalid-archive",
	);
});

it("passes a source stream BackupError through and destroys the source on refusal", async () => {
	const wrong = new BackupError("wrong-passphrase", "x");
	const failing = new Readable({
		read() {
			this.destroy(wrong);
		},
	});
	await assert.rejects(
		extractTo({ source: failing, dir: await tmp("out-"), allow: allowFiles }),
		(err) => err === wrong,
	);

	const source = await tarOf(async (src) => {
		await writeFile(path.join(src, "evil.txt"), "x");
		return ["evil.txt"];
	});
	await assert.rejects(
		extractTo({ source, dir: await tmp("out-"), allow: allowFiles }),
		(err) => err.code === "invalid-archive",
	);
	assert.ok(source.destroyed);
});

const snapshot = async (dir) => {
	const out = {};
	const walk = async (rel) => {
		for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
			const r = path.join(rel, e.name);
			out[r] = e.isDirectory() ? -1 : (await stat(path.join(dir, r))).size;
			if (e.isDirectory()) {
				await walk(r);
			}
		}
	};
	await walk("");
	return out;
};

const entryBlock = (name, body) => {
	const header = new Header({ path: name, type: "File", size: body.length, mode: 0o644, mtime: new Date(0) });
	header.encode();
	const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
	body.copy(padded);
	return Buffer.concat([header.block, padded]);
};

it("writes nothing in dir after a refusal has settled", async () => {
	const big = randomBytes(32 * 1024 * 1024);
	const raw = Buffer.concat([
		entryBlock("files/custom_nginx/big.conf", big),
		entryBlock("files/custom_nginx/after1.conf", Buffer.from("x")),
		entryBlock("files/custom_nginx/after2.conf", Buffer.from("x")),
		entryBlock("evil.txt", Buffer.from("x")),
		Buffer.alloc(1024),
	]);
	const gz = gzipSync(raw);
	const chunks = [];
	for (let i = 0; i < gz.length; i += 1024 * 1024) {
		chunks.push(gz.subarray(i, i + 1024 * 1024));
	}
	const dir = await tmp("out-");
	await assert.rejects(
		extractTo({ source: Readable.from(chunks), dir, allow: allowFiles }),
		(err) => err.code === "invalid-archive",
	);
	const settled = await snapshot(dir);
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.deepEqual(await snapshot(dir), settled);
});
