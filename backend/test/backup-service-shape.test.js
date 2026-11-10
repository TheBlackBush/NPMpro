import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { it } from "node:test";
import { promisify } from "node:util";
import { setup } from "./support/backup-service.js";

const run = promisify(execFile);

// the object backup-service.js hands to its callers: a split of internal/backup.js must keep it whole
const SERVICE_KEYS = [
	"cancel",
	"check",
	"create",
	"download",
	"exportItems",
	"exportPreview",
	"importOpen",
	"importUpload",
	"inspect",
	"list",
	"lockForMove",
	"plan",
	"remove",
	"restore",
	"scheduledBackup",
	"takePending",
	"types",
	"upload",
];

const FILES = ["backup-shared", "backup-create", "backup-offline", "backup-restore", "backup-merge", "backup"];

it("the backup service has the same keys, all functions", async () => {
	const { service, cleanup } = await setup();
	try {
		assert.deepEqual(Object.keys(service).sort(), SERVICE_KEYS);
		for (const key of SERVICE_KEYS) assert.equal(typeof service[key], "function", key);
	} finally {
		await cleanup();
	}
});

for (const name of FILES) {
	it(`${name}.js loads first in a fresh process`, async () => {
		await run(process.execPath, ["--input-type=module", "-e", `await import("./internal/${name}.js")`]);
	});
}
