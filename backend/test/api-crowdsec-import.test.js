import assert from "node:assert/strict";
import { chmod, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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

it("switches the bouncer off, not nginx, while a file it opens at start is missing, and back on once it is there", async () => {
	const { startCrowdsec } = await import("../internal/crowdsec-setting.js");
	const { renderStartupBlock, startupWarnings } = await import("../lib/crowdsec/startup-block.js");
	const saved = await storedMeta();
	const key = "/data/crowdsec/client.key";
	const cert = "/data/crowdsec/client.crt";
	const setMeta = (meta) =>
		api
			.db("setting")
			.where({ id: "crowdsec" })
			.update({ meta: JSON.stringify(meta) });
	await writeFile(path.join(api.root, cert.slice(1)), "cert");
	await setMeta({
		...saved,
		api_url: "https://127.0.0.1:9",
		use_tls_auth: true,
		tls_client_cert: cert,
		tls_client_key: key,
	});
	try {
		const off = await startCrowdsec();
		assert.deepEqual(off.missingFiles, [key]);
		assert.equal(off.nginxError, null);
		assert.equal(
			await api.read("/data/npmpro/nginx/crowdsec.conf"),
			"# the CrowdSec bouncer is off (Settings, CrowdSec)\n",
		);
		assert.equal((await storedMeta()).use_tls_auth, true);
		assert.equal((await storedMeta()).enabled, true);
		const warnings = startupWarnings({ values: off.values, missingFiles: off.missingFiles });
		assert.match(
			renderStartupBlock({ values: off.values, warnings, bouncerOff: true }),
			/^CrowdSec: off \(a file is missing, see the warning\)$/mu,
		);
		assert.deepEqual(warnings, [`${key} does not exist`]);
		await writeFile(path.join(api.root, key.slice(1)), "key");
		const on = await startCrowdsec();
		assert.deepEqual(on.missingFiles, []);
		assert.equal(
			await api.read("/data/npmpro/nginx/crowdsec.conf"),
			"include /usr/local/nginx/conf/crowdsec-bouncer.conf;\n",
		);
	} finally {
		await setMeta(saved);
		await rm(path.join(api.root, key.slice(1)), { force: true });
		await rm(path.join(api.root, cert.slice(1)), { force: true });
		await startCrowdsec();
	}
});

it("refuses a save while a file of the bouncer cannot be read", { skip: process.getuid?.() === 0 }, async () => {
	const file = path.join(api.root, "data/crowdsec/ban-locked.html");
	await writeFile(file, "<p>banned</p>");
	await chmod(file, 0o000);
	try {
		const res = await (await api.admin()).put("/settings/crowdsec", {
			ban_response: "page",
			ban_template_path: "/data/crowdsec/ban-locked.html",
			force: true,
		});
		assert.equal(res.status, 400);
		assert.match(JSON.stringify(res.body), /cannot be read/u);
	} finally {
		await chmod(file, 0o600);
		await rm(file);
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

it("warns and goes on when the .local file cannot be renamed after the import", async () => {
	const { importCrowdsecFile } = await import("../lib/crowdsec/import.js");
	const nodeFs = await import("node:fs/promises");
	const local = path.join(api.root, "data/crowdsec/crowdsec.conf.local");
	await writeFile(local, LOCAL);
	const warned = [];
	try {
		const result = await importCrowdsecFile({
			fs: {
				...nodeFs,
				rename: async () => {
					throw Object.assign(new Error("denied"), { code: "EACCES" });
				},
			},
			log: { info: () => {}, warn: (text) => warned.push(text) },
		});
		assert.equal(result.imported, true);
		assert.equal(
			warned.some((text) => text.includes("could not be renamed (EACCES)")),
			true,
		);
	} finally {
		await rm(local, { force: true });
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

it("imports the crowdsec.conf of an older backup after a restore and writes the files from the row", async () => {
	const { reloadCrowdsecAfterRestore } = await import("../internal/crowdsec-setting.js");
	await writeFile(
		path.join(api.root, "data/crowdsec/crowdsec.conf"),
		"ENABLED=false\nAPI_URL=http://127.0.0.1:10\nAPI_KEY=restored-key\n",
	);
	await reloadCrowdsecAfterRestore();
	const meta = await storedMeta();
	assert.equal(meta.enabled, false);
	assert.equal(meta.api_url, "http://127.0.0.1:10");
	assert.equal((await api.read("/data/crowdsec/crowdsec.conf")).split("\n")[0], HEADER);
	assert.equal(
		await api.read("/data/npmpro/nginx/crowdsec.conf"),
		"# the CrowdSec bouncer is off (Settings, CrowdSec)\n",
	);
	assert.equal(JSON.stringify(meta).includes("restored-key"), false);
});

it("keeps the current settings when a restored database has no row and the file is the one NPMpro wrote", async () => {
	const { reloadCrowdsecAfterRestore } = await import("../internal/crowdsec-setting.js");
	const before = await storedMeta();
	await api.db("setting").where({ id: "crowdsec" }).delete();
	await reloadCrowdsecAfterRestore();
	const meta = await storedMeta();
	assert.equal(meta.enabled, before.enabled);
	assert.equal(meta.api_url, before.api_url);
	assert.equal((await api.read("/data/crowdsec/crowdsec.conf")).split("\n")[0], HEADER);
	assert.match(await api.read("/data/crowdsec/crowdsec.conf"), /API_URL=http:\/\/127\.0\.0\.1:10\n/u);
	assert.equal(JSON.stringify(meta).includes("restored-key"), false);
});
