import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { accessLogDirective, applyAccessLog } from "../lib/traffic/access-log.js";

const EMERG = /nginx: \[emerg\] test/u;
const ok = () => Promise.resolve();
const fail = (message) => () => Promise.reject(new Error(message));

const tmpConf = async () => path.join(await mkdtemp(path.join(tmpdir(), "alc-")), "access-log.conf");

it("builds the directive", () => {
	assert.equal(accessLogDirective(true), "access_log /data/nginx/logs/access.log alog;\n");
	assert.equal(accessLogDirective(false), "access_log off;\n");
});

it("writes, tests and reloads", async () => {
	const file = await tmpConf();
	await writeFile(file, "access_log off;\n");
	let reloaded = false;
	await applyAccessLog(true, {
		file,
		test: ok,
		reload: () => {
			reloaded = true;
			return Promise.resolve();
		},
	});
	assert.equal(await readFile(file, "utf8"), "access_log /data/nginx/logs/access.log alog;\n");
	assert.equal(reloaded, true);
});

it("restores the previous include on a failed nginx test", async () => {
	const file = await tmpConf();
	await writeFile(file, "access_log off;\n");
	let reloaded = false;
	await assert.rejects(
		applyAccessLog(true, {
			file,
			test: fail("nginx: [emerg] test"),
			reload: () => {
				reloaded = true;
				return Promise.resolve();
			},
		}),
		(err) => err.name === "ValidationError" && EMERG.test(err.message),
	);
	assert.equal(await readFile(file, "utf8"), "access_log off;\n");
	assert.equal(reloaded, false);
});

it("creates a missing include, and writes the opposite directive on a failure without a previous file", async () => {
	const file = await tmpConf();
	await applyAccessLog(false, { file, test: ok, reload: ok });
	assert.equal(await readFile(file, "utf8"), "access_log off;\n");

	const other = await tmpConf();
	let reloaded = false;
	await assert.rejects(
		applyAccessLog(true, {
			file: other,
			test: fail("bad"),
			reload: () => {
				reloaded = true;
				return Promise.resolve();
			},
		}),
		{ name: "ValidationError", message: "bad" },
	);
	assert.equal(reloaded, false);
	assert.equal(await readFile(other, "utf8"), "access_log off;\n");
});

it("throws a failed write as a ValidationError", async () => {
	const file = path.join(await mkdtemp(path.join(tmpdir(), "alc-")), "missing", "access-log.conf");
	await assert.rejects(applyAccessLog(true, { file, test: ok, reload: ok }), (err) => {
		assert.equal(err.name, "ValidationError");
		assert.equal(err.cause.code, "ENOENT");
		return true;
	});
});

it("keeps the nginx error when the restore fails too", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "alc-"));
	const file = path.join(dir, "access-log.conf");
	await writeFile(file, "access_log off;\n");
	await assert.rejects(
		applyAccessLog(true, {
			file,
			test: async () => {
				await rm(dir, { recursive: true });
				throw new Error("nginx: [emerg] test");
			},
			reload: ok,
		}),
		{ name: "ValidationError", message: "nginx: [emerg] test" },
	);
});

it("leaves no temp file behind", async () => {
	const file = await tmpConf();
	await applyAccessLog(true, { file, test: ok, reload: ok });
	await assert.rejects(readFile(`${file}.tmp`, "utf8"), { code: "ENOENT" });
});

it("skips the reload when asked to only write the file", async () => {
	const file = await tmpConf();
	let calls = 0;
	const changed = await applyAccessLog(true, {
		file,
		test: () => {
			calls += 1;
			return Promise.resolve();
		},
		reload: () => {
			calls += 1;
			return Promise.resolve();
		},
		writeOnly: true,
	});
	assert.equal(changed, true);
	assert.equal(calls, 0);
	assert.equal(await readFile(file, "utf8"), "access_log /data/nginx/logs/access.log alog;\n");
	assert.equal(await applyAccessLog(true, { file, writeOnly: true }), false);
});

it("restores the previous include when the reload fails", async () => {
	const file = await tmpConf();
	await writeFile(file, "access_log off;\n");
	await assert.rejects(
		applyAccessLog(true, {
			file,
			test: ok,
			reload: fail("reload failed"),
		}),
		{ name: "ValidationError", message: "reload failed" },
	);
	assert.equal(await readFile(file, "utf8"), "access_log off;\n");
});

it("does not test or reload when the file already has the directive", async () => {
	const file = await tmpConf();
	await writeFile(file, "access_log off;\n");
	let calls = 0;
	const bump = () => {
		calls += 1;
		return Promise.resolve();
	};
	assert.equal(await applyAccessLog(false, { file, test: bump, reload: bump }), false);
	assert.equal(calls, 0);
});
