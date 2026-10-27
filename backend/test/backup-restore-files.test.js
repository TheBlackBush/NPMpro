import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
	adminAvatarFiles,
	fitStagedAvatars,
	relinkCertbotLive,
	removeCachedGravatars,
	swapFiles,
} from "../lib/backup/restore-files.js";

const IN_THE_WAY = /crowdsec\/crowdsec\.conf is in the way/u;

const setup = async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "npmpro-restore-files-"));
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

const put = async (file, content, mode = 0o600) => {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content, { mode });
};

// every entry below dir: type, mode and content or link target
const snapshot = async (dir, base = dir) => {
	const out = {};
	for (const name of (await readdir(dir)).sort()) {
		const full = path.join(dir, name);
		const rel = path.relative(base, full);
		const info = await lstat(full);
		const mode = (info.mode % 0o1000).toString(8);
		if (info.isSymbolicLink()) out[rel] = `link ${await readlink(full)}`;
		else if (info.isDirectory()) {
			out[rel] = `dir ${mode}`;
			Object.assign(out, await snapshot(full, base));
		} else out[rel] = `file ${mode} ${await readFile(full, "utf8")}`;
	}
	return out;
};

it("swaps custom_nginx: the staged file goes in place, the old one aside, undo restores it exactly", async () => {
	const { root, dataDir, stageDir, asideDir } = await setup();
	await put(path.join(dataDir, "custom_nginx/http.conf"), "old http", 0o640);
	await put(path.join(dataDir, "custom_nginx/only-here.conf"), "instance only");
	await put(path.join(dataDir, "custom_nginx/sub/deep.conf"), "deep");
	await symlink("/etc/passwd", path.join(dataDir, "custom_nginx/link.conf"));
	await put(path.join(dataDir, "other/keep.txt"), "not a custom_nginx file");
	await put(path.join(stageDir, "files/custom_nginx/http.conf"), "new http", 0o644);
	await put(path.join(stageDir, "files/custom_nginx/new/server.conf"), "new server", 0o644);
	const before = await snapshot(dataDir);

	const { undo } = await swapFiles({ dataDir, stageDir, types: ["custom_nginx"], asideDir });
	const after = await snapshot(dataDir);
	assert.equal(after["custom_nginx/http.conf"], "file 640 new http");
	assert.equal(after["custom_nginx/new"], "dir 700");
	assert.equal(after["custom_nginx/new/server.conf"], "file 600 new server");
	assert.equal(after["custom_nginx/only-here.conf"], undefined);
	assert.equal(after["custom_nginx/link.conf"], undefined);
	assert.equal(after["custom_nginx/sub"], undefined);
	assert.equal(after["other/keep.txt"], before["other/keep.txt"]);
	assert.equal(await readFile(path.join(asideDir, "custom_nginx/http.conf"), "utf8"), "old http");
	assert.equal(await readlink(path.join(asideDir, "custom_nginx/link.conf")), "/etc/passwd");

	await undo();
	assert.deepEqual(await snapshot(dataDir), before);
	await rm(root, { recursive: true });
});

it("gives new files under public/html readable modes and moves a missing root's files in", async () => {
	const { root, dataDir, stageDir, asideDir } = await setup();
	await put(path.join(stageDir, "files/public/html/index.html"), "<p>hi</p>");
	const { undo } = await swapFiles({ dataDir, stageDir, types: ["settings_default_site"], asideDir });
	assert.equal(((await stat(path.join(dataDir, "public/html/index.html"))).mode % 0o1000).toString(8), "644");
	assert.equal(((await stat(path.join(dataDir, "public/html"))).mode % 0o1000).toString(8), "755");
	await undo();
	assert.deepEqual(await snapshot(dataDir), {});
	await rm(root, { recursive: true });
});

it("keeps the admin's picture files out of a users swap, also when undone", async () => {
	const { root, dataDir, stageDir, asideDir } = await setup();
	await put(path.join(dataDir, "public/avatar/1.png"), "admin", 0o644);
	await put(path.join(dataDir, "public/avatar/10.png"), "old ten", 0o644);
	await put(path.join(dataDir, "public/avatar/2.png"), "old two", 0o644);
	await put(path.join(stageDir, "files/public/avatar/1.jpg"), "backup one");
	await put(path.join(stageDir, "files/public/avatar/2.png"), "backup two");
	const before = await snapshot(dataDir);
	const { undo } = await swapFiles({ dataDir, stageDir, types: ["users"], asideDir, keep: adminAvatarFiles(1) });
	const after = await snapshot(dataDir);
	assert.equal(after["public/avatar/1.png"], "file 644 admin");
	assert.equal(after["public/avatar/1.jpg"], undefined);
	assert.equal(after["public/avatar/10.png"], undefined);
	assert.equal(after["public/avatar/2.png"], "file 644 backup two");
	await undo();
	assert.deepEqual(await snapshot(dataDir), before);
	await rm(root, { recursive: true });
});

it("renames the staged pictures of the moved user and drops the admin's and the skipped users'", async () => {
	const { root, stageDir } = await setup();
	const folder = path.join(stageDir, "files/public/avatar");
	for (const name of ["1.png", "1.jpg", "4.png", "7.png", "12.png", "15.gif"])
		await put(path.join(folder, name), name);
	await fitStagedAvatars({ stageDir, adminUserId: 1, users: { moved: { from: 1, to: 15 }, skippedIds: [4] } });
	assert.deepEqual((await readdir(folder)).sort(), ["12.png", "15.jpg", "15.png", "7.png"]);
	assert.equal(await readFile(path.join(folder, "15.png"), "utf8"), "1.png");
	await fitStagedAvatars({ stageDir, adminUserId: 7, users: { moved: null, skippedIds: [12] } });
	assert.deepEqual((await readdir(folder)).sort(), ["15.jpg", "15.png"]);
	await rm(path.join(stageDir, "files"), { recursive: true });
	await fitStagedAvatars({ stageDir, adminUserId: 1, users: { moved: null, skippedIds: [] } });
	await rm(root, { recursive: true });
});

it("keeps the moved user's picture when its new id is a skipped user's id", async () => {
	const { root, stageDir } = await setup();
	const folder = path.join(stageDir, "files/public/avatar");
	for (const name of ["1.png", "4.png", "9.png"]) await put(path.join(folder, name), name);
	await fitStagedAvatars({ stageDir, adminUserId: 1, users: { moved: { from: 1, to: 4 }, skippedIds: [4, 9] } });
	assert.deepEqual(await readdir(folder), ["4.png"]);
	assert.equal(await readFile(path.join(folder, "4.png"), "utf8"), "1.png");
	await rm(root, { recursive: true });
});

it("removes the cached Gravatar pictures of the given users only", async () => {
	const { root, dataDir } = await setup();
	await removeCachedGravatars({ dataDir, ids: [2] });
	for (const name of ["1.png", "2.png", "2.webp", "20.png"])
		await put(path.join(dataDir, "public/gravatar", name), "x");
	await removeCachedGravatars({ dataDir, ids: [2, 3] });
	assert.deepEqual((await readdir(path.join(dataDir, "public/gravatar"))).sort(), ["1.png", "20.png"]);
	await rm(root, { recursive: true });
});

it("swaps a single-file root and leaves the folder's other files alone", async () => {
	const { root, dataDir, stageDir, asideDir } = await setup();
	await put(path.join(dataDir, "crowdsec/crowdsec.conf"), "old key");
	await put(path.join(dataDir, "crowdsec/ban.html"), "old ban");
	await put(path.join(dataDir, "crowdsec/data.db"), "not in a backup");
	await put(path.join(stageDir, "files/crowdsec/crowdsec.conf"), "new key");
	const before = await snapshot(dataDir);
	const { undo } = await swapFiles({ dataDir, stageDir, types: ["crowdsec_files"], asideDir });
	const after = await snapshot(dataDir);
	assert.equal(after["crowdsec/crowdsec.conf"], "file 600 new key");
	assert.equal(after["crowdsec/ban.html"], undefined);
	assert.equal(after["crowdsec/data.db"], before["crowdsec/data.db"]);
	await undo();
	assert.deepEqual(await snapshot(dataDir), before);
	await rm(root, { recursive: true });
});

it("leaves certbot live folders in place and swaps the files certificates own", async () => {
	const { root, dataDir, stageDir, asideDir } = await setup();
	await put(path.join(dataDir, "tls/certbot/archive/npm-1/cert1.pem"), "old cert");
	await put(path.join(dataDir, "tls/certbot/live/npm-1.der"), "old der");
	await mkdir(path.join(dataDir, "tls/certbot/live/npm-1"), { recursive: true });
	await symlink("../../archive/npm-1/cert1.pem", path.join(dataDir, "tls/certbot/live/npm-1/cert.pem"));
	await put(path.join(stageDir, "files/tls/certbot/archive/npm-2/cert1.pem"), "new cert");
	const before = await snapshot(dataDir);
	const { undo } = await swapFiles({ dataDir, stageDir, types: ["certificates"], asideDir });
	const after = await snapshot(dataDir);
	assert.equal(after["tls/certbot/archive/npm-1"], undefined);
	assert.equal(after["tls/certbot/live/npm-1.der"], undefined);
	assert.equal(after["tls/certbot/live/npm-1/cert.pem"], "link ../../archive/npm-1/cert1.pem");
	assert.equal(after["tls/certbot/archive/npm-2/cert1.pem"], "file 600 new cert");
	await undo();
	assert.deepEqual(await snapshot(dataDir), before);
	await rm(root, { recursive: true });
});

it("moves everything back when placing a file fails", async () => {
	const { root, dataDir, stageDir, asideDir } = await setup();
	await put(path.join(dataDir, "custom_nginx/http.conf"), "old http");
	await put(path.join(dataDir, "crowdsec/ban.html"), "old ban");
	// a folder in the place of crowdsec.conf, holding a file no type takes, blocks the staged crowdsec.conf
	await put(path.join(dataDir, "crowdsec/crowdsec.conf/stray"), "stray");
	await put(path.join(stageDir, "files/custom_nginx/http.conf"), "new http");
	await put(path.join(stageDir, "files/custom_nginx/server.conf"), "new server");
	await put(path.join(stageDir, "files/crowdsec/crowdsec.conf"), "new key");
	const before = await snapshot(dataDir);
	await assert.rejects(
		swapFiles({ dataDir, stageDir, types: ["custom_nginx", "crowdsec_files"], asideDir }),
		IN_THE_WAY,
	);
	assert.deepEqual(await snapshot(dataDir), before);
	await rm(root, { recursive: true });
});

// another filesystem than the temporary folder, when the machine has one (/dev/shm is a tmpfs on Linux)
const shm = await stat("/dev/shm").catch(() => null);
const OTHER_DEVICE = shm?.isDirectory() && shm.dev !== (await stat(os.tmpdir())).dev ? "/dev/shm" : null;

it("moves files across filesystems by copying", { skip: OTHER_DEVICE ? false : "no second filesystem" }, async () => {
	const { root, dataDir, stageDir } = await setup();
	const asideDir = await mkdtemp(path.join(OTHER_DEVICE, "npmpro-aside-"));
	await put(path.join(dataDir, "custom_nginx/http.conf"), "old http", 0o640);
	await symlink("/etc/passwd", path.join(dataDir, "custom_nginx/link.conf"));
	await put(path.join(stageDir, "files/custom_nginx/http.conf"), "new http");
	const before = await snapshot(dataDir);
	const { undo } = await swapFiles({ dataDir, stageDir, types: ["custom_nginx"], asideDir });
	assert.equal(await readFile(path.join(asideDir, "custom_nginx/http.conf"), "utf8"), "old http");
	assert.equal(await readlink(path.join(asideDir, "custom_nginx/link.conf")), "/etc/passwd");
	await undo();
	assert.deepEqual(await snapshot(dataDir), before);
	await rm(asideDir, { recursive: true });
	await rm(root, { recursive: true });
});

it("relinks certbot live to the newest archive files and removes live folders of removed certificates", async () => {
	const { root, dataDir } = await setup();
	const archive = path.join(dataDir, "tls/certbot/archive/npm-3");
	for (const name of ["cert", "chain", "fullchain", "privkey"]) {
		await put(path.join(archive, `${name}1.pem`), `${name} 1`);
		await put(path.join(archive, `${name}2.pem`), `${name} 2`);
	}
	await put(path.join(archive, "cert10.pem"), "cert 10");
	await mkdir(path.join(dataDir, "tls/certbot/live/npm-3"), { recursive: true });
	await symlink("../../archive/npm-3/cert1.pem", path.join(dataDir, "tls/certbot/live/npm-3/cert.pem"));
	await mkdir(path.join(dataDir, "tls/certbot/live/npm-8"), { recursive: true });
	await symlink("../../archive/npm-8/cert1.pem", path.join(dataDir, "tls/certbot/live/npm-8/cert.pem"));
	await put(path.join(dataDir, "tls/certbot/live/npm-8.der"), "der");

	await relinkCertbotLive({ dataDir, ids: [3, 5] });
	const live = path.join(dataDir, "tls/certbot/live");
	assert.equal(await readlink(path.join(live, "npm-3/cert.pem")), "../../archive/npm-3/cert10.pem");
	assert.equal(await readlink(path.join(live, "npm-3/chain.pem")), "../../archive/npm-3/chain2.pem");
	assert.equal(await readlink(path.join(live, "npm-3/fullchain.pem")), "../../archive/npm-3/fullchain2.pem");
	assert.equal(await readFile(path.join(live, "npm-3/privkey.pem"), "utf8"), "privkey 2");
	assert.deepEqual((await readdir(live)).sort(), ["npm-3", "npm-8.der"]);
	await rm(root, { recursive: true });
});

it("relinks to cert2.pem when cert1.pem and cert2.pem exist", async () => {
	const { root, dataDir } = await setup();
	const archive = path.join(dataDir, "tls/certbot/archive/npm-1");
	await put(path.join(archive, "cert1.pem"), "1");
	await put(path.join(archive, "cert2.pem"), "2");
	await relinkCertbotLive({ dataDir, ids: [1] });
	assert.equal(
		await readlink(path.join(dataDir, "tls/certbot/live/npm-1/cert.pem")),
		"../../archive/npm-1/cert2.pem",
	);
	assert.deepEqual(await readdir(path.join(dataDir, "tls/certbot/live/npm-1")), ["cert.pem"]);
	await rm(root, { recursive: true });
});
