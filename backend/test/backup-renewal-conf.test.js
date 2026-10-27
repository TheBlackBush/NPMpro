import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { accountIds, namedAccounts, rebuildRenewalConf } from "../lib/backup/renewal-conf.js";

const ACCOUNT = "a".repeat(32);
const options = { id: 7, dataDir: "/data", accounts: new Set([ACCOUNT]) };
const HOOK = /hook/u;
const LABEL = /a\.example\.com/u;
const ETC = /\/etc/u;

it("refuses a renewal conf without a known authenticator", () => {
	// biome-ignore lint/security/noSecrets: a renewal conf sample, not a secret
	for (const text of ["", "[renewalparams]\nauthenticator = manual\n", "authenticator = webroot\n"]) {
		assert.throws(
			() => rebuildRenewalConf(text, { ...options, label: "a.example.com" }),
			(error) => {
				assert.equal(error.code, "invalid-item");
				assert.match(error.message, LABEL);
				return true;
			},
		);
	}
});

it("drops hooks, quoted or odd values and a webroot_map outside renewalparams", () => {
	const conf = rebuildRenewalConf(
		[
			"[[webroot_map]]",
			"x.example.com = /etc",
			"[renewalparams]",
			"authenticator = webroot",
			"renew_hook = rm -rf /",
			"key_type = 'rsa'",
			"rsa_key_size = 4096 ; rm",
			"must_staple = True",
			"server = https://evil.example.com/dir\\nx",
			"[other]",
			"deploy_hook = rm -rf /",
		].join("\n"),
		options,
	);
	assert.doesNotMatch(conf, HOOK);
	assert.doesNotMatch(conf, ETC);
	assert.equal(conf.includes("x.example.com"), false);
	assert.equal(conf.includes("key_type"), false);
	assert.equal(conf.includes("rsa_key_size"), false);
	assert.equal(conf.includes("server"), false);
	assert.equal(conf.includes("must_staple = True"), true);
	assert.equal(conf.includes("archive_dir = /data/tls/certbot/archive/npm-7"), true);
});

it("finds the account ids of a data folder and those renewal confs name", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "renewal-conf-"));
	try {
		await mkdir(path.join(dir, `tls/certbot/accounts/acme-v02.api.letsencrypt.org/directory/${ACCOUNT}`), {
			recursive: true,
		});
		await mkdir(path.join(dir, "tls/certbot/accounts/acme-v02.api.letsencrypt.org/directory/not-an-id"));
		assert.deepEqual([...(await accountIds(dir))], [ACCOUNT]);
		assert.deepEqual([...(await accountIds(path.join(dir, "missing")))], []);
		assert.deepEqual(
			// biome-ignore lint/security/noSecrets: a renewal conf sample, not a secret
			[...namedAccounts([`[renewalparams]\naccount = ${ACCOUNT}\n`, "[renewalparams]\naccount = ../x\n", ""])],
			[ACCOUNT],
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("reads a webroot_map only below renewalparams", () => {
	const conf = rebuildRenewalConf(
		// biome-ignore lint/security/noSecrets: a renewal conf sample, not a secret
		"[renewalparams]\nauthenticator = webroot\n[other]\n[[webroot_map]]\nx.example.com = /etc\n",
		options,
	);
	assert.equal(conf.includes("x.example.com"), false);
});
