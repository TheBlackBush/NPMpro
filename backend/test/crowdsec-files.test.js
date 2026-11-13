import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { ADMIN_CHECKED, INCLUDE_OFF, INCLUDE_ON } from "../lib/crowdsec/files.js";

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

// launch.sh checks the files the bouncer opens at start, before nginx starts: the block runs here under sh against a
// temporary /data
const CHECK = /# crowdsec-files-check begin\n([\s\S]*?)# crowdsec-files-check end/u;
const runCheck = (root, conf) => {
	mkdirSync(path.join(root, "data/npmpro/nginx"), { recursive: true });
	mkdirSync(path.join(root, "data/crowdsec"), { recursive: true });
	writeFileSync(path.join(root, "data/npmpro/nginx/crowdsec.conf"), INCLUDE_ON);
	writeFileSync(path.join(root, "data/crowdsec/crowdsec.conf"), conf);
	const script = read("rootfs/usr/local/bin/launch.sh").match(CHECK)[1].replaceAll("/data/", `${root}/data/`);
	const run = spawnSync("sh", ["-c", script], { encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr);
	return { out: run.stdout, include: readFileSync(path.join(root, "data/npmpro/nginx/crowdsec.conf"), "utf8") };
};

it("launch.sh turns the bouncer off while a file it opens at start is missing", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "csl-"));
	try {
		const crt = `${root}/data/crowdsec/client.crt`;
		const key = `${root}/data/crowdsec/client.key`;
		mkdirSync(path.dirname(crt), { recursive: true });
		writeFileSync(crt, "x");
		const conf = [
			"ENABLED=true",
			"USE_TLS_AUTH=true  ",
			`TLS_CLIENT_CERT=${crt}\r`,
			`TLS_CLIENT_KEY=${key}\r`,
			"",
		].join("\n");
		const missing = runCheck(root, conf);
		assert.equal(missing.include, INCLUDE_OFF);
		assert.equal(
			missing.out,
			`CrowdSec: ${key} is missing or unreadable, the bouncer stays off until it is fixed (Settings, CrowdSec)\n`,
		);
		writeFileSync(key, "x");
		const present = runCheck(root, conf);
		assert.equal(present.include, INCLUDE_ON);
		assert.equal(present.out, "");
		// TLS auth off: the TLS files are not opened; a set but absent ban page is
		const tlsOff = runCheck(root, `USE_TLS_AUTH=false\nTLS_CLIENT_KEY=${root}/none\nBAN_TEMPLATE_PATH=\n`);
		assert.equal(tlsOff.include, INCLUDE_ON);
		const banned = runCheck(root, `BAN_TEMPLATE_PATH=${root}/data/crowdsec/ban.html\n`);
		assert.equal(banned.include, INCLUDE_OFF);
		const captcha = runCheck(root, `CAPTCHA_TEMPLATE_PATH=${root}/data/crowdsec/captcha.html\n`);
		assert.equal(captcha.include, INCLUDE_OFF);
		// the reading of the backend: key case, export, quotes, inline comments, tabs
		const gone = `${root}/gone/k`;
		const forms = [
			`USE_TLS_AUTH="true"\nTLS_CLIENT_CERT=${crt}\nTLS_CLIENT_KEY=${gone}\n`,
			`use_tls_auth='TRUE'\nTLS_CLIENT_CERT=${crt}\ntls_client_key = "${gone}"\n`,
			`export USE_TLS_AUTH=true # on\nTLS_CLIENT_CERT=${crt}\nexport TLS_CLIENT_KEY=${gone}\t# gone\n`,
			`USE_TLS_AUTH=true\nTLS_CLIENT_CERT=${crt}\nTLS_CLIENT_KEY='${gone}'\t\n`,
			`BAN_TEMPLATE_PATH=${gone} # c\n`,
		];
		for (const form of forms) {
			const result = runCheck(root, form);
			assert.equal(result.include, INCLUDE_OFF, form);
			assert.ok(result.out.startsWith(`CrowdSec: ${gone} is missing`), form);
		}
		// a # inside quotes is part of the path, a # without a space before it too
		writeFileSync(`${crt}#1`, "x");
		assert.equal(
			runCheck(root, `BAN_TEMPLATE_PATH="${crt}#1"\nCAPTCHA_TEMPLATE_PATH=${crt}#1\n`).include,
			INCLUDE_ON,
		);
		assert.equal(runCheck(root, `BAN_TEMPLATE_PATH=${crt} # a note\n`).include, INCLUDE_ON);
		if (process.getuid?.() !== 0) {
			chmodSync(key, 0o000);
			assert.equal(runCheck(root, conf).include, INCLUDE_OFF);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
