import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { CERTBOT_INI, CERTBOT_INI_BASE, renderCertbotIni, renewalOptionEdits } from "../lib/certbot-ini.js";
import { mergeRuntimeConfig } from "../lib/runtime-rules.js";

const NO_SERVER_OPTIONS = /required-profile|must-staple/u;
const CURVE_LINE = /^elliptic-curve = secp256r1$/mu;
const VERIFY_LINE = /^no-verify-ssl = true$/mu;
const PROFILE_LINE = /^required_profile = classic$/mu;
const STAPLE_FALSE_LINE = /^must_staple = False$/mu;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HEAD = `logs-dir = /tmp/certbot-log
work-dir = /tmp/certbot-work
config-dir = /data/tls/certbot
webroot-path = /data/public/acme-challenge

agree-tos = true
non-interactive  = true
no-random-sleep-on-renew = true
no-eff-email = true

`;

const expected = ({ rsaSize, curve, keyType, noVerify }) =>
	`${HEAD}rsa-key-size = ${rsaSize}\nelliptic-curve = ${curve}\n\nkey-type = ${keyType}\nno-verify-ssl = ${noVerify}\n`;

const values = (overrides) => ({
	key_type: "ecdsa",
	key_size: "secp384r1",
	server_tls_verify: true,
	...overrides,
});

it("keeps the base equal to the image's certbot.ini", async () => {
	assert.equal(CERTBOT_INI_BASE, await readFile(path.join(ROOT, "rootfs/etc/certbot.ini"), "utf8"));
});

it("renders ecdsa curves and rsa sizes", () => {
	assert.equal(
		renderCertbotIni(values({ key_size: "secp256r1" })),
		expected({
			rsaSize: 4096,
			curve: "secp256r1",
			keyType: "ecdsa",
			noVerify: false,
		}),
	);
	assert.equal(
		renderCertbotIni(values()),
		expected({
			rsaSize: 4096,
			curve: "secp384r1",
			keyType: "ecdsa",
			noVerify: false,
		}),
	);
	assert.equal(
		renderCertbotIni(values({ key_type: "rsa", key_size: "2048" })),
		expected({
			rsaSize: 2048,
			curve: "secp384r1",
			keyType: "rsa",
			noVerify: false,
		}),
	);
	assert.equal(
		renderCertbotIni(values({ key_type: "rsa", key_size: "4096" })),
		expected({
			rsaSize: 4096,
			curve: "secp384r1",
			keyType: "rsa",
			noVerify: false,
		}),
	);
});

it("keeps the server-dependent options out of the ini: no required-profile, no must-staple", () => {
	const text = renderCertbotIni({
		key_type: "ecdsa",
		key_size: "secp256r1",
		server_tls_verify: false,
		profile: "x",
		must_staple: true,
	});
	assert.doesNotMatch(text, NO_SERVER_OPTIONS);
	assert.match(text, CURVE_LINE);
	assert.match(text, VERIFY_LINE);
});

// start.sh's certbot block (copy to /run/npmpro and seds), run with sh in a temp folder
const startShCertbot = async () => {
	const lines = (await readFile(path.join(ROOT, "rootfs/usr/local/bin/start.sh"), "utf8")).split("\n");
	const start = lines.indexOf("cp /etc/certbot.ini /run/npmpro/certbot.ini");
	const verify = lines.findIndex((line) => line.includes("no-verify-ssl = false"));
	const end = lines.findIndex((line, index) => index > verify && line === "fi");
	return lines.slice(start, end + 1).join("\n");
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
		const image = path.join(dir, "image-certbot.ini");
		await writeFile(image, CERTBOT_INI_BASE);
		await mkdir(path.join(dir, "renewal"));
		const local = script
			.replaceAll("/etc/certbot.ini", image)
			.replaceAll("/run/npmpro", dir)
			.replaceAll("/data/tls/certbot/renewal", `${dir}/renewal`);
		execFileSync("sh", ["-c", local], { env: { PATH: process.env.PATH, ...env } });
		const { values: merged } = mergeRuntimeConfig("certificates", {}, env);
		assert.equal(renderCertbotIni(merged), await readFile(ini, "utf8"), JSON.stringify(env));
	}
});

it("sets required_profile and must_staple in the renewal confs of one CA only", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "renewal-"));
	const conf = (server, extra = "") => `version = 5.10.0\n[renewalparams]\nserver = ${server}\n${extra}`;
	await writeFile(
		path.join(dir, "npm-1.conf"),
		conf("https://a/dir", "required_profile = old\nmust_staple = True\n"),
	);
	await writeFile(path.join(dir, "npm-2.conf"), conf("https://b/dir", "must_staple = True\n"));
	await writeFile(
		path.join(dir, "npm-3.conf"),
		conf("https://a/dir", "required_profile = classic\nmust_staple = False\n"),
	);
	const edits = await renewalOptionEdits({ server: "https://a/dir", profile: "classic", mustStaple: false, dir });
	assert.deepEqual(
		edits.map((edit) => path.basename(edit.path)),
		["npm-1.conf"],
	);
	assert.match(edits[0].content, PROFILE_LINE);
	assert.match(edits[0].content, STAPLE_FALSE_LINE);
	const cleared = await renewalOptionEdits({ server: "https://a/dir", profile: "", mustStaple: false, dir });
	assert.ok(cleared.every((edit) => !edit.content.includes("required_profile")));
	assert.deepEqual(
		await renewalOptionEdits({
			server: "https://a/dir",
			profile: "",
			mustStaple: false,
			dir: path.join(dir, "none"),
		}),
		[],
	);
});

it("points every certbot call at the live config, not the root-owned /etc copy", async () => {
	assert.equal(CERTBOT_INI, "/run/npmpro/certbot.ini");
	const startSh = await readFile(path.join(ROOT, "rootfs/usr/local/bin/start.sh"), "utf8");
	assert.deepEqual(
		startSh.split("\n").filter((line) => line.includes("/etc/certbot.ini")),
		["cp /etc/certbot.ini /run/npmpro/certbot.ini"],
	);
	const launchSh = await readFile(path.join(ROOT, "rootfs/usr/local/bin/launch.sh"), "utf8");
	assert.equal(launchSh.includes("/etc/certbot.ini"), false);
});
