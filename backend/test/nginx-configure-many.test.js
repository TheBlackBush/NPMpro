import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, it, mock } from "node:test";

// configureManyNow on its own, with the writes, the nginx test and the per-host check replaced: what the fallback of a
// failed batch test hands to configureNow, and what it keeps on disk.

let dir;
let internalNginx;
const file = (id) => path.join(dir, `${id}.conf`);
const entries = (ids) => ids.map((id) => ({ model: {}, hostType: "stream", host: { id } }));

before(async () => {
	dir = await mkdtemp(path.join(tmpdir(), "configure-many-"));
	// the internal modules open the database and write keys under /data when they load
	process.env.NPMPRO_TEST_ROOT = path.join(dir, "root");
	await mkdir(path.join(dir, "root/data/npmpro"), { recursive: true });
	internalNginx = (await import("../internal/nginx.js")).default;
	mock.method(internalNginx, "getConfigName", (hostType, id) => path.join(dir, `${id}.conf`));
	mock.method(internalNginx, "generateConfig", async (hostType, host, options) => {
		await writeFile(file(host.id), `new ${host.id} ocsp ${options.fetchMissingOcsp}`);
	});
	mock.method(internalNginx, "test", async () => {
		throw new Error("batch is broken");
	});
});
after(() => mock.restoreAll());

it("hands fetchMissingOcsp to every host of the one by one check", async () => {
	const seen = [];
	mock.method(internalNginx, "configureNow", async (model, hostType, host, options) => {
		seen.push({ id: host.id, ...options });
	});
	await internalNginx.configureManyNow(entries([1, 2]), { fetchMissingOcsp: false });
	assert.deepEqual(seen, [
		{ id: 1, skipReload: true, fetchMissingOcsp: false },
		{ id: 2, skipReload: true, fetchMissingOcsp: false },
	]);
	seen.length = 0;
	await internalNginx.configureManyNow(entries([1, 2]), { keepPrevious: true });
	assert.deepEqual(
		seen.map((item) => item.fetchMissingOcsp),
		[true, true],
	);
});

it("puts the previous configs back for the check, and again when a write throws", async () => {
	await writeFile(file(1), "old 1");
	await writeFile(file(2), "old 2");
	const during = [];
	mock.method(internalNginx, "configureNow", async (model, hostType, host) => {
		during.push([host.id, await readFile(file(1), "utf8"), await readFile(file(2), "utf8")]);
	});
	await internalNginx.configureManyNow(entries([1, 2]), { keepPrevious: true });
	assert.deepEqual(during, [
		[1, "old 1", "old 2"],
		[2, "old 1", "old 2"],
	]);
	mock.method(internalNginx, "generateConfig", async (hostType, host) => {
		if (host.id === 2) throw new Error("render failed");
		await writeFile(file(host.id), "new");
	});
	await assert.rejects(internalNginx.configureManyNow(entries([1, 2]), { keepPrevious: true }), /render failed/u);
	assert.equal(await readFile(file(1), "utf8"), "old 1");
	assert.equal(await readFile(file(2), "utf8"), "old 2");
});
