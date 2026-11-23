import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";

const ROOTFS = path.join(import.meta.dirname, "../../rootfs/usr/local");
const nginxConf = readFileSync(path.join(ROOTFS, "nginx/conf/nginx.conf"), "utf8");
const launch = readFileSync(path.join(ROOTFS, "bin/launch.sh"), "utf8");
const INCLUDE = "include /data/npmpro/nginx/resolver.conf;";
const RESOLVER_LINE = /^\s*resolver\s/mu;

// the text of the block that starts at the line `name {` (braces counted to its end)
const block = (name) => {
	const start = nginxConf.search(new RegExp(`^${name} \\{`, "mu"));
	if (start === -1) return "";
	let depth = 0;
	for (let i = nginxConf.indexOf("{", start); i < nginxConf.length; i++) {
		if (nginxConf[i] === "{") depth++;
		if (nginxConf[i] === "}") depth--;
		if (depth === 0) return nginxConf.slice(start, i + 1);
	}
	return "";
};

it("nginx.conf holds no resolver line, only the include", () => {
	assert.equal(RESOLVER_LINE.test(nginxConf), false);
	assert.equal(nginxConf.split(INCLUDE).length - 1, 2);
});

it("nginx.conf includes resolver.conf once in http and once in stream", () => {
	for (const name of ["http", "stream"]) {
		const text = block(name);
		assert.ok(text.startsWith(`${name} {`), `${name} block found`);
		assert.equal(text.split(INCLUDE).length - 1, 1, name);
	}
});

it("the launch.sh fallback backs up and restores resolver.conf", () => {
	const lines = launch.split("\n").filter((line) => line.includes("resolver.conf"));
	assert.equal(lines.length, 2);
	assert.ok(lines.some((line) => line.trim().startsWith("cp -p /data/npmpro/nginx/resolver.conf")));
	assert.ok(lines.some((line) => line.includes('cp -p "$core_backup/resolver.conf" /data/npmpro/nginx/')));
});
