import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { placeMergedFiles } from "../lib/backup/merge-files.js";

const setup = async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "npmpro-merge-files-"));
	const dirs = {
		root,
		dataDir: path.join(root, "data"),
		stageDir: path.join(root, "stage"),
		asideDir: path.join(root, "aside"),
	};
	await mkdir(dirs.dataDir);
	await mkdir(path.join(dirs.stageDir, "files"), { recursive: true });
	await mkdir(dirs.asideDir, { mode: 0o700 });
	return dirs;
};

const put = async (file, content) => {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content);
};

const has = (file) =>
	lstat(file).then(
		() => true,
		() => false,
	);

const KEPT_LINE = /archive\/npm-33$/mu;

const RENEWAL = [
	"archive_dir = /data/tls/certbot/archive/npm-3",
	"cert = /data/tls/certbot/live/npm-3/cert.pem",
	"other = /data/tls/certbot/archive/npm-33",
	"",
].join("\n");

const options = (dirs, extra = {}) => ({
	dataDir: dirs.dataDir,
	stageDir: dirs.stageDir,
	asideDir: dirs.asideDir,
	certificateMoves: [],
	takeFiles: [],
	takeDefaultSite: false,
	...extra,
});

it("places certificate files under the new id and rewrites the renewal conf", async () => {
	const dirs = await setup();
	try {
		const staged = (rel) => path.join(dirs.stageDir, "files", rel);
		await put(staged("tls/certbot/archive/npm-3/cert1.pem"), "cert");
		await put(staged("tls/certbot/renewal/npm-3.conf"), RENEWAL);
		await put(staged("tls/custom/npm-3/fullchain.pem"), "full");
		await put(staged("tls/custom/npm-3.der"), "der");
		await put(staged("tls/mtls/npm-3.pem"), "mtls");
		await put(staged("tls/certbot/live/npm-3.der"), "live");
		const placed = await placeMergedFiles(options(dirs, { certificateMoves: [{ from: 3, to: 12 }] }));
		const data = (rel) => path.join(dirs.dataDir, rel);
		assert.equal(await readFile(data("tls/certbot/archive/npm-12/cert1.pem"), "utf8"), "cert");
		const conf = await readFile(data("tls/certbot/renewal/npm-12.conf"), "utf8");
		assert.equal(
			conf,
			RENEWAL.replace("archive/npm-3\n", "archive/npm-12\n").replace("live/npm-3/", "live/npm-12/"),
		);
		assert.match(conf, KEPT_LINE);
		for (const rel of ["tls/custom/npm-12/fullchain.pem", "tls/custom/npm-12.der", "tls/mtls/npm-12.pem"]) {
			assert.ok(await has(data(rel)), rel);
		}
		assert.ok(await has(data("tls/certbot/live/npm-12.der")));
		assert.equal((await stat(data("tls/mtls/npm-12.pem"))).mode % 0o1000, 0o600);
		assert.equal((await stat(data("tls/custom/npm-12"))).mode % 0o1000, 0o700);
		await placed.undo();
		assert.deepEqual(await readdir(dirs.dataDir), []);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("copies account files only when the instance lacks them", async () => {
	const dirs = await setup();
	try {
		const acc = "tls/certbot/accounts/acme/dir/abc";
		await put(path.join(dirs.stageDir, "files", acc, "regr.json"), "backup regr");
		await put(path.join(dirs.stageDir, "files", acc, "meta.json"), "backup meta");
		await put(path.join(dirs.dataDir, acc, "regr.json"), "instance regr");
		const placed = await placeMergedFiles(options(dirs));
		assert.equal(await readFile(path.join(dirs.dataDir, acc, "regr.json"), "utf8"), "instance regr");
		assert.equal(await readFile(path.join(dirs.dataDir, acc, "meta.json"), "utf8"), "backup meta");
		await placed.undo();
		assert.equal(await readFile(path.join(dirs.dataDir, acc, "regr.json"), "utf8"), "instance regr");
		assert.equal(await has(path.join(dirs.dataDir, acc, "meta.json")), false);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("takes chosen custom files, leaves the others, and undo restores", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/custom_nginx/http.conf"), "new http");
		await put(path.join(dirs.stageDir, "files/custom_nginx/server.conf"), "new server");
		await put(path.join(dirs.dataDir, "custom_nginx/http.conf"), "old http");
		await put(path.join(dirs.dataDir, "custom_nginx/server.conf"), "old server");
		const placed = await placeMergedFiles(
			options(dirs, { takeFiles: ["custom_nginx/http.conf"], certificateMoves: [{ from: 3, to: 12 }] }),
		);
		assert.equal(await readFile(path.join(dirs.dataDir, "custom_nginx/http.conf"), "utf8"), "new http");
		assert.equal(await readFile(path.join(dirs.dataDir, "custom_nginx/server.conf"), "utf8"), "old server");
		await placed.undo();
		assert.equal(await readFile(path.join(dirs.dataDir, "custom_nginx/http.conf"), "utf8"), "old http");
		assert.equal(await has(path.join(dirs.dataDir, "tls/certbot/archive/npm-12")), false);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("takes the default site and undo brings the old one back", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/public/html/index.html"), "new site");
		await put(path.join(dirs.dataDir, "public/html/index.html"), "old site");
		const placed = await placeMergedFiles(options(dirs, { takeDefaultSite: true }));
		assert.equal(await readFile(path.join(dirs.dataDir, "public/html/index.html"), "utf8"), "new site");
		await placed.undo();
		assert.equal(await readFile(path.join(dirs.dataDir, "public/html/index.html"), "utf8"), "old site");
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("places an added user's picture under its new id", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/public/avatar/2.png"), "pic");
		const placed = await placeMergedFiles(options(dirs, { avatarMoves: [{ from: 2, to: 7 }] }));
		const file = path.join(dirs.dataDir, "public/avatar/7.png");
		assert.equal(await readFile(file, "utf8"), "pic");
		assert.equal((await stat(file)).mode % 0o1000, 0o644);
		await placed.undo();
		assert.equal(await has(file), false);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("moves a replaced user's old picture aside and undo brings it back", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/public/avatar/5.png"), "new");
		await put(path.join(dirs.dataDir, "public/avatar/5.jpg"), "old");
		const placed = await placeMergedFiles(options(dirs, { avatarMoves: [{ from: 5, to: 5 }] }));
		const avatar = (name) => path.join(dirs.dataDir, "public/avatar", name);
		assert.equal(await has(avatar("5.jpg")), false);
		assert.equal(await readFile(avatar("5.png"), "utf8"), "new");
		await placed.undo();
		assert.equal(await readFile(avatar("5.jpg"), "utf8"), "old");
		assert.equal(await has(avatar("5.png")), false);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("changes nothing for a move without a staged picture", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.dataDir, "public/avatar/5.jpg"), "old");
		const placed = await placeMergedFiles(options(dirs, { avatarMoves: [{ from: 5, to: 5 }] }));
		assert.equal(await readFile(path.join(dirs.dataDir, "public/avatar/5.jpg"), "utf8"), "old");
		await placed.undo();
		assert.deepEqual(await readdir(path.join(dirs.dataDir, "public/avatar")), ["5.jpg"]);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});
