import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { logIncludes } from "../lib/log-files.js";
import { accessLogDirective } from "../lib/traffic/access-log.js";

const SCRIPT = path.join(import.meta.dirname, "../../rootfs/usr/local/bin/log-includes.sh");

const run = (env, conf, { link = false } = {}) => {
	const dir = mkdtempSync(path.join(tmpdir(), "log-includes-"));
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
const expected = (files, access) => ({ access: accessLogDirective(access), ...logIncludes(files) });

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
