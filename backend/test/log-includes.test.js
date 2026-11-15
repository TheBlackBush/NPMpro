import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { logIncludes } from "../lib/log-files.js";
import { accessLogDirective } from "../lib/traffic/access-log.js";

const SCRIPT = path.join(import.meta.dirname, "../../rootfs/usr/local/bin/log-includes.sh");

const run = (env, conf, { link = false, before = {} } = {}) => {
	const dir = mkdtempSync(path.join(tmpdir(), "log-includes-"));
	// includes an earlier start (the backend) left behind
	for (const [name, content] of Object.entries(before)) writeFileSync(path.join(dir, name), content);
	const crowdsecConf = path.join(dir, "crowdsec.conf");
	if (conf !== undefined) {
		const target = link ? path.join(dir, "real.conf") : crowdsecConf;
		writeFileSync(target, conf);
		if (link) symlinkSync(target, crowdsecConf);
	}
	execFileSync("sh", [SCRIPT, dir, crowdsecConf], { env: { PATH: process.env.PATH, ...env } });
	const read = (name) => readFileSync(path.join(dir, name), "utf8");
	return { access: read("access-log.conf"), error: read("error-log.conf"), stream: read("stream-log.conf") };
};
const expected = (files, access, format = "classic") => ({
	access: accessLogDirective(access, format),
	...logIncludes(files, format),
});

const stored = (value, eol = "\n") => `ENABLED=${value}${eol}`;

const CASES = [
	["nothing set", {}, undefined, false, false],
	["LOGROTATE", { LOGROTATE: "true" }, undefined, true, true],
	["TRAFFIC_STATS only", { TRAFFIC_STATS: "true" }, undefined, false, true],
	["CROWDSEC_ENABLED", { CROWDSEC_ENABLED: " True " }, undefined, true, true],
	["stored CrowdSec on", {}, stored("true", "\r\n"), true, true],
	["env off wins over the file", { CROWDSEC_ENABLED: "false" }, stored("true"), false, false],
	["invalid env: the file", { CROWDSEC_ENABLED: "yes" }, stored("true"), true, true],
	["stored off", {}, stored("false"), false, false],
];
for (const [name, env, conf, files, access] of CASES) {
	it(`writes the same log includes as the backend: ${name}`, () => {
		assert.deepEqual(run(env, conf), expected(files, access));
	});
}

it("ignores a crowdsec.conf that is a symlink", () => {
	assert.deepEqual(run({}, stored("true"), { link: true }), expected(false, false));
});

const JSON_INCLUDES = {
	"access-log.conf": accessLogDirective(true, "json"),
	"stream-log.conf": logIncludes(true, "json").stream,
};

it("NGINX_LOG_FORMAT=json names ajson and sjson", () => {
	assert.deepEqual(run({ LOGROTATE: "true", NGINX_LOG_FORMAT: "json" }), expected(true, true, "json"));
	assert.deepEqual(run({ TRAFFIC_STATS: "true", NGINX_LOG_FORMAT: "json" }), expected(false, true, "json"));
	assert.deepEqual(run({ NGINX_LOG_FORMAT: "json" }), expected(false, false, "json"));
});

it("NGINX_LOG_FORMAT=classic wins over an include that names json", () => {
	assert.deepEqual(
		run({ LOGROTATE: "true", NGINX_LOG_FORMAT: "classic" }, undefined, { before: JSON_INCLUDES }),
		expected(true, true),
	);
});

it("an empty NGINX_LOG_FORMAT keeps the json the includes name (backend setting, nginx and GoAccess start first)", () => {
	assert.deepEqual(run({ LOGROTATE: "true" }, undefined, { before: JSON_INCLUDES }), expected(true, true, "json"));
	assert.deepEqual(
		run({ LOGROTATE: "true", NGINX_LOG_FORMAT: "" }, undefined, { before: JSON_INCLUDES }),
		expected(true, true, "json"),
	);
	// either include names it
	assert.deepEqual(
		run({ TRAFFIC_STATS: "true" }, undefined, { before: { "access-log.conf": JSON_INCLUDES["access-log.conf"] } }),
		expected(false, true, "json"),
	);
	assert.deepEqual(
		run({ LOGROTATE: "true" }, undefined, { before: { "stream-log.conf": JSON_INCLUDES["stream-log.conf"] } }),
		expected(true, true, "json"),
	);
});

it("an empty NGINX_LOG_FORMAT without an include, or with classic or off includes, gives classic", () => {
	assert.deepEqual(run({ LOGROTATE: "true" }), expected(true, true));
	assert.deepEqual(
		run({ LOGROTATE: "true" }, undefined, {
			before: { "access-log.conf": accessLogDirective(true), "stream-log.conf": logIncludes(true).stream },
		}),
		expected(true, true),
	);
	assert.deepEqual(
		run({ LOGROTATE: "true" }, undefined, {
			before: { "access-log.conf": "access_log off;\n", "stream-log.conf": "access_log off;\n" },
		}),
		expected(true, true),
	);
});
