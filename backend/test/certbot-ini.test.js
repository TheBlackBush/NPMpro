import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { CERTBOT_INI_BASE, cleanRenewalProfiles, renderCertbotIni, renewalProfileEdits } from "../lib/certbot-ini.js";
import { mergeRuntimeConfig } from "../lib/runtime-rules.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HEAD = `logs-dir = /tmp/certbot-log
work-dir = /tmp/certbot-work
config-dir = /data/tls/certbot
webroot-path = /data/tls/certbot/acme-challenge

agree-tos = true
non-interactive  = true
no-random-sleep-on-renew = true
no-eff-email = true

`;

const expected = ({ rsaSize, curve, profileLine, keyType, mustStaple, noVerify }) =>
	`${HEAD}rsa-key-size = ${rsaSize}\nelliptic-curve = ${curve}\n\n${profileLine}\nkey-type = ${keyType}\nmust-staple = ${mustStaple}\nno-verify-ssl = ${noVerify}\n`;

const values = (overrides) => ({
	key_type: "ecdsa",
	key_size: "secp384r1",
	must_staple: true,
	server_tls_verify: true,
	profile: "",
	...overrides,
});

it("keeps the base equal to the image's certbot.ini", async () => {
	assert.equal(CERTBOT_INI_BASE, await readFile(path.join(ROOT, "rootfs/etc/certbot.ini"), "utf8"));
});

it("renders ecdsa curves", () => {
	assert.equal(
		renderCertbotIni(values({ key_size: "secp256r1" })),
		expected({
			rsaSize: 4096,
			curve: "secp256r1",
			profileLine: "#required-profile",
			keyType: "ecdsa",
			mustStaple: true,
			noVerify: false,
		}),
	);
	assert.equal(
		renderCertbotIni(values()),
		expected({
			rsaSize: 4096,
			curve: "secp384r1",
			profileLine: "#required-profile",
			keyType: "ecdsa",
			mustStaple: true,
			noVerify: false,
		}),
	);
});

it("renders rsa sizes and keeps the curve line", () => {
	assert.equal(
		renderCertbotIni(values({ key_type: "rsa", key_size: "2048" })),
		expected({
			rsaSize: 2048,
			curve: "secp384r1",
			profileLine: "#required-profile",
			keyType: "rsa",
			mustStaple: true,
			noVerify: false,
		}),
	);
	assert.equal(
		renderCertbotIni(values({ key_type: "rsa", key_size: "4096" })),
		expected({
			rsaSize: 4096,
			curve: "secp384r1",
			profileLine: "#required-profile",
			keyType: "rsa",
			mustStaple: true,
			noVerify: false,
		}),
	);
});

it("renders must-staple, no-verify-ssl and the profile", () => {
	assert.equal(
		renderCertbotIni(values({ must_staple: false, server_tls_verify: false, profile: "shortlived" })),
		expected({
			rsaSize: 4096,
			curve: "secp384r1",
			profileLine: "required-profile = shortlived",
			keyType: "ecdsa",
			mustStaple: false,
			noVerify: true,
		}),
	);
	assert.equal(
		renderCertbotIni(values({ profile: "" })),
		expected({
			rsaSize: 4096,
			curve: "secp384r1",
			profileLine: "#required-profile",
			keyType: "ecdsa",
			mustStaple: true,
			noVerify: false,
		}),
	);
});

it("renders from an already rendered file the same way", () => {
	const once = renderCertbotIni(values({ key_type: "rsa", key_size: "3072", profile: "classic" }));
	assert.equal(renderCertbotIni(values({ profile: "" }), once).includes("#required-profile\n"), true);
	assert.equal(renderCertbotIni(values({ profile: "x" }), once).includes("required-profile = x\n"), true);
});

// start.sh lines 3-23, run with sh against a copy of the image's certbot.ini
const startShCertbot = async () => {
	const lines = (await readFile(path.join(ROOT, "rootfs/usr/local/bin/start.sh"), "utf8")).split("\n");
	const cleanup = lines.findIndex((line) => line.includes("required_profile/d"));
	const end = lines.findIndex((line, index) => index > cleanup && line === "fi");
	return lines.slice(1, end + 1).join("\n");
};

const ENVS = [
	{ ACME_KEY_TYPE: "ecdsa", ACME_KEY_SIZE: "secp384r1", ACME_MUST_STAPLE: "false", ACME_PROFILE: "shortlived" },
	{ ACME_KEY_TYPE: "ecdsa", ACME_KEY_SIZE: "secp521r1", ACME_MUST_STAPLE: "true", ACME_PROFILE: "none" },
	{ ACME_KEY_TYPE: "rsa", ACME_KEY_SIZE: "4096", ACME_MUST_STAPLE: "false", ACME_SERVER_TLS_VERIFY: "false" },
	{ ACME_KEY_TYPE: "rsa", ACME_KEY_SIZE: "2048", ACME_MUST_STAPLE: "true", ACME_PROFILE: "classic" },
];

it("renders what start.sh writes for the same env", async () => {
	const script = await startShCertbot();
	for (const overrides of ENVS) {
		const env = {
			ACME_SERVER: "https://acme-v02.api.letsencrypt.org/directory",
			ACME_SERVER_TLS_VERIFY: "true",
			ACME_OCSP_STAPLING: "true",
			ACME_PROFILE: "none",
			...overrides,
		};
		const dir = await mkdtemp(path.join(tmpdir(), "certbot-ini-"));
		const ini = path.join(dir, "certbot.ini");
		await writeFile(ini, CERTBOT_INI_BASE);
		await mkdir(path.join(dir, "renewal"));
		const local = script
			.replaceAll("/etc/certbot.ini", ini)
			.replaceAll("/data/tls/certbot/renewal", `${dir}/renewal`);
		execFileSync("sh", ["-c", local], { env: { PATH: process.env.PATH, ...env } });
		const { values: merged } = mergeRuntimeConfig("certificates", {}, env);
		assert.equal(renderCertbotIni(merged), await readFile(ini, "utf8"), JSON.stringify(env));
	}
});

it("removes required_profile lines from renewal confs", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "renewal-"));
	await writeFile(
		path.join(dir, "a.conf"),
		"version = 5\n[renewalparams]\nrequired_profile = shortlived\nkey_type = ecdsa\n",
	);
	await writeFile(path.join(dir, "b.conf"), "version = 5\n");
	await writeFile(path.join(dir, "c.txt"), "required_profile = x\n");
	const edits = await renewalProfileEdits(dir);
	assert.deepEqual(edits, [
		{ path: path.join(dir, "a.conf"), content: "version = 5\n[renewalparams]\nkey_type = ecdsa\n" },
	]);
	assert.deepEqual(await cleanRenewalProfiles(dir), [path.join(dir, "a.conf")]);
	assert.equal(await readFile(path.join(dir, "a.conf"), "utf8"), "version = 5\n[renewalparams]\nkey_type = ecdsa\n");
	assert.equal(await readFile(path.join(dir, "c.txt"), "utf8"), "required_profile = x\n");
	assert.deepEqual(await renewalProfileEdits(path.join(dir, "missing")), []);
});
