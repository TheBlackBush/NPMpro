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
	const stdout = execFileSync("sh", [SCRIPT, dir, crowdsecConf], {
		env: { PATH: process.env.PATH, ...env },
		encoding: "utf8",
	});
	const read = (name) => readFileSync(path.join(dir, name), "utf8");
	const files = {
		access: read("access-log.conf"),
		error: read("error-log.conf"),
		stream: read("stream-log.conf"),
		tls: read("tls-log.conf"),
	};
	// the note the script prints
	Object.defineProperty(files, "stdout", { value: stdout, enumerable: false });
	return files;
};
const expected = (files, access, format = "classic", tls = false) => ({
	access: accessLogDirective(access, format),
	...logIncludes(files, format, tls),
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

const TLS_ON = logIncludes(true, "classic", true).tls;
const TLS_OFF = logIncludes(true).tls;

it("NGINX_TLS_HANDSHAKE_LOG=true writes tls.log with the log files on (LOGROTATE or CrowdSec)", () => {
	assert.deepEqual(
		run({ LOGROTATE: "true", NGINX_TLS_HANDSHAKE_LOG: "true" }),
		expected(true, true, "classic", true),
	);
	assert.deepEqual(
		run({ CROWDSEC_ENABLED: "true", NGINX_TLS_HANDSHAKE_LOG: "true" }),
		expected(true, true, "classic", true),
	);
	assert.equal(run({ LOGROTATE: "true", NGINX_TLS_HANDSHAKE_LOG: "true" }).tls, TLS_ON);
});

it("NGINX_TLS_HANDSHAKE_LOG=true with the log files off writes the comment and says so", () => {
	const result = run({ NGINX_TLS_HANDSHAKE_LOG: "true" });
	assert.deepEqual(result, expected(false, false));
	assert.equal(result.tls, TLS_OFF);
	assert.ok(result.stdout.includes("NGINX_TLS_HANDSHAKE_LOG is true, but no TLS handshake log is written"));
	assert.equal(run({ LOGROTATE: "true" }).stdout, "");
});

it("an unset NGINX_TLS_HANDSHAKE_LOG keeps the state of the include written last (backend setting, nginx starts first)", () => {
	const before = { "tls-log.conf": TLS_ON };
	assert.equal(run({ LOGROTATE: "true" }, undefined, { before }).tls, TLS_ON);
	assert.equal(run({}, undefined, { before }).tls, TLS_OFF);
	assert.equal(run({ LOGROTATE: "true" }).tls, TLS_OFF);
});

it("NGINX_TLS_HANDSHAKE_LOG=false wins over an include that is on", () => {
	assert.equal(
		run({ LOGROTATE: "true", NGINX_TLS_HANDSHAKE_LOG: "false" }, undefined, { before: { "tls-log.conf": TLS_ON } })
			.tls,
		TLS_OFF,
	);
});
