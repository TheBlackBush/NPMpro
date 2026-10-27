import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { writeBackupFile } from "../lib/backup/format.js";
import { createBackupStore } from "../lib/backup/store.js";

const summary = { format: 1, types: [], counts: {}, created_at: "2026-10-26T10:00:00Z", npmpro_version: "1.0.0" };
const make = async (extra = {}) => {
	const dir = path.join(await mkdtemp(path.join(tmpdir(), "backup-store-")), "backups");
	await mkdir(path.join(dir, "auto"), { recursive: true });
	const time = { value: 1_000_000 };
	const store = createBackupStore({ dir, clock: { now: () => time.value }, ...extra });
	return { dir, time, store };
};
const exists = (file) =>
	stat(file).then(
		() => true,
		() => false,
	);
const code = (expected, status) => (err) => err.code === expected && (status === undefined || err.status === status);

it("accepts valid names and refuses the rest", async () => {
	const { store } = await make();
	for (const ok of [
		"npmpro-backup-host-20261026-101500.npmpro",
		"npmpro-backup-host-20261026-101500-auto.npmpro",
		"npmpro-backup-host-20261026-101500-2.npmpro",
		"npmpro-backup-host-20261026-101500-12-auto.npmpro",
	]) {
		assert.ok(store.NAME.test(ok), ok);
	}
	for (const bad of ["../x", "npmpro-backup-x.npmpro", "npmpro-backup-host-20261026-101500.npmpro/../a"]) {
		assert.ok(!store.NAME.test(bad), bad);
		assert.throws(() => store.pathOf(bad), code("not-a-backup", 404));
	}
});

it("fileName uses local time and a safe host", async () => {
	const { store } = await make();
	const date = new Date(2026, 9, 26, 10, 15, 0);
	assert.equal(store.fileName({ host: "My Host.local", date }), "npmpro-backup-my-host-local-20261026-101500.npmpro");
	assert.equal(store.fileName({ host: "", date, auto: true }), "npmpro-backup-npmpro-20261026-101500-auto.npmpro");
	assert.ok(store.NAME.test(store.fileName({ host: "!!!", date })));
});

it("pathOf stays in dir or dir/auto", async () => {
	const { dir, store } = await make();
	assert.equal(
		store.pathOf("npmpro-backup-h-20261026-101500.npmpro"),
		path.join(dir, "npmpro-backup-h-20261026-101500.npmpro"),
	);
	assert.equal(
		store.pathOf("npmpro-backup-h-20261026-101500-auto.npmpro"),
		path.join(dir, "auto", "npmpro-backup-h-20261026-101500-auto.npmpro"),
	);
	assert.throws(() => store.pathOf("auto/../../etc/passwd"), code("not-a-backup", 404));
	assert.throws(() => store.pathOf(undefined), code("not-a-backup", 404));
});

it("uniqueName adds -2, -3 before -auto and matches NAME", async () => {
	const { store } = await make();
	const base = "npmpro-backup-h-20261026-101500.npmpro";
	assert.equal(store.uniqueName(base), base);
	await writeFile(store.pathOf(base), "x");
	assert.equal(store.uniqueName(base), "npmpro-backup-h-20261026-101500-2.npmpro");
	await writeFile(store.pathOf("npmpro-backup-h-20261026-101500-2.npmpro"), "x");
	assert.equal(store.uniqueName(base), "npmpro-backup-h-20261026-101500-3.npmpro");
	const auto = "npmpro-backup-h-20261026-101500-auto.npmpro";
	await writeFile(store.pathOf(auto), "x");
	const next = store.uniqueName(auto);
	assert.equal(next, "npmpro-backup-h-20261026-101500-2-auto.npmpro");
	assert.ok(store.NAME.test(next));
});

it("uniqueName keeps a free numbered name and renumbers a taken one", async () => {
	const { store } = await make();
	const numbered = "npmpro-backup-h-20261026-101500-2.npmpro";
	assert.equal(store.uniqueName(numbered), numbered);
	await writeFile(store.pathOf(numbered), "x");
	assert.equal(store.uniqueName(numbered), "npmpro-backup-h-20261026-101500-3.npmpro");
	const auto = "npmpro-backup-h-20261026-101500-12-auto.npmpro";
	assert.equal(store.uniqueName(auto), auto);
	await writeFile(store.pathOf(auto), "x");
	assert.equal(store.uniqueName(auto), "npmpro-backup-h-20261026-101500-2-auto.npmpro");
});

it("list reads headers, flags unreadable files and sorts newest first", async () => {
	const { dir, store } = await make();
	const plain = "npmpro-backup-h-20261026-101500.npmpro";
	const bad = "npmpro-backup-h-20261026-111500.npmpro";
	const auto = "npmpro-backup-h-20261026-121500-auto.npmpro";
	await writeBackupFile({
		source: Readable.from([Buffer.from("a")]),
		file: path.join(dir, plain),
		mode: "none",
		summary,
	});
	await writeFile(path.join(dir, bad), "garbage");
	await writeFile(path.join(dir, "other.txt"), "x");
	await writeFile(store.pathOf(auto), "garbage");
	await utimes(path.join(dir, plain), 100, 100);
	await utimes(path.join(dir, bad), 200, 200);
	await utimes(store.pathOf(auto), 300, 300);
	const items = await store.list();
	assert.deepEqual(
		items.map((item) => item.name),
		[auto, bad, plain],
	);
	assert.equal(items.find((item) => item.name === bad).summary, null);
	assert.deepEqual(items.find((item) => item.name === plain).summary, summary);
	assert.equal(items.find((item) => item.name === plain).encrypted, false);
	assert.equal(items.find((item) => item.name === auto).auto, true);
});

it("pruneAuto keeps the newest 5 of 7", async () => {
	const { store } = await make();
	const names = [];
	for (let i = 1; i <= 7; i++) {
		const name = `npmpro-backup-h-2026102${i}-101500-auto.npmpro`;
		names.push(name);
		await writeFile(store.pathOf(name), "x");
		await utimes(store.pathOf(name), i * 100, i * 100);
	}
	await store.pruneAuto();
	assert.deepEqual((await store.list()).map((item) => item.name).sort(), names.slice(2).sort());
});

it("remove deletes a backup and 404s for a missing one", async () => {
	const { store } = await make();
	const name = "npmpro-backup-h-20261026-101500.npmpro";
	await writeFile(store.pathOf(name), "x");
	await store.remove(name);
	assert.equal(await exists(store.pathOf(name)), false);
	await assert.rejects(store.remove(name), code("not-a-backup", 404));
});

it("withLock rejects busy while pending and works again after", async () => {
	const { store } = await make();
	let release;
	const first = store.withLock(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	await assert.rejects(
		store.withLock(async () => 1),
		code("busy", 409),
	);
	release("done");
	assert.equal(await first, "done");
	assert.equal(await store.withLock(async () => 2), 2);
	await assert.rejects(
		store.withLock(async () => {
			throw new Error("boom");
		}),
		/boom/u,
	);
	assert.equal(await store.withLock(async () => 3), 3);
});

it("tokens expire, are replaced and drop their stage", async () => {
	const { time, store } = await make({ tokenTtlMs: 1000 });
	const stage1 = await store.createStageDir("restore");
	assert.equal((await stat(stage1)).mode & 0o777, 0o700);
	const t1 = store.createToken({ stageDir: stage1, file: "f", manifest: {}, owner: 1 });
	assert.equal(store.takeToken(t1, { owner: 1 }).file, "f");
	assert.equal(store.takeToken(t1, { owner: 1 }).file, "f");
	const stage2 = await store.createStageDir("restore");
	const t2 = store.createToken({ stageDir: stage2, file: "g", manifest: {}, owner: 1 });
	assert.equal(await exists(stage1), false);
	assert.throws(() => store.takeToken(t1, { owner: 1 }), code("token-expired"));
	time.value += 999;
	assert.equal(store.takeToken(t2, { keep: false, owner: 1 }).file, "g");
	assert.equal(await exists(stage2), true);
	assert.throws(() => store.takeToken(t2, { owner: 1 }), code("token-expired"));
	const stage3 = await store.createStageDir("restore");
	const t3 = store.createToken({ stageDir: stage3, file: "h", manifest: {}, owner: 1 });
	time.value += 1000;
	assert.throws(() => store.takeToken(t3, { owner: 1 }), code("token-expired"));
	assert.equal(await exists(stage3), false);
	const stage4 = await store.createStageDir("restore");
	const t4 = store.createToken({ stageDir: stage4, file: "i", manifest: {}, owner: 1 });
	store.dropToken(t4);
	assert.equal(await exists(stage4), false);
	assert.throws(() => store.takeToken("nope", { owner: 1 }), code("token-expired"));
});

it("removes a token's stage when the token expires unused, and not after it was taken", async () => {
	const { store } = await make({ tokenTtlMs: 30 });
	const stage1 = await store.createStageDir("restore");
	const t1 = store.createToken({ stageDir: stage1, file: "f", manifest: {}, owner: 1 });
	await sleep(100);
	assert.equal(await exists(stage1), false);
	assert.throws(() => store.takeToken(t1, { owner: 1 }), code("token-expired"));
	const stage2 = await store.createStageDir("restore");
	const t2 = store.createToken({ stageDir: stage2, file: "g", manifest: {}, owner: 1 });
	assert.equal(store.takeToken(t2, { keep: false, owner: 1 }).file, "g");
	const stage3 = await store.createStageDir("restore");
	store.createToken({ stageDir: stage3, file: "h", manifest: {}, owner: 1 });
	await sleep(100);
	assert.equal(await exists(stage2), true);
	assert.equal(await exists(stage3), false);
});

it("logs a stage that cannot be removed instead of throwing", async () => {
	const warnings = [];
	const { dir, store } = await make({ tokenTtlMs: 30, logger: { warn: (...args) => warnings.push(args) } });
	// rmSync refuses a path with a NUL byte on every Node version, like a stage the process may not delete
	const stageDir = path.join(dir, "bad\0stage");
	const t1 = store.createToken({ stageDir, file: "f", manifest: {}, owner: 1 });
	await sleep(100);
	assert.equal(warnings.length, 1);
	assert.throws(() => store.takeToken(t1, { owner: 1 }), code("token-expired"));
	const t2 = store.createToken({ stageDir, file: "g", manifest: {}, owner: 1 });
	store.dropToken(t2);
	assert.equal(warnings.length, 2);
	assert.throws(() => store.takeToken(t2, { owner: 1 }), code("token-expired"));
});

it("pending downloads are one-time, validated and expire", async () => {
	const { dir, time, store } = await make();
	const src = path.join(dir, "x.tmp-file");
	await writeFile(src, "data");
	const id = await store.addPending(src, { owner: 1 });
	assert.match(id, /^[A-Za-z0-9_-]{16,64}$/u);
	assert.equal(await exists(src), false);
	const file = store.takePending(id, { owner: 1 });
	assert.equal(file, path.join(dir, `.pending-${id}.npmpro`));
	assert.equal(await exists(file), true);
	assert.throws(() => store.takePending(id, { owner: 1 }), code("token-expired"));
	assert.throws(() => store.takePending("../../etc", { owner: 1 }), code("token-expired"));
	await writeFile(src, "data");
	const late = await store.addPending(src, { owner: 1 });
	time.value += 30 * 60 * 1000;
	assert.throws(() => store.takePending(late, { owner: 1 }), code("token-expired"));
	assert.equal(await exists(path.join(dir, `.pending-${late}.npmpro`)), false);
});

it("cleanup removes leftovers and keeps real backups and folders", async () => {
	const { dir, store } = await make();
	await mkdir(path.join(dir, "database"));
	await mkdir(path.join(dir, ".restore-abc", "sub"), { recursive: true });
	await writeFile(path.join(dir, ".restore-abc", "sub", "f"), "x");
	await writeFile(path.join(dir, ".tmp-1"), "x");
	await writeFile(path.join(dir, ".upload-1"), "x");
	await writeFile(path.join(dir, ".pending-1.npmpro"), "x");
	await writeFile(path.join(dir, "half.part"), "x");
	const keep = "npmpro-backup-h-20261026-101500.npmpro";
	await writeFile(store.pathOf(keep), "x");
	await writeFile(store.pathOf("npmpro-backup-h-20261026-101500-auto.npmpro"), "x");
	await store.cleanup();
	assert.deepEqual((await readdir(dir)).sort(), ["auto", "database", keep]);
	assert.equal((await readdir(path.join(dir, "auto"))).length, 1);
});

it("keeps one restore session per owner and drops the oldest of more than five", async () => {
	const { store } = await make();
	const stageA = await store.createStageDir("restore");
	const stageB = await store.createStageDir("restore");
	const a = store.createToken({ stageDir: stageA, file: "a", manifest: {}, owner: 1 });
	const b = store.createToken({ stageDir: stageB, file: "b", manifest: {}, owner: 2 });
	assert.equal(store.takeToken(a, { owner: 1 }).file, "a");
	assert.deepEqual(Object.keys(store.takeToken(b, { owner: 2 })).sort(), [
		"expires",
		"file",
		"kind",
		"manifest",
		"owner",
		"stageDir",
	]);
	const stageA2 = await store.createStageDir("restore");
	const a2 = store.createToken({ stageDir: stageA2, file: "a2", manifest: {}, owner: 1, kind: "x" });
	assert.equal(await exists(stageA), false);
	assert.equal(await exists(stageB), true);
	assert.throws(() => store.takeToken(a, { owner: 1 }), code("token-expired"));
	assert.equal(store.takeToken(a2, { owner: 1 }).kind, "x");
	assert.equal(store.takeToken(b, { owner: 2 }).file, "b");
	const stages = [];
	for (let owner = 10; owner < 14; owner++) {
		const stage = await store.createStageDir("restore");
		stages.push(stage);
		store.createToken({ stageDir: stage, file: "f", manifest: {}, owner });
	}
	// b (owner 2), a2 (owner 1) and four more make six: the oldest, b, goes
	assert.equal(await exists(stageB), false);
	assert.equal(await exists(stageA2), true);
	assert.throws(() => store.takeToken(b, { owner: 2 }), code("token-expired"));
	assert.equal(store.takeToken(a2, { owner: 1 }).file, "a2");
});

it("refuses another owner's token and pending file", async () => {
	const { dir, store } = await make();
	const stage = await store.createStageDir("restore");
	const t = store.createToken({ stageDir: stage, file: "f", manifest: {}, owner: 1 });
	assert.throws(() => store.takeToken(t, { owner: 2 }), code("token-expired"));
	assert.equal(store.takeToken(t, { owner: 1 }).file, "f");
	const src = path.join(dir, "x.tmp-file");
	await writeFile(src, "data");
	const id = await store.addPending(src, { owner: 1 });
	assert.throws(() => store.takePending(id, { owner: 2 }), code("token-expired"));
	assert.equal(await exists(store.takePending(id, { owner: 1 })), true);
	assert.throws(() => store.takePending(id, { owner: 1 }), code("token-expired"));
});

it("each owner's token expires on its own timer", async () => {
	const { store } = await make({ tokenTtlMs: 30 });
	const stage1 = await store.createStageDir("restore");
	const stage2 = await store.createStageDir("restore");
	store.createToken({ stageDir: stage1, file: "a", manifest: {}, owner: 1 });
	store.createToken({ stageDir: stage2, file: "b", manifest: {}, owner: 2 });
	await sleep(100);
	assert.equal(await exists(stage1), false);
	assert.equal(await exists(stage2), false);
});

it("a pending file is read without taking it, with its kind, by its owner only", async () => {
	const { dir, time, store } = await make();
	const src = path.join(dir, "x.tmp-file");
	await writeFile(src, "data");
	const id = await store.addPending(src, { owner: 2, kind: "proxy_hosts" });
	const target = path.join(dir, `.pending-${id}.npmpro`);
	assert.deepEqual(store.peekPending(id, { owner: 2 }), { file: target, kind: "proxy_hosts" });
	assert.deepEqual(store.peekPending(id, { owner: 2 }), { file: target, kind: "proxy_hosts" });
	assert.throws(() => store.peekPending(id, { owner: 3 }), code("token-expired"));
	assert.throws(() => store.peekPending("../../etc", { owner: 2 }), code("token-expired"));
	assert.equal(store.takePending(id, { owner: 2 }), target);
	assert.throws(() => store.peekPending(id, { owner: 2 }), code("token-expired"));
	await writeFile(src, "data");
	const late = await store.addPending(src, { owner: 2 });
	assert.equal(store.peekPending(late, { owner: 2 }).kind, null);
	time.value += 30 * 60 * 1000;
	assert.throws(() => store.peekPending(late, { owner: 2 }), code("token-expired"));
	assert.equal(await exists(path.join(dir, `.pending-${late}.npmpro`)), false);
});

it("removes a pending file when it expires unused, and logs a file that cannot be removed", async () => {
	const warnings = [];
	const { dir, store } = await make({ pendingTtlMs: 30, logger: { warn: (...args) => warnings.push(args) } });
	const src = path.join(dir, "x.tmp-file");
	await writeFile(src, "data");
	const id = await store.addPending(src, { owner: 1, kind: "proxy_hosts" });
	const target = path.join(dir, `.pending-${id}.npmpro`);
	await writeFile(src, "data");
	const taken = await store.addPending(src, { owner: 1 });
	const takenFile = store.takePending(taken, { owner: 1 });
	await sleep(100);
	assert.equal(await exists(target), false);
	// a taken file belongs to its taker
	assert.equal(await exists(takenFile), true);
	assert.throws(() => store.peekPending(id, { owner: 1 }), code("token-expired"));
	assert.deepEqual(warnings, []);
	// a folder in the way of the removal stands for a file that cannot be removed
	await writeFile(src, "data");
	const stuck = await store.addPending(src, { owner: 2 });
	const stuckFile = path.join(dir, `.pending-${stuck}.npmpro`);
	await rm(stuckFile);
	await mkdir(path.join(stuckFile, "x"), { recursive: true });
	await sleep(100);
	assert.equal(warnings.length, 1);
});

it("keeps one pending import per owner: a new upload drops the older one and its file", async () => {
	const { dir, store } = await make();
	const src = path.join(dir, "x.tmp-file");
	const add = async (owner, kind) => {
		await writeFile(src, "data");
		return store.addPending(src, { owner, kind });
	};
	const first = await add(1, "proxy_hosts");
	const download = await add(1, null);
	const other = await add(2, "streams");
	const second = await add(1, "streams");
	assert.equal(await exists(path.join(dir, `.pending-${first}.npmpro`)), false);
	assert.throws(() => store.peekPending(first, { owner: 1 }), code("token-expired"));
	assert.equal(store.peekPending(second, { owner: 1 }).kind, "streams");
	assert.equal(store.peekPending(other, { owner: 2 }).kind, "streams");
	assert.equal(store.peekPending(download, { owner: 1 }).kind, null);
});
