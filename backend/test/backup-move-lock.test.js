import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { setup } from "./support/backup-service.js";

const AUTO_NAME = /^npmpro-backup-npmpro-\d{8}-\d{6}-auto\.npmpro$/u;
const RELEASED = /released already/u;

it("the move lock refuses while a backup runs, makes the safety backup and releases", async () => {
	const ctx = await setup();
	try {
		let finish;
		const backup = ctx.store.withLock(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		assert.throws(
			() => ctx.service.lockForMove(1),
			(error) => error.code === "busy" && error.status === 409,
		);
		finish();
		await backup;
		const lock = ctx.service.lockForMove(1);
		await assert.rejects(
			ctx.store.withLock(async () => 1),
			(error) => error.code === "busy",
		);
		const name = await lock.safetyBackup();
		assert.match(name, AUTO_NAME);
		assert.deepEqual(await readdir(path.join(ctx.backupsDir, "auto")), [name]);
		lock.release();
		assert.equal(await ctx.store.withLock(async () => 2), 2);
	} finally {
		await ctx.cleanup();
	}
});

it("a released move lock makes no safety backup and a second release frees nothing", async () => {
	const ctx = await setup();
	try {
		const lock = ctx.service.lockForMove(1);
		lock.release();
		await assert.rejects(lock.safetyBackup(), RELEASED);
		const backup = ctx.store.acquire();
		// the move's release does not free a lock someone else holds now
		lock.release();
		assert.throws(
			() => ctx.store.acquire(),
			(error) => error.code === "busy",
		);
		backup();
	} finally {
		await ctx.cleanup();
	}
});
