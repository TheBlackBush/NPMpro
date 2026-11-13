import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { ADMIN_CHECKED, INCLUDE_OFF, INCLUDE_ON } from "../lib/crowdsec/files.js";
import { clientPemFiles, opensslMissing } from "./support/tls-files.js";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const echoOf = (content, name) => `echo "${content.trimEnd()}" > /data/npmpro/nginx/${name}`;

it("writes the same include lines in the startup scripts as the backend", () => {
	const dataSetup = read("rootfs/usr/local/bin/data-setup.sh");
	assert.ok(dataSetup.includes(echoOf(INCLUDE_ON, "crowdsec.conf")));
	assert.ok(dataSetup.includes(echoOf(INCLUDE_OFF, "crowdsec.conf")));
	assert.ok(dataSetup.includes(echoOf(ADMIN_CHECKED, "crowdsec-admin.conf")));
	const launch = read("rootfs/usr/local/bin/launch.sh");
	assert.ok(launch.includes(echoOf(INCLUDE_OFF, "crowdsec.conf")));
	assert.ok(launch.includes(echoOf(INCLUDE_ON, "crowdsec.conf")));
});

it("reads the files where the backend writes them", () => {
	const nginxConf = read("rootfs/usr/local/nginx/conf/nginx.conf");
	assert.match(nginxConf, /^ {2}include \/data\/npmpro\/nginx\/crowdsec\.conf;$/mu);
	assert.match(nginxConf, /map \$host \$npmpro_crowdsec_skip \{\n {4}default 0;\n {2}\}/u);
	assert.match(
		read("rootfs/usr/local/nginx/conf/conf.d/npmpro.conf"),
		/^ {2}include \/data\/npmpro\/nginx\/crowdsec-admin\.conf;$/mu,
	);
	assert.ok(INCLUDE_ON.includes("/usr/local/nginx/conf/crowdsec-bouncer.conf"));
	const bouncer = read("rootfs/usr/local/nginx/conf/crowdsec-bouncer.conf");
	assert.match(bouncer, /if ngx\.var\.unix == "1" or ngx\.var\.npmpro_crowdsec_skip == "1" then/u);
	assert.match(bouncer, /cs\.init\("\/data\/crowdsec\/crowdsec\.conf"/u);
});

it("no longer switches the bouncer in start.sh or copies the example config", () => {
	assert.equal(read("rootfs/usr/local/bin/start.sh").includes("crowdsec.conf.disabled"), false);
	assert.equal(read("rootfs/usr/local/bin/data-setup.sh").includes("cp -van /etc/crowdsec.conf.example"), false);
});

// launch.sh checks the files the bouncer cannot start without, before nginx starts: the block runs here under sh
// against a temporary /data
const CHECK = /# crowdsec-files-check begin\n([\s\S]*?)# crowdsec-files-check end/u;
const runCheck = (root, conf) => {
	mkdirSync(path.join(root, "data/npmpro/nginx"), { recursive: true });
	mkdirSync(path.join(root, "data/crowdsec"), { recursive: true });
	writeFileSync(path.join(root, "data/npmpro/nginx/crowdsec.conf"), INCLUDE_ON);
	const confFile = path.join(root, "data/crowdsec/crowdsec.conf");
	// null: no crowdsec.conf, undefined: leave it as it is
	if (conf === null) rmSync(confFile, { force: true });
	else if (conf !== undefined) writeFileSync(confFile, conf);
	const script = read("rootfs/usr/local/bin/launch.sh").match(CHECK)[1].replaceAll("/data/", `${root}/data/`);
	const run = spawnSync("sh", ["-c", script], { encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr);
	return { out: run.stdout, include: readFileSync(path.join(root, "data/npmpro/nginx/crowdsec.conf"), "utf8") };
};
const offLine = (file) =>
	`CrowdSec: ${file} is not set, missing, unreadable or not valid PEM, the bouncer stays off until it is fixed (Settings, CrowdSec)\n`;

it("launch.sh turns the bouncer off while crowdsec.conf is missing or not a readable file", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "csl-"));
	try {
		const conf = `${root}/data/crowdsec/crowdsec.conf`;
		const missing = runCheck(root, null);
		assert.equal(missing.include, INCLUDE_OFF);
		assert.equal(missing.out, offLine(conf));
		mkdirSync(conf);
		assert.equal(runCheck(root, undefined).include, INCLUDE_OFF);
		rmSync(conf, { recursive: true });
		const present = runCheck(root, "ENABLED=true\n");
		assert.equal(present.include, INCLUDE_ON);
		assert.equal(present.out, "");
		if (process.getuid?.() !== 0) {
			writeFileSync(conf, "ENABLED=true\n");
			chmodSync(conf, 0o000);
			assert.equal(runCheck(root, undefined).include, INCLUDE_OFF);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("launch.sh does not check the ban and captcha pages: the bouncer runs without them", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "csl-"));
	try {
		const conf = [
			"ENABLED=true",
			`BAN_TEMPLATE_PATH=${root}/data/crowdsec/ban.html`,
			"CAPTCHA_PROVIDER=turnstile",
			`CAPTCHA_TEMPLATE_PATH=${root}/data/crowdsec/captcha.html`,
			"",
		].join("\n");
		const result = runCheck(root, conf);
		assert.equal(result.include, INCLUDE_ON);
		assert.equal(result.out, "");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("launch.sh turns the bouncer off while a TLS client file is not set, missing or not valid PEM", {
	skip: opensslMissing && "openssl not available",
}, () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "csl-"));
	try {
		const dir = `${root}/data/crowdsec`;
		mkdirSync(dir, { recursive: true });
		const pem = clientPemFiles(dir);
		const tls = (crt, key) =>
			["ENABLED=true", "USE_TLS_AUTH=true  ", `TLS_CLIENT_CERT=${crt}\r`, `TLS_CLIENT_KEY=${key}\r`, ""].join(
				"\n",
			);
		const good = runCheck(root, tls(pem.crt, pem.key));
		assert.equal(good.include, INCLUDE_ON);
		assert.equal(good.out, "");
		const gone = `${dir}/gone.key`;
		const missing = runCheck(root, tls(pem.crt, gone));
		assert.equal(missing.include, INCLUDE_OFF);
		assert.equal(missing.out, offLine(gone));
		// an empty certificate, a corrupt key, a DER certificate, an encrypted key, the two files swapped
		const empty = `${dir}/empty.crt`;
		writeFileSync(empty, "");
		const corrupt = `${dir}/corrupt.key`;
		writeFileSync(corrupt, readFileSync(pem.key, "utf8").slice(0, 60));
		const cases = [
			[tls(empty, pem.key), empty],
			[tls(pem.crt, corrupt), corrupt],
			[tls(pem.der, pem.key), pem.der],
			[tls(pem.crt, pem.encrypted), pem.encrypted],
			[tls(pem.key, pem.crt), pem.key],
			[tls("", pem.key), "TLS_CLIENT_CERT"],
			[tls(pem.crt, ""), "TLS_CLIENT_KEY"],
		];
		for (const [conf, named] of cases) {
			const result = runCheck(root, conf);
			assert.equal(result.include, INCLUDE_OFF, conf);
			assert.equal(result.out, offLine(named), conf);
		}
		// TLS auth off: the TLS files are not opened
		assert.equal(runCheck(root, `USE_TLS_AUTH=false\nTLS_CLIENT_KEY=${gone}\n`).include, INCLUDE_ON);
		// the reading of the backend: key case, export, quotes, inline comments, tabs
		const forms = [
			`USE_TLS_AUTH="true"\nTLS_CLIENT_CERT=${pem.crt}\nTLS_CLIENT_KEY=${gone}\n`,
			`use_tls_auth='TRUE'\nTLS_CLIENT_CERT=${pem.crt}\ntls_client_key = "${gone}"\n`,
			`export USE_TLS_AUTH=true # on\nTLS_CLIENT_CERT=${pem.crt}\nexport TLS_CLIENT_KEY=${gone}\t# gone\n`,
			`USE_TLS_AUTH=true\nTLS_CLIENT_CERT=${pem.crt}\nTLS_CLIENT_KEY='${gone}'\t\n`,
		];
		for (const form of forms) {
			const result = runCheck(root, form);
			assert.equal(result.include, INCLUDE_OFF, form);
			assert.equal(result.out, offLine(gone), form);
		}
		// a # inside quotes is part of the path, a # without a space before it too; a glob character is not expanded
		const odd = `${dir}/c#1*`;
		writeFileSync(odd, readFileSync(pem.crt));
		assert.equal(
			runCheck(root, `USE_TLS_AUTH=true\nTLS_CLIENT_CERT="${odd}"\nTLS_CLIENT_KEY=${pem.key} # k\n`).include,
			INCLUDE_ON,
		);
		assert.equal(
			runCheck(root, `USE_TLS_AUTH=true\nTLS_CLIENT_CERT=${odd}\nTLS_CLIENT_KEY=${pem.key}\n`).include,
			INCLUDE_ON,
		);
		assert.equal(
			runCheck(root, `USE_TLS_AUTH=true\nTLS_CLIENT_CERT=${dir}/c*\nTLS_CLIENT_KEY=${pem.key}\n`).include,
			INCLUDE_OFF,
		);
		if (process.getuid?.() !== 0) {
			chmodSync(pem.key, 0o000);
			assert.equal(runCheck(root, tls(pem.crt, pem.key)).include, INCLUDE_OFF);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
