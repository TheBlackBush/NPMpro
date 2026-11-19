import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
	accountConfigText,
	accountDirsOf,
	accountExists,
	listAccountIds,
	listRenewalConfs,
	registerArgs,
	requestOptionArgs,
	serverFolders,
	serverOfFolder,
	serverPath,
	setRenewalParams,
	unregisterArgs,
	updateEmailArgs,
	writeFileAtomic,
} from "../lib/certbot-account.js";

const LE = "https://acme-v02.api.letsencrypt.org/directory";
const PEBBLE = "https://pebble:14000/dir";
const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);
const INI =
	"logs-dir = /tmp/certbot-log\nwork-dir = /tmp/certbot-work\nconfig-dir = /data/tls/certbot\nagree-tos = true\nemail = old@x.y\n";

const account = async (dir, id, created) => {
	await mkdir(path.join(dir, id), { recursive: true });
	await writeFile(path.join(dir, id, "regr.json"), "{}");
	await writeFile(path.join(dir, id, "private_key.json"), "{}");
	if (created) await writeFile(path.join(dir, id, "meta.json"), JSON.stringify({ creation_dt: created }));
};

it("names certbot's server folder like configuration.server_path, and the v01 folder Let's Encrypt reuses", () => {
	assert.equal(serverPath(PEBBLE), "pebble:14000/dir");
	assert.deepEqual(accountDirsOf(LE, "/acc"), [
		"/acc/acme-v02.api.letsencrypt.org/directory",
		"/acc/acme-v01.api.letsencrypt.org/directory",
	]);
	assert.deepEqual(accountDirsOf(PEBBLE, "/acc"), ["/acc/pebble:14000/dir"]);
	assert.equal(serverOfFolder("acme-v01.api.letsencrypt.org/directory"), LE);
	assert.equal(serverOfFolder("pebble:14000/dir"), PEBBLE);
});

it("lists the accounts of a server oldest first, through the v01 folder and a symlinked server folder", async () => {
	const accountsDir = await mkdtemp(path.join(os.tmpdir(), "acc-"));
	const v01 = path.join(accountsDir, "acme-v01.api.letsencrypt.org/directory");
	await account(v01, ID_B, "2024-01-01T00:00:00Z");
	await account(v01, ID_A, "2023-01-01T00:00:00Z");
	await mkdir(path.join(v01, "not-an-account"));
	// restored from a backup without secrets: no key, so certbot cannot use it and it does not count
	await mkdir(path.join(v01, "c".repeat(32)));
	await writeFile(path.join(v01, "c".repeat(32), "regr.json"), "{}");
	await mkdir(path.join(accountsDir, "acme-v02.api.letsencrypt.org"), { recursive: true });
	await symlink(v01, path.join(accountsDir, "acme-v02.api.letsencrypt.org/directory"));
	const ids = await listAccountIds(LE, { accountsDir });
	assert.deepEqual(
		ids.map((entry) => entry.id),
		[ID_A, ID_B],
	);
	assert.equal(await accountExists(LE, ID_B, { accountsDir }), true);
	assert.equal(await accountExists(PEBBLE, ID_B, { accountsDir }), false);
	assert.deepEqual(await serverFolders({ accountsDir }), [
		"acme-v01.api.letsencrypt.org/directory",
		"acme-v02.api.letsencrypt.org/directory",
	]);
});

it("builds a run config without account lines from the base, with the folders, email and EAB in the file", () => {
	const text = accountConfigText(INI, {
		logsDir: "/r/logs",
		workDir: "/r/work",
		email: "me@x.y",
		eab: { kid: "kid1", hmac: "hmac1" },
	});
	assert.equal(
		text,
		"logs-dir = /r/logs\nwork-dir = /r/work\nconfig-dir = /data/tls/certbot\nagree-tos = true\nemail = me@x.y\neab-kid = kid1\neab-hmac-key = hmac1\n",
	);
	assert.match(accountConfigText(INI, { logsDir: "/l", workDir: "/w", configDir: "/c" }), /^config-dir = \/c$/mu);
	assert.doesNotMatch(accountConfigText(INI, { logsDir: "/l", workDir: "/w" }), /email/u);
	for (const bad of ["a@b.c\npre-hook = id", "a@b.c\r", "x\u0000"]) {
		assert.throws(
			() => accountConfigText(INI, { logsDir: "/l", workDir: "/w", email: bad }),
			/line break or control character/u,
		);
		assert.throws(
			() => accountConfigText(INI, { logsDir: "/l", workDir: "/w", eab: { kid: bad, hmac: "h" } }),
			/line break or control character/u,
		);
	}
});

it("never puts the email or the EAB pair on the command line", () => {
	assert.deepEqual(registerArgs("/r/c.ini", PEBBLE, { withEmail: true }), [
		"--config",
		"/r/c.ini",
		"register",
		"--server",
		PEBBLE,
	]);
	assert.deepEqual(registerArgs("/r/c.ini", PEBBLE, { withEmail: false }), [
		"--config",
		"/r/c.ini",
		"register",
		"--server",
		PEBBLE,
		"--register-unsafely-without-email",
	]);
	assert.deepEqual(updateEmailArgs("/r/c.ini", PEBBLE, ID_A, { withEmail: false }), [
		"--config",
		"/r/c.ini",
		"update_account",
		"--server",
		PEBBLE,
		"--account",
		ID_A,
		"--register-unsafely-without-email",
	]);
	assert.deepEqual(unregisterArgs("/i.ini", PEBBLE, ID_A), [
		"--config",
		"/i.ini",
		"unregister",
		"--server",
		PEBBLE,
		"--account",
		ID_A,
	]);
	assert.deepEqual(requestOptionArgs({ profile: "classic", must_staple: true }), [
		"--required-profile",
		"classic",
		"--must-staple",
	]);
	assert.deepEqual(requestOptionArgs({ profile: "", must_staple: false }), []);
});

it("sets, replaces and removes renewal params only inside [renewalparams]", () => {
	const conf =
		"version = 5.10.0\ncert = /x\n\n[renewalparams]\naccount = old\nserver = https://a/dir\nrequired_profile = classic\nmust_staple = True\n\n[[webroot_map]]\na.example = /w\n";
	assert.equal(
		setRenewalParams(conf, { account: "new", required_profile: null, must_staple: "False" }),
		"version = 5.10.0\ncert = /x\n\n[renewalparams]\naccount = new\nmust_staple = False\nserver = https://a/dir\n\n[[webroot_map]]\na.example = /w\n",
	);
	assert.equal(setRenewalParams("no sections\n", { account: "x" }), "no sections\n");
});

it("lists the renewal confs with their server and account, and writes a file through a rename", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "ren-"));
	await writeFile(path.join(dir, "npm-12.conf"), "[renewalparams]\naccount = abc\nserver = https://a/dir\n");
	await writeFile(path.join(dir, "other.conf"), "[renewalparams]\n");
	assert.deepEqual(
		(await listRenewalConfs({ dir })).map(({ certificateId, server, account }) => ({
			certificateId,
			server,
			account,
		})),
		[{ certificateId: 12, server: "https://a/dir", account: "abc" }],
	);
	assert.deepEqual(await listRenewalConfs({ dir: path.join(dir, "missing") }), []);
	await writeFileAtomic(path.join(dir, "npm-12.conf"), "new\n");
	assert.equal(await readFile(path.join(dir, "npm-12.conf"), "utf8"), "new\n");
});
