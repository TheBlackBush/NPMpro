import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { extractTo } from "../lib/backup/archive.js";
import { openBackupFile } from "../lib/backup/format.js";
import { startApi } from "./support/api.js";
import { craftBackup } from "./support/backup-craft.js";
import { seedAccount } from "./support/certbot.js";

// the ACME accounts in backups (roadmap item 15): rows without the EAB pair, a restore that reconciles rows, files
// and the instance CA, and a backup made before the item that keeps the instance's ACME settings

const BASE = "/backups";
const CA = "https://ca.lan/dir";
const LE = "https://acme-v02.api.letsencrypt.org/directory";
const PASSPHRASE = "a long passphrase 1";
const ACCOUNT_ID = "aaaaaaaabbbbbbbbccccccccdddddddd";
const TYPES = ["certificates", "settings_runtime"];
const ACCOUNT_DIR = "tls/certbot/accounts/ca.lan/dir";
const OCTET = { "content-type": "application/octet-stream" };

let api;
let admin;
let model;
let acme;
let settingModel;

const rows = () => model.query().select("server", "email", "account_id", "state", "eab_kid", "eab_hmac_key");
const rowOfCa = async () => (await rows()).find((row) => row.server === CA);
const settingRow = () => settingModel.query().where("id", "acme").first();
const startup = () => readFile(path.join(api.root, "data/npmpro/startup-settings.env"), "utf8");
const folder = () => path.join(api.root, "data", ACCOUNT_DIR, ACCOUNT_ID);

const seedInstance = async () => {
	await model.query().delete();
	await settingModel.query().where("id", "acme").delete();
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	await seedAccount(api, CA, ACCOUNT_ID);
	await model.query().insert({
		server: CA,
		email: "ops@example.com",
		account_id: ACCOUNT_ID,
		state: "registered",
		eab_kid: acme.seal("eab-kid-value"),
		eab_hmac_key: acme.seal("eab-hmac-value"),
	});
	await acme.saveAcmeSetting(CA);
	await acme.loadAcmeServer();
};

const clearInstance = async () => {
	await model.query().delete();
	await settingModel.query().where("id", "acme").delete();
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	await acme.loadAcmeServer();
};

const keep = async (secrets) => {
	const done = await admin.post(BASE, {
		types: TYPES,
		keep: true,
		secrets,
		...(secrets ? { passphrase: PASSPHRASE } : {}),
	});
	if (done.status !== 200) throw new Error(done.text);
	return done.body.entry.name;
};

const download = async (name) => {
	const done = await admin.get(`${BASE}/${name}`);
	if (done.status !== 200) throw new Error(done.text);
	const dir = await mkdtemp(path.join(os.tmpdir(), "acme-backup-"));
	const file = path.join(dir, "backup.npmpro");
	await writeFile(file, done.bytes);
	return { dir, file };
};

// the archive's data and file list
const unpack = async (name, passphrase) => {
	const { dir, file } = await download(name);
	try {
		const out = path.join(dir, "out");
		await extractTo({ source: await openBackupFile({ file, passphrase }), dir: out, allow: () => true });
		const data = async (typeId) => JSON.parse(await readFile(path.join(out, "data", `${typeId}.json`), "utf8"));
		const files = new Set(await readdir(path.join(out, "files"), { recursive: true }).catch(() => []));
		const hasFile = (rel) => files.has(rel);
		return { certificates: await data("certificates"), runtime: await data("settings_runtime"), hasFile };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};

const replace = async (name, passphrase) => {
	const opened = await admin.post(`${BASE}/${name}/inspect`, passphrase ? { passphrase } : {});
	if (opened.status !== 200) throw new Error(opened.text);
	const done = await admin.post(`${BASE}/restore/${opened.body.token}`, { types: TYPES, confirm: true });
	if (done.status !== 200) throw new Error(done.text);
};

// a backup file changed by hand, uploaded and restored
const replaceCrafted = async (name, edit) => {
	const { dir, file } = await download(name);
	try {
		const crafted = await craftBackup(file, path.join(dir, "crafted.npmpro"), edit, { passphrase: PASSPHRASE });
		const uploaded = await admin.send("POST", `${BASE}/upload?name=npmpro-backup-crafted-20260101-000000.npmpro`, {
			form: await readFile(crafted),
			headers: OCTET,
		});
		if (uploaded.status !== 200) throw new Error(uploaded.text);
		const opened = await admin.post(`${BASE}/${uploaded.body.entry.name}/inspect`, {});
		if (opened.status !== 200) throw new Error(opened.text);
		const done = await admin.post(`${BASE}/restore/${opened.body.token}`, { types: TYPES, confirm: true });
		if (done.status !== 200) throw new Error(done.text);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_OUTBOUND: "mock" } });
	admin = await api.admin();
	model = (await import("../models/acme_account.js")).default;
	acme = await import("../internal/acme-account.js");
	settingModel = (await import("../models/setting.js")).default;
});
beforeEach(seedInstance);
after(() => api.stop());

const eabOf = (row) => [row.eab_kid, row.eab_hmac_key];
const NO_EAB = [null, null];
const STARTUP_CA = /^ACME_SERVER=https:\/\/ca\.lan\/dir$/mu;

it("a backup with secrets holds the account row without the EAB pair, and the setting row", async () => {
	const out = await unpack(await keep(true), PASSPHRASE);
	const [row] = out.certificates.npmpro_acme_account;
	assert.deepEqual(
		{ server: row.server, email: row.email, account_id: row.account_id, state: row.state },
		{ server: CA, email: "ops@example.com", account_id: ACCOUNT_ID, state: "registered" },
	);
	assert.deepEqual(eabOf(row), NO_EAB);
	assert.equal(out.runtime.setting.find((item) => item.id === "acme").meta.server, CA);
	assert.equal(out.hasFile(`${ACCOUNT_DIR}/${ACCOUNT_ID}/private_key.json`), true);
	assert.equal(JSON.stringify(out).includes("eab-"), false);
});

it("a backup without secrets holds the same rows and no account key", async () => {
	const out = await unpack(await keep(false));
	const [row] = out.certificates.npmpro_acme_account;
	assert.equal(row.account_id, ACCOUNT_ID);
	assert.deepEqual(eabOf(row), NO_EAB);
	assert.equal(
		out.runtime.setting.some((item) => item.id === "acme"),
		true,
	);
	assert.equal(out.hasFile(`${ACCOUNT_DIR}/${ACCOUNT_ID}/regr.json`), true);
	assert.equal(out.hasFile(`${ACCOUNT_DIR}/${ACCOUNT_ID}/private_key.json`), false);
});

it("a page export of one certificate holds no account row", async () => {
	const now = new Date().toISOString().slice(0, 19).replace("T", " ");
	const [id] = await api.db("certificate").insert({
		provider: "other",
		nice_name: "export.example.com",
		domain_names: JSON.stringify(["export.example.com"]),
		meta: JSON.stringify({}),
		expires_on: "2099-01-01 00:00:00",
		created_on: now,
		modified_on: now,
		owner_user_id: 1,
	});
	const exported = await admin.post(`${BASE}/export`, {
		kind: "certificates",
		ids: [id],
		linked: {},
		secrets: false,
	});
	if (exported.status !== 200) throw new Error(exported.text);
	const file = await admin.get(`${BASE}/pending/${exported.body.pending}?name=${exported.body.name}`);
	assert.equal(file.status, 200);
	const dir = await mkdtemp(path.join(os.tmpdir(), "acme-export-"));
	try {
		const target = path.join(dir, "export.npmpro");
		await writeFile(target, file.bytes);
		const out = path.join(dir, "out");
		await extractTo({ source: await openBackupFile({ file: target }), dir: out, allow: () => true });
		const data = JSON.parse(await readFile(path.join(out, "data", "certificates.json"), "utf8"));
		assert.equal(data.certificate.length, 1);
		assert.deepEqual(data.npmpro_acme_account, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("a restore of a backup with secrets brings the account back registered, and the CA", async () => {
	const name = await keep(true);
	await clearInstance();
	await replace(name, PASSPHRASE);
	const row = await rowOfCa();
	assert.equal(row.state, "registered");
	assert.equal(row.account_id, ACCOUNT_ID);
	assert.equal(row.email, "ops@example.com");
	assert.deepEqual(eabOf(row), NO_EAB);
	const shown = await admin.get("/settings/acme");
	assert.equal(shown.body.server, CA);
	assert.match(await startup(), STARTUP_CA);
});

it("a restore of a backup without secrets leaves the account pending", async () => {
	const name = await keep(false);
	await clearInstance();
	await replace(name);
	const row = await rowOfCa();
	assert.equal(row.state, "pending");
	assert.equal(row.account_id, null);
	assert.deepEqual(eabOf(row), NO_EAB);
});

it("an old backup keeps the instance's ACME settings and accounts", async () => {
	const name = await keep(true);
	const stored = await settingRow();
	await replaceCrafted(name, async ({ data, writeData }) => {
		const certificates = await data("certificates");
		delete certificates.npmpro_acme_account;
		await writeData("certificates", certificates);
		const runtime = await data("settings_runtime");
		runtime.setting = runtime.setting.filter((item) => item.id !== "acme");
		await writeData("settings_runtime", runtime);
	});
	assert.equal((await admin.get("/settings/acme")).body.server, CA);
	assert.deepEqual((await settingRow()).meta, stored.meta);
	const kept = await rowOfCa();
	assert.equal(kept.email, "ops@example.com");
	assert.equal(kept.state, "registered");
	assert.equal((await stat(folder())).isDirectory(), true);
	assert.match(await startup(), STARTUP_CA);
});

it("a backup that holds an acme row replaces the instance CA", async () => {
	const name = await keep(true);
	await replaceCrafted(name, async ({ data, writeData }) => {
		const runtime = await data("settings_runtime");
		runtime.setting = runtime.setting.map((row) =>
			row.id === "acme" ? { ...row, meta: { ...row.meta, server: null } } : row,
		);
		await writeData("settings_runtime", runtime);
	});
	assert.equal((await admin.get("/settings/acme")).body.server, LE);
	assert.doesNotMatch(await startup(), STARTUP_CA);
});

it("a restore that changes the instance CA computes the runtime defaults and renewal options with the restored CA", async () => {
	const ZEROSSL = "https://acme.zerossl.com/v2/DV90";
	const conf = path.join(api.root, "data/tls/certbot/renewal/npm-99.conf");
	await mkdir(path.dirname(conf), { recursive: true });
	await writeFile(conf, `[renewalparams]\naccount = ${ACCOUNT_ID}\nserver = ${ZEROSSL}\nauthenticator = webroot\n`);
	const name = await keep(true);
	try {
		assert.equal((await admin.get("/settings/runtime/certificates")).body.must_staple, false);
		await replaceCrafted(name, async ({ data, writeData }) => {
			const runtime = await data("settings_runtime");
			runtime.setting = runtime.setting.map((row) =>
				row.id === "acme" ? { ...row, meta: { ...row.meta, server: ZEROSSL } } : row,
			);
			await writeData("settings_runtime", runtime);
		});
		assert.equal((await admin.get("/settings/acme")).body.server, ZEROSSL);
		const runtime = await admin.get("/settings/runtime/certificates");
		assert.equal(runtime.body.must_staple, true);
		assert.equal(runtime.body.ocsp_stapling, true);
		assert.ok((await readFile(conf, "utf8")).split("\n").includes("must_staple = True"));
	} finally {
		await rm(conf, { force: true });
	}
});

// a merge of the backup into an instance that lost its ACME settings and account files
const merge = async (name, types, choices) => {
	const opened = await admin.post(`${BASE}/${name}/inspect`, { passphrase: PASSPHRASE });
	if (opened.status !== 200) throw new Error(opened.text);
	const body = { mode: "merge", types, choices };
	const plan = await admin.post(`${BASE}/restore/${opened.body.token}/plan`, body);
	if (plan.status !== 200) throw new Error(plan.text);
	const done = await admin.post(`${BASE}/restore/${opened.body.token}`, { ...body, plan_hash: plan.body.hash });
	if (done.status !== 200) throw new Error(done.text);
	return plan.body;
};

it("a merge that takes the acme row sets the instance CA and the startup line", async () => {
	const name = await keep(true);
	await clearInstance();
	const plan = await merge(name, ["settings_runtime"], { "setting:acme": "take" });
	assert.equal(plan.items.find((item) => item.key === "setting:acme").type, "settings_runtime");
	assert.equal((await admin.get("/settings/acme")).body.server, CA);
	assert.match(await startup(), STARTUP_CA);
});

it("a merge of certificates syncs the accounts with the files it brings", async () => {
	const name = await keep(true);
	await clearInstance();
	await merge(name, TYPES, { "setting:acme": "take" });
	const row = await rowOfCa();
	// no row came with the merge (rows are not merged); the account folder did, and is adopted
	assert.equal(row.state, "registered");
	assert.equal(row.account_id, ACCOUNT_ID);
	// adopted from the folder: the email is not recorded
	assert.equal(row.email, null);
	assert.equal((await admin.get("/settings/acme")).body.server, CA);
});

const scheduledBackup = async (protection) => {
	const created = await admin.post("/backups/schedules", {
		name: `ACME ${protection}`,
		frequency: "daily",
		time: "03:00",
		types: TYPES,
		protection,
		...(protection === "passphrase" ? { passphrase: PASSPHRASE } : {}),
		keep: 1,
	});
	if (created.status !== 200) throw new Error(created.text);
	const ran = await admin.post(`/backups/schedules/${created.body.id}/run`);
	if (ran.status !== 200) throw new Error(ran.text);
	return await unpack(ran.body.last_file, protection === "passphrase" ? PASSPHRASE : undefined);
};

it("a scheduled backup without protection holds no EAB value", async () => {
	const out = await scheduledBackup("none");
	const [row] = out.certificates.npmpro_acme_account;
	assert.equal(row.server, CA);
	assert.deepEqual(eabOf(row), NO_EAB);
	assert.equal(JSON.stringify(out).includes("eab-"), false);
});

it("a scheduled backup with a passphrase holds no EAB value", async () => {
	const out = await scheduledBackup("passphrase");
	const [row] = out.certificates.npmpro_acme_account;
	assert.equal(row.server, CA);
	assert.deepEqual(eabOf(row), NO_EAB);
	assert.equal(JSON.stringify(out).includes("eab-"), false);
});
