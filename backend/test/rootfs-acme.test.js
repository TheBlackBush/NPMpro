import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const BIN = new URL("../../rootfs/usr/local/bin/", import.meta.url);
const read = (name) => readFile(new URL(name, BIN), "utf8");
const BLOCK = /# acme-profile-check begin\n(?<code>[\s\S]*?)# acme-profile-check end/u;

it("launch.sh registers no ACME account and fetches no ZeroSSL key", async () => {
	const text = await read("launch.sh");
	assert.doesNotMatch(text, /certbot[^\n]*register/u);
	assert.doesNotMatch(text, /eab-credentials-email|ACME_EAB|ACME_EMAIL/u);
});

it("envs.sh reads the ACME directory with a 10 second limit", async () => {
	const curls = (await read("envs.sh"))
		.split("\n")
		.filter((line) => line.includes("curl") && line.includes("ACME_SERVER"));
	assert.ok(curls.length > 0);
	for (const line of curls) assert.match(line, /--max-time 10/u, line);
});

it("envs.sh stops on an unsupported profile only for an ACME_SERVER the env set", async () => {
	const code = BLOCK.exec(await read("envs.sh")).groups.code;
	const dir = await mkdtemp(path.join(os.tmpdir(), "acme-profile-"));
	await writeFile(
		path.join(dir, "curl"),
		'#!/bin/sh\necho \'{"newNonce": "x", "meta": {"profiles": {"classic": ""}}}\'\n',
	);
	await chmod(path.join(dir, "curl"), 0o755);
	const script = `sleep() { echo SLEEP; exit 0; }\n${code}\necho DONE\n`;
	const env = { PATH: `${dir}:${process.env.PATH}`, ACME_PROFILE: "missing", ACME_SERVER: "https://ca.lan/dir" };
	const fromEnv = await run("sh", ["-c", script], { env: { ...env, acme_server_stored: "false" } });
	assert.match(fromEnv.stdout, /SLEEP/u);
	const stored = await run("sh", ["-c", script], { env: { ...env, acme_server_stored: "true" } });
	assert.doesNotMatch(stored.stdout, /SLEEP/u);
	assert.match(stored.stdout, /DONE/u);
});
