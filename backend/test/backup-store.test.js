import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
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

it("keeps one restore session per owner and drops the oldest page session of more than five", async () => {
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
	// b (owner 2), a2 (owner 1) and four more make six: the oldest page session, a2, goes; Settings sessions stay
	assert.equal(await exists(stageB), true);
	assert.equal(await exists(stageA2), false);
	assert.equal(store.takeToken(b, { owner: 2 }).file, "b");
	assert.throws(() => store.takeToken(a2, { owner: 1 }), code("token-expired"));
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

it("prunes the automatic backups of page imports apart from the Settings ones", async () => {
	const { store } = await make();
	const date = (i) => new Date(2026, 9, 20 + i, 10, 15, 0);
	const settings = [];
	const imports = [];
	for (let i = 1; i <= 6; i++) {
		const name = store.fileName({ host: "h", date: date(i), auto: true });
		settings.push(name);
		await writeFile(store.pathOf(name), "x");
		await utimes(store.pathOf(name), i * 100, i * 100);
	}
	for (let i = 1; i <= 7; i++) {
		const name = store.fileName({ host: "h", date: date(i), auto: true, page: true });
		assert.equal(store.NAME.test(name), true, name);
		imports.push(name);
		await writeFile(store.pathOf(name), "x");
		// newer than every Settings backup
		await utimes(store.pathOf(name), 1000 + i * 100, 1000 + i * 100);
	}
	await store.pruneAuto();
	const byName = (a, b) => a.localeCompare(b);
	assert.deepEqual(
		(await store.list()).map((item) => item.name).sort(byName),
		[...settings.slice(1), ...imports.slice(2)].sort(byName),
	);
	assert.equal(new Set([...settings, ...imports]).size, 13);
});

it("never evicts a Settings session for the session cap; the oldest page session goes", async () => {
	const { store } = await make();
	const tokens = [];
	for (let owner = 1; owner <= 2; owner++) {
		tokens.push(
			store.createToken({ stageDir: await store.createStageDir("restore"), file: "s", manifest: {}, owner }),
		);
	}
	for (let owner = 10; owner <= 13; owner++) {
		tokens.push(
			store.createToken({
				stageDir: await store.createStageDir("restore"),
				file: "p",
				manifest: {},
				owner,
				kind: "streams",
			}),
		);
	}
	// the first page session (owner 10) went for the sixth session; the Settings sessions stay
	assert.equal(store.takeToken(tokens[0], { owner: 1 }).file, "s");
	assert.equal(store.takeToken(tokens[1], { owner: 2 }).file, "s");
	assert.throws(() => store.takeToken(tokens[2], { owner: 10 }), code("token-expired"));
	assert.equal(store.takeToken(tokens[5], { owner: 13 }).file, "p");
});

const writeNamed = async (dir, name) =>
	writeBackupFile({ source: Readable.from([Buffer.from("x")]), file: path.join(dir, name), mode: "none", summary });

it("schedule names carry -s<id>, a taken one gets its number before it", async () => {
	const { store, dir } = await make();
	const date = new Date(2026, 9, 28, 12, 0, 0);
	const name = store.fileName({ host: "npm", date, scheduleId: 5 });
	assert.equal(name, "npmpro-backup-npm-20261028-120000-s5.npmpro");
	assert.equal(store.NAME.test(name), true);
	await writeNamed(dir, name);
	assert.equal(store.uniqueName(name), "npmpro-backup-npm-20261028-120000-2-s5.npmpro");
	assert.equal(
		store.withoutSchedule("npmpro-backup-npm-20261028-120000-2-s5.npmpro"),
		"npmpro-backup-npm-20261028-120000-2.npmpro",
	);
});

it("lists schedule_id and instance_key", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261028-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261028-120100.npmpro");
	await writeBackupFile({
		source: Readable.from([Buffer.from("x")]),
		file: path.join(dir, "npmpro-backup-npm-20261028-120200-s6.npmpro"),
		mode: "instance",
		instanceKey: Buffer.alloc(32, 1),
		summary,
	});
	const byName = Object.fromEntries((await store.list()).map((item) => [item.name, item]));
	assert.equal(byName["npmpro-backup-npm-20261028-120000-s5.npmpro"].schedule_id, 5);
	assert.equal(byName["npmpro-backup-npm-20261028-120100.npmpro"].schedule_id, null);
	assert.equal(byName["npmpro-backup-npm-20261028-120200-s6.npmpro"].instance_key, true);
	assert.equal(byName["npmpro-backup-npm-20261028-120000-s5.npmpro"].instance_key, false);
});

it("retention keeps the newest files of the schedule and touches nothing else", async () => {
	const { store, dir } = await make();
	for (const name of [
		"npmpro-backup-npm-20261026-120000-s5.npmpro",
		"npmpro-backup-npm-20261027-120000-s5.npmpro",
		"npmpro-backup-npm-20261028-120000-s5.npmpro",
		"npmpro-backup-npm-20261028-120000-2-s5.npmpro",
		"npmpro-backup-npm-20261025-120000-s6.npmpro",
		"npmpro-backup-npm-20261020-120000.npmpro",
	]) {
		await writeNamed(dir, name);
	}
	await writeNamed(path.join(dir, "auto"), "npmpro-backup-npm-20261019-120000-auto.npmpro");
	// same mtime for all: the order comes from the name
	for (const name of await readdir(dir)) await utimes(path.join(dir, name), 500, 500);
	assert.deepEqual(
		(await store.scheduleFiles(5)).map((item) => item.name),
		[
			"npmpro-backup-npm-20261028-120000-2-s5.npmpro",
			"npmpro-backup-npm-20261028-120000-s5.npmpro",
			"npmpro-backup-npm-20261027-120000-s5.npmpro",
			"npmpro-backup-npm-20261026-120000-s5.npmpro",
		],
	);
	assert.deepEqual(await store.pruneSchedule(5, 2), [
		"npmpro-backup-npm-20261027-120000-s5.npmpro",
		"npmpro-backup-npm-20261026-120000-s5.npmpro",
	]);
	const left = (await readdir(dir)).filter((name) => name.endsWith(".npmpro")).sort();
	assert.deepEqual(left, [
		"npmpro-backup-npm-20261020-120000.npmpro",
		"npmpro-backup-npm-20261025-120000-s6.npmpro",
		"npmpro-backup-npm-20261028-120000-2-s5.npmpro",
		"npmpro-backup-npm-20261028-120000-s5.npmpro",
	]);
	assert.equal((await readdir(path.join(dir, "auto"))).length, 1);
});

it("retention orders by file time: a new file whose stamp sorts older is kept, the oldest by time go", async () => {
	const { store, dir } = await make();
	// after a time zone change (or in the repeated hour when summer time ends) the new stamp is earlier
	const files = [
		["npmpro-backup-npm-20261028-120000-s5.npmpro", 100],
		["npmpro-backup-npm-20261028-130000-s5.npmpro", 200],
		["npmpro-backup-npm-20261028-140000-s5.npmpro", 300],
		["npmpro-backup-npm-20261028-110000-s5.npmpro", 400],
	];
	for (const [name, time] of files) {
		await writeNamed(dir, name);
		await utimes(path.join(dir, name), time, time);
	}
	assert.deepEqual(
		(await store.scheduleFiles(5)).map((item) => item.name),
		[
			"npmpro-backup-npm-20261028-110000-s5.npmpro",
			"npmpro-backup-npm-20261028-140000-s5.npmpro",
			"npmpro-backup-npm-20261028-130000-s5.npmpro",
			"npmpro-backup-npm-20261028-120000-s5.npmpro",
		],
	);
	assert.deepEqual(await store.pruneSchedule(5, 2, "npmpro-backup-npm-20261028-110000-s5.npmpro"), [
		"npmpro-backup-npm-20261028-130000-s5.npmpro",
		"npmpro-backup-npm-20261028-120000-s5.npmpro",
	]);
	assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".npmpro")).sort(), [
		"npmpro-backup-npm-20261028-110000-s5.npmpro",
		"npmpro-backup-npm-20261028-140000-s5.npmpro",
	]);
});

it("retention never removes keepName, even with keep 1 and an older file time", async () => {
	const { store, dir } = await make();
	const fresh = "npmpro-backup-npm-20261028-120000-s5.npmpro";
	for (const [name, time] of [
		[fresh, 100],
		["npmpro-backup-npm-20261027-120000-s5.npmpro", 200],
		["npmpro-backup-npm-20261026-120000-s5.npmpro", 300],
	]) {
		await writeNamed(dir, name);
		await utimes(path.join(dir, name), time, time);
	}
	for (const keep of [1, 0]) {
		await store.pruneSchedule(5, keep, fresh);
		assert.deepEqual(
			(await store.scheduleFiles(5)).map((item) => item.name),
			[fresh],
		);
	}
});

it("scheduleCounts counts each schedule's files from the names, not automatic or plain ones", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261027-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261028-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261028-120000-s7.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261028-130000.npmpro");
	await writeFile(path.join(dir, "npmpro-backup-npm-20261028-140000-s7.npmpro.part"), "x");
	await writeNamed(path.join(dir, "auto"), "npmpro-backup-npm-20261026-120000-s5-auto.npmpro");
	assert.deepEqual(
		[...(await store.scheduleCounts())].sort(([a], [b]) => a - b),
		[
			[5, 2],
			[7, 1],
		],
	);
});

it("retention skips a file deleted by hand", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261026-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261027-120000-s5.npmpro");
	await rm(path.join(dir, "npmpro-backup-npm-20261026-120000-s5.npmpro"));
	assert.deepEqual(await store.pruneSchedule(5, 1), []);
});

it("retention skips a file that vanishes after the listing and still removes the others", async () => {
	const doomed = "npmpro-backup-npm-20261026-120000-s5.npmpro";
	const { store, dir } = await make({
		removeFile: async (file) => {
			// the first removal finds its file already gone, like a hand deletion during the run
			if (path.basename(file) === doomed) await rm(file);
			return rm(file);
		},
	});
	for (const day of [26, 27, 28]) await writeNamed(dir, `npmpro-backup-npm-202610${day}-120000-s5.npmpro`);
	assert.deepEqual(await store.pruneSchedule(5, 1), ["npmpro-backup-npm-20261027-120000-s5.npmpro"]);
	assert.deepEqual(
		(await store.scheduleFiles(5)).map((item) => item.name),
		["npmpro-backup-npm-20261028-120000-s5.npmpro"],
	);
});

it("retention rethrows a removal error other than a missing file", async () => {
	const { store, dir } = await make({
		removeFile: async () => {
			throw Object.assign(new Error("denied"), { code: "EACCES" });
		},
	});
	await writeNamed(dir, "npmpro-backup-npm-20261027-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261028-120000-s5.npmpro");
	await assert.rejects(store.pruneSchedule(5, 1), code("EACCES"));
});

it("retention always keeps at least one file", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261027-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261028-120000-s5.npmpro");
	for (const keep of [0, -3])
		assert.deepEqual(
			await store.pruneSchedule(5, keep),
			keep === 0 ? ["npmpro-backup-npm-20261027-120000-s5.npmpro"] : [],
		);
	assert.equal((await store.scheduleFiles(5)).length, 1);
});

it("retention removes nothing when keep is not an integer", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261027-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261028-120000-s5.npmpro");
	for (const keep of [Number.NaN, undefined, "2", 1.5]) assert.deepEqual(await store.pruneSchedule(5, keep), []);
	assert.equal((await store.scheduleFiles(5)).length, 2);
});

it("listing skips a file that vanishes between the directory read and its stat", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261027-120000-s5.npmpro");
	// a dangling link is listed by readdir but cannot be stat-ed
	await symlink(path.join(dir, "missing"), path.join(dir, "npmpro-backup-npm-20261028-120000-s5.npmpro"));
	assert.deepEqual(
		(await store.list()).map((item) => item.name),
		["npmpro-backup-npm-20261027-120000-s5.npmpro"],
	);
});

it("an uploaded name from another instance, auto and page files never count for a schedule", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261028-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm--import-20261027-120000.npmpro");
	await writeNamed(path.join(dir, "auto"), "npmpro-backup-npm-20261026-120000-s5-auto.npmpro");
	const uploaded = store.uniqueName(store.withoutSchedule("npmpro-backup-npm-20261028-120000-s5.npmpro"));
	assert.equal(uploaded, "npmpro-backup-npm-20261028-120000.npmpro");
	await writeNamed(dir, uploaded);
	assert.deepEqual(
		(await store.scheduleFiles(5)).map((item) => item.name),
		["npmpro-backup-npm-20261028-120000-s5.npmpro"],
	);
	assert.deepEqual(await store.pruneSchedule(5, 1), []);
	assert.deepEqual(await store.pruneSchedule(7, 0), []);
	assert.equal((await readdir(path.join(dir, "auto"))).length, 1);
	assert.equal((await store.list()).length, 4);
});

it("detachSchedule renames the schedule's files without -s<id>, keeps their contents and touches nothing else", async () => {
	const { store, dir } = await make();
	for (const name of [
		"npmpro-backup-npm-20261026-120000-s5.npmpro",
		"npmpro-backup-npm-20261027-120000-2-s5.npmpro",
		"npmpro-backup-npm-20261027-120000-s6.npmpro",
	]) {
		await writeNamed(dir, name);
	}
	const before = await readFile(path.join(dir, "npmpro-backup-npm-20261026-120000-s5.npmpro"));
	assert.deepEqual(
		(await store.detachSchedule(5)).sort((a, b) => a.localeCompare(b)),
		["npmpro-backup-npm-20261026-120000.npmpro", "npmpro-backup-npm-20261027-120000-2.npmpro"],
	);
	assert.deepEqual(await readFile(path.join(dir, "npmpro-backup-npm-20261026-120000.npmpro")), before);
	assert.deepEqual(await store.scheduleFiles(5), []);
	assert.deepEqual(
		(await readdir(dir)).filter((name) => name.endsWith(".npmpro")).sort((a, b) => a.localeCompare(b)),
		[
			"npmpro-backup-npm-20261026-120000.npmpro",
			"npmpro-backup-npm-20261027-120000-2.npmpro",
			"npmpro-backup-npm-20261027-120000-s6.npmpro",
		],
	);
});

it("detachSchedule never overwrites a taken name", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261026-120000.npmpro");
	await writeFile(path.join(dir, "npmpro-backup-npm-20261026-120000-2.npmpro"), "manual");
	await writeNamed(dir, "npmpro-backup-npm-20261026-120000-s5.npmpro");
	assert.deepEqual(await store.detachSchedule(5), ["npmpro-backup-npm-20261026-120000-3.npmpro"]);
	assert.equal(await readFile(path.join(dir, "npmpro-backup-npm-20261026-120000-2.npmpro"), "utf8"), "manual");
	assert.equal((await readdir(dir)).filter((name) => name.endsWith(".npmpro")).length, 3);
});

it("detachSchedule skips a file that vanishes after the listing", async () => {
	const doomed = "npmpro-backup-npm-20261026-120000-s5.npmpro";
	const { store, dir } = await make({
		// detaching the newer file removes the older one, like a hand deletion during the detach
		removeFile: async (file) => {
			await rm(file);
			await rm(path.join(path.dirname(file), doomed), { force: true });
		},
	});
	await writeNamed(dir, doomed);
	await writeNamed(dir, "npmpro-backup-npm-20261027-120000-s5.npmpro");
	assert.deepEqual(await store.detachSchedule(5), ["npmpro-backup-npm-20261027-120000.npmpro"]);
	assert.deepEqual(
		(await readdir(dir)).filter((name) => name.endsWith(".npmpro")),
		["npmpro-backup-npm-20261027-120000.npmpro"],
	);
});

it("detachAllSchedules detaches every schedule's files and leaves automatic and plain files", async () => {
	const { store, dir } = await make();
	await writeNamed(dir, "npmpro-backup-npm-20261026-120000-s5.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261026-130000-s9.npmpro");
	await writeNamed(dir, "npmpro-backup-npm-20261026-140000.npmpro");
	await writeNamed(path.join(dir, "auto"), "npmpro-backup-npm-20261019-120000-auto.npmpro");
	assert.deepEqual(
		(await store.detachAllSchedules()).sort((a, b) => a.localeCompare(b)),
		["npmpro-backup-npm-20261026-120000.npmpro", "npmpro-backup-npm-20261026-130000.npmpro"],
	);
	assert.equal((await store.list()).filter((item) => item.schedule_id !== null).length, 0);
	assert.deepEqual(await readdir(path.join(dir, "auto")), ["npmpro-backup-npm-20261019-120000-auto.npmpro"]);
});

it("detachSchedule renames where hard links are not supported", async () => {
	const { store, dir } = await make({
		linkFile: () => Promise.reject(Object.assign(new Error("no links"), { code: "EPERM" })),
	});
	await writeNamed(dir, "npmpro-backup-npm-20261026-120000-s5.npmpro");
	assert.deepEqual(await store.detachSchedule(5), ["npmpro-backup-npm-20261026-120000.npmpro"]);
});
