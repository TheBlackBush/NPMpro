import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { generateApiToken } from "../lib/api-token.js";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls, seedAccount } from "./support/certbot.js";

const CA = "https://ca.lan/dir";
const OTHER = "https://other.lan/dir";
const OLD = "a".repeat(32);
const NEW = "00000000000000000000000000000001";
const OTHER_ACCOUNT = "b".repeat(32);
const REPLACE = "/settings/acme/replace";
const FAKE_FILES = [".ini", ".fail", ".mode"];
const SECRET_VALUES = /"(?:k2|h2)"|=k2|=h2| k2| h2/u;
const DISK_FULL = /disk full/u;
const SERVER_ERROR = /server error/u;
const INVALID_PARTS = /new@example\.com|k2|h2/u;
const TEMP_FOLDER = /\.replace-[^/]+/gu;
const confText = (account, server) =>
	`version = 5.10.0\n[renewalparams]\naccount = ${account}\nserver = ${server}\nauthenticator = webroot\n`;

let api;
let admin;
let model;
let directory;

const certbotDir = (...parts) => path.join(api.root, "data/tls/certbot", ...parts);
const confPath = (id) => certbotDir("renewal", `npm-${id}.conf`);
const readConf = (id) => readFile(confPath(id), "utf8");
const readFake = (name) => readFile(path.join(api.root, "fake", name), "utf8");
const exists = (file) =>
	stat(file).then(
		() => true,
		() => false,
	);
const accountFolder = (id) => certbotDir("accounts/ca.lan/dir", id);
const row = () => model.query().where("server", CA).first();
const calls = async () => (await normalizedCalls(api)).map((line) => line.replaceAll(TEMP_FOLDER, ".replace-*"));
const leftovers = async () => (await readdir(certbotDir())).filter((name) => name.startsWith(".replace-"));
const auditOf = async (action) => {
	const found = (await api.db("audit_log").where({ object_type: "acme-account", action })).at(-1);
	return found && { ...found, meta: typeof found.meta === "string" ? JSON.parse(found.meta) : found.meta };
};

const levels = (level) => ({
	visibility: "all",
	...Object.fromEntries(
		["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"].map((s) => [
			s,
			level,
		]),
	),
});

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_OUTBOUND: "mock" } });
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	api.outside.dns.set("ca.lan", "192.168.1.10");
	api.outside.dns.set("other.lan", "192.168.1.11");
	admin = await api.admin();
	model = (await import("../models/acme_account.js")).default;
	directory = await import("../lib/acme-directory.js");
});
beforeEach(async () => {
	await model.query().delete();
	await api.db("audit_log").where("object_type", "acme-account").delete();
	await rm(certbotDir("accounts"), { recursive: true, force: true });
	await rm(certbotDir("renewal"), { recursive: true, force: true });
	await chmod(certbotDir(), 0o755).catch(() => {});
	for (const name of await readdir(path.join(api.root, "fake"))) {
		if (FAKE_FILES.some((end) => name.endsWith(end))) await rm(path.join(api.root, "fake", name));
	}
	await mkdir(certbotDir("renewal"), { recursive: true });
	await seedAccount(api, CA, OLD);
	await seedAccount(api, OTHER, OTHER_ACCOUNT);
	await model.query().insert({
		server: CA,
		email: "old@example.com",
		account_id: OLD,
		state: "registered",
		registered_on: "2026-01-01 00:00:00",
	});
	await writeFile(confPath(1), confText(OLD, CA));
	await writeFile(confPath(2), confText(OLD, CA));
	await writeFile(confPath(3), confText(OTHER_ACCOUNT, OTHER));
	await api.outside.clearCalls();
	directory.clearAcmeDirectoryCache();
	acmeDirectory(api, CA, {
		body: { newNonce: "https://ca.lan/nonce", meta: { externalAccountRequired: true } },
		persist: false,
	});
});
after(() => api.stop());

const BODY = { server: CA, email: "new@example.com", eab_kid: "k2", eab_hmac_key: "h2" };

it("is for administrators and sessions only", async () => {
	const limited = await api.limited({ visibility: "all", certificates: "manage" });
	assert.equal((await limited.post(REPLACE, BODY)).status, 403);
	const made = generateApiToken();
	await api.db("npmpro_api_token").insert({
		user_id: (await admin.get("/users/me")).body.id,
		name: "replace token",
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		...levels("manage"),
		is_admin: true,
		created_on: Math.floor(Date.now() / 1000),
		expires_on: Math.floor(Date.now() / 1000) + 3600,
	});
	const client = api.client();
	const res = await client.post(REPLACE, BODY, { headers: { authorization: `Bearer ${made.token}` } });
	assert.equal(res.status, 403, res.text);
	assert.deepEqual(await calls(), []);
});

it("registers a new account in a temporary folder, moves it and points the CA's confs at it", async () => {
	const res = await admin.post(REPLACE, BODY);
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.replaced, { moved: 2, old_account: "kept" });
	assert.deepEqual(await calls(), [
		"certbot --config /data/tls/certbot/.replace-*/certbot.ini register --server https://ca.lan/dir",
	]);
	const ini = (await readFake("register-1.ini")).split("\n");
	for (const line of ["email = new@example.com", "eab-kid = k2", "eab-hmac-key = h2"])
		assert.ok(ini.includes(line), line);
	assert.ok(ini.some((line) => line.startsWith(`config-dir = ${certbotDir(".replace-")}`)));
	assert.ok(await exists(accountFolder(NEW)));
	assert.ok(await exists(accountFolder(OLD)));
	for (const id of [1, 2]) assert.match(await readConf(id), new RegExp(`account = ${NEW}`, "u"));
	assert.equal(await readConf(3), confText(OTHER_ACCOUNT, OTHER));
	const saved = await row();
	assert.equal(saved.account_id, NEW);
	assert.equal(saved.email, "new@example.com");
	assert.equal(saved.state, "registered");
	assert.equal(res.body.accounts.find((a) => a.server === CA).eab_kid_set, false);
	assert.deepEqual(await leftovers(), []);
	const audit = await auditOf("replaced");
	assert.equal(audit.meta.old_account, OLD);
	assert.equal(audit.meta.new_account, NEW);
	assert.equal(audit.meta.moved, 2);
	assert.equal(audit.meta.old_account_state, "kept");
	// the email is shown to administrators in the answer; no secret reaches argv, the audit log or the answer
	const logged = JSON.stringify([await api.db("audit_log"), await calls()]);
	assert.ok(!logged.includes("new@example.com"));
	assert.ok(!SECRET_VALUES.test(logged));
	assert.ok(!SECRET_VALUES.test(JSON.stringify(res.body)));
});

it("deactivates the old account after the switch when asked", async () => {
	const res = await admin.post(REPLACE, { ...BODY, deactivate_old: true });
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.replaced, { moved: 2, old_account: "deactivated" });
	const last = (await calls()).at(-1);
	assert.equal(last, `certbot --config /run/npmpro/certbot.ini unregister --server ${CA} --account ${OLD}`);
	assert.ok(!(await exists(accountFolder(OLD))));
	assert.ok(await exists(accountFolder(NEW)));
	assert.equal((await auditOf("replaced")).meta.old_account_state, "deactivated");
});

it("keeps the switch when the deactivation fails", async () => {
	await writeFile(path.join(api.root, "fake/unregister.fail"), "server error");
	const res = await admin.post(REPLACE, { ...BODY, deactivate_old: true });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.replaced.old_account, "deactivation-failed");
	assert.match(res.body.replaced.deactivation_error, SERVER_ERROR);
	assert.equal((await row()).account_id, NEW);
	assert.match(await readConf(1), new RegExp(`account = ${NEW}`, "u"));
	assert.ok(await exists(accountFolder(OLD)));
	const audit = await auditOf("replaced");
	assert.equal(audit.meta.old_account_state, "deactivation-failed");
	assert.match(audit.meta.error, SERVER_ERROR);
});

it("changes nothing when the CA refuses the new account", async () => {
	await writeFile(path.join(api.root, "fake/register.fail"), "invalidContact: new@example.com k2 h2");
	const res = await admin.post(REPLACE, BODY);
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.acme-refused");
	assert.ok(!INVALID_PARTS.test(JSON.stringify(res.body)));
	for (const id of [1, 2]) assert.equal(await readConf(id), confText(OLD, CA));
	assert.equal((await row()).account_id, OLD);
	assert.ok(await exists(accountFolder(OLD)));
	assert.deepEqual(await leftovers(), []);
	const audit = await auditOf("replace-failed");
	assert.ok(audit.meta.error.includes("invalidContact"));
	assert.ok(!INVALID_PARTS.test(JSON.stringify(audit)));
});

it("puts the confs back and removes the moved folder when the rewrite fails", {
	skip: process.getuid?.() === 0,
}, async () => {
	// the register runs in the temp folder, the confs cannot be written (no new file in a read-only folder)
	await chmod(certbotDir("renewal"), 0o555);
	try {
		const res = await admin.post(REPLACE, BODY);
		assert.equal(res.status, 400, res.text);
	} finally {
		await chmod(certbotDir("renewal"), 0o755);
	}
	for (const id of [1, 2]) assert.equal(await readConf(id), confText(OLD, CA));
	assert.ok(!(await exists(accountFolder(NEW))));
	assert.equal((await row()).account_id, OLD);
	assert.deepEqual(await leftovers(), []);
	assert.ok(await auditOf("replace-failed"));
});

it("gives the written confs their text back when a later write fails", async () => {
	const { rewriteAccountConfs } = await import("../internal/acme-account.js");
	const confs = [
		{ path: confPath(1), text: confText(OLD, CA) },
		{ path: confPath(2), text: confText(OLD, CA) },
	];
	let writes = 0;
	const { writeFileAtomic } = await import("../lib/certbot-account.js");
	await assert.rejects(
		rewriteAccountConfs(confs, NEW, {
			write: async (file, text) => {
				writes += 1;
				if (writes === 2) throw new Error("disk full");
				await writeFileAtomic(file, text);
			},
		}),
		DISK_FULL,
	);
	for (const id of [1, 2]) assert.equal(await readConf(id), confText(OLD, CA));
	assert.equal(await rewriteAccountConfs(confs, NEW), 2);
	assert.match(await readConf(2), new RegExp(`account = ${NEW}`, "u"));
});

it("replaces only a registered account", async () => {
	await model.query().where("server", CA).patch({ state: "pending", account_id: null });
	const res = await admin.post(REPLACE, BODY);
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.acme-not-registered");
	assert.deepEqual(await calls(), []);
});

it("needs the EAB pair of a CA that requires one", async () => {
	const res = await admin.post(REPLACE, { server: CA, email: "new@example.com" });
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.acme-eab-pair");
	assert.deepEqual(await calls(), []);
});

it("the start removes a leftover temporary folder and points a conf at the row's account", async () => {
	const { syncAccountsWithFiles } = await import("../internal/acme-account.js");
	await mkdir(certbotDir(".replace-abc/config/accounts/ca.lan/dir"), { recursive: true });
	await writeFile(certbotDir(".replace-abc/certbot.ini"), "eab-kid = secret\n");
	await writeFile(confPath(1), confText("c".repeat(32), CA));
	await syncAccountsWithFiles();
	assert.deepEqual(await leftovers(), []);
	assert.match(await readConf(1), new RegExp(`account = ${OLD}`, "u"));
	assert.equal((await row()).account_id, OLD);
});
