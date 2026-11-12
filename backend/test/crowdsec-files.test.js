import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
