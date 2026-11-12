import assert from "node:assert/strict";
import { readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { fileExists } from "./support/hosts.js";

// The first start after the update: a hand-edited crowdsec.conf (and a .local) becomes the crowdsec row
const HAND_EDITED = [
	"﻿# my bouncer",
	"ENABLED=true",
	'export API_URL="http://127.0.0.1:9"',
	"API_KEY=old-key # from cscli",
	"MODE=STREAM",
	"BAN_TEMPLATE_PATH=/var/lib/crowdsec/lua/templates/ban.html",
	"CACHE_SIZE=1000",
	"",
].join("\r\n");
const LOCAL = "APPSEC_FAILURE_ACTION=passthrough\n";
const HEADER = "# Written by NPMpro from Settings, CrowdSec. Changes here are overwritten.";

let api;
before(async () => {
	api = await startApi({
		files: {
			"/data/crowdsec/crowdsec.conf": HAND_EDITED,
			"/data/crowdsec/crowdsec.conf.local": LOCAL,
			"/data/crowdsec/ban.html": "<p>banned</p>",
		},
	});
});
after(() => api?.stop());

const storedMeta = async () => {
	const row = await api.db("setting").where({ id: "crowdsec" }).first();
	return typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
};

it("imports the file and its .local into the row, the key sealed", async () => {
	const meta = await storedMeta();
	assert.equal(meta.import_pending, undefined);
	assert.equal(typeof meta.imported_on, "string");
	assert.equal(meta.enabled, true);
	assert.equal(meta.api_url, "http://127.0.0.1:9");
	assert.equal(meta.mode, "stream");
	assert.equal(meta.appsec_failure_action, "passthrough");
	assert.equal(meta.ban_template_path, "/data/crowdsec/ban.html");
	assert.match(meta.api_key, /^v1:/u);
	assert.equal(JSON.stringify(meta).includes("old-key"), false);
});

it("keeps the old files and writes crowdsec.conf and the includes from the row", async () => {
	assert.equal(await api.read("/data/crowdsec/crowdsec.conf.before-settings"), HAND_EDITED);
	assert.equal(await api.read("/data/crowdsec/crowdsec.conf.local.before-settings"), LOCAL);
	assert.equal(await fileExists(api, "/data/crowdsec/crowdsec.conf.local"), false);
	const written = await api.read("/data/crowdsec/crowdsec.conf");
	assert.equal(written.split("\n")[0], HEADER);
	assert.match(written, /^API_KEY=old-key$/mu);
	assert.match(written, /^MODE=stream$/mu);
	assert.match(written, /^APPSEC_FAILURE_ACTION=passthrough$/mu);
	assert.equal((await stat(path.join(api.root, "data/crowdsec/crowdsec.conf"))).mode & 0o777, 0o600);
	assert.equal(
		await api.read("/data/npmpro/nginx/crowdsec.conf"),
		"include /usr/local/nginx/conf/crowdsec-bouncer.conf;\n",
	);
	assert.equal(
		await api.read("/data/npmpro/nginx/crowdsec-admin.conf"),
		"# the admin UI is checked by CrowdSec (Settings, CrowdSec)\n",
	);
});

it("does not import again: a later hand edit is overwritten at the next start", async () => {
	const { startCrowdsec } = await import("../internal/crowdsec-setting.js");
	await writeFile(path.join(api.root, "data/crowdsec/crowdsec.conf"), "ENABLED=false\n");
	const started = await startCrowdsec();
	assert.equal(started.values.enabled, true);
	assert.equal(started.nginxError, null);
	assert.match(await api.read("/data/crowdsec/crowdsec.conf"), /^ENABLED=true$/mu);
	assert.equal((await storedMeta()).enabled, true);
});

it("keeps the previous files when nginx -t fails at start", async () => {
	const { startCrowdsec } = await import("../internal/crowdsec-setting.js");
	const previous = await api.read("/data/crowdsec/crowdsec.conf");
	await writeFile(path.join(api.root, "data/crowdsec/crowdsec.conf"), "ENABLED=false\n");
	await api.outside.failCommand("nginx", "lua error: TLS client certificate");
	try {
		const started = await startCrowdsec();
		assert.match(started.nginxError, /lua error/u);
		assert.equal(await api.read("/data/crowdsec/crowdsec.conf"), "ENABLED=false\n");
	} finally {
		await api.outside.passCommand("nginx");
		await writeFile(path.join(api.root, "data/crowdsec/crowdsec.conf"), previous);
	}
});

it("never follows a link: a crowdsec.conf that is a link is not imported", async () => {
	const { importCrowdsecFile } = await import("../lib/crowdsec/import.js");
	const file = path.join(api.root, "data/crowdsec/crowdsec.conf");
	const previous = await readFile(file, "utf8");
	await writeFile(path.join(api.root, "elsewhere.txt"), "API_KEY=stolen-key\n");
	await rm(file);
	await symlink(path.join(api.root, "elsewhere.txt"), file);
	try {
		const result = await importCrowdsecFile({ log: { info: () => {}, warn: () => {} } });
		assert.equal(result.imported, false);
		assert.equal(JSON.stringify(await storedMeta()).includes("stolen-key"), false);
	} finally {
		await rm(file);
		await writeFile(file, previous);
	}
});

it("hides the row from the generic settings list", async () => {
	const admin = await api.admin();
	const list = await admin.get("/settings");
	assert.equal(list.status, 200);
	assert.equal(
		list.body.some((row) => row.id === "crowdsec"),
		false,
	);
});
