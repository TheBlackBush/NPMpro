import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";

const read = (file) => readFileSync(path.join(import.meta.dirname, "../..", file), "utf8");

it("nginx.conf no longer pins workers itself (auto failed in a Docker cpuset; the setting writes core-main.conf)", () => {
	assert.equal(read("rootfs/usr/local/nginx/conf/nginx.conf").includes("worker_cpu_affinity"), false);
});

it("the healthcheck asks /api only once the backend socket exists", () => {
	const script = read("rootfs/usr/local/bin/healthcheck.sh");
	const socket = script.indexOf("[ -S /run/npmpro.sock ]");
	assert.ok(socket > 0, "no socket test");
	assert.ok(socket < script.indexOf("curl "), "the socket test must come before the request");
});
