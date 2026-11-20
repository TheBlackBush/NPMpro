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

it("registers the instance CA's new account with ACME_EMAIL over the body's email (D5)", async () => {
	const acmeServer = await import("../lib/acme-server.js");
	const previous = acmeServer.storedAcmeServer();
	acmeServer.setStoredAcmeServer(CA);
	process.env.ACME_EMAIL = "env@example.com";
	try {
		const res = await admin.post(REPLACE, BODY);
		assert.equal(res.status, 200, res.text);
		assert.ok((await readFake("register-1.ini")).split("\n").includes("email = env@example.com"));
		assert.equal((await row()).email, "env@example.com");
	} finally {
		delete process.env.ACME_EMAIL;
		acmeServer.setStoredAcmeServer(previous);
	}
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

it("shows the CA's sentence only when certbot's output has a log line and warnings", async () => {
	const raw = [
		"Saving debug log to /tmp/acme-register-Zz9/logs/letsencrypt.log",
		"/x/urllib3/connectionpool.py:1097: InsecureRequestWarning: Unverified HTTPS request",
		"  warnings.warn(",
		"An unexpected error occurred:",
		"acme.messages.Error: urn:ietf:params:acme:error:badNonce :: bad nonce",
		"Ask for help or search for solutions at https://community.letsencrypt.org. See the logfile /tmp/acme-register-Zz9/logs/letsencrypt.log or re-run Certbot with -v for more details.",
	].join("\n");
	const clean = "acme.messages.Error: urn:ietf:params:acme:error:badNonce :: bad nonce";
	await writeFile(path.join(api.root, "fake/unregister.fail"), raw);
	const res = await admin.post(REPLACE, { ...BODY, deactivate_old: true });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.replaced.deactivation_error, clean);
	assert.equal((await auditOf("replaced")).meta.error, clean);
	await rm(path.join(api.root, "fake/unregister.fail"), { force: true });
	await writeFile(path.join(api.root, "fake/register.fail"), raw);
	const refusedRes = await admin.post(REPLACE, BODY);
	assert.equal(refusedRes.status, 400, refusedRes.text);
	assert.equal(refusedRes.body.error.message_values.message, clean);
	assert.equal(refusedRes.body.error.message, clean);
	assert.equal((await auditOf("replace-failed")).meta.error, clean);
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

it("the start removes a leftover temporary folder, and the sync points a conf at the row's account", async () => {
	const { syncAccountsWithFiles } = await import("../internal/acme-account.js");
	await mkdir(certbotDir(".replace-abc/config/accounts/ca.lan/dir"), { recursive: true });
	await writeFile(certbotDir(".replace-abc/certbot.ini"), "eab-kid = secret\n");
	await writeFile(confPath(1), confText("c".repeat(32), CA));
	const { sweepReplaceFolders } = await import("../internal/acme-account.js");
	await sweepReplaceFolders();
	await syncAccountsWithFiles();
	assert.deepEqual(await leftovers(), []);
	assert.match(await readConf(1), new RegExp(`account = ${OLD}`, "u"));
	assert.equal((await row()).account_id, OLD);
});

it("a restore reload during a replace keeps its temporary folder", async () => {
	const { syncAccountsWithFiles } = await import("../internal/acme-account.js");
	await mkdir(certbotDir(".replace-running"), { recursive: true });
	await syncAccountsWithFiles();
	assert.deepEqual(await leftovers(), [".replace-running"]);
	await rm(certbotDir(".replace-running"), { recursive: true });
});

it("restores everything when the new account's folder cannot be moved", async () => {
	// a folder with the new id and content is in the way: the rename fails, and it is not ours to remove
	await mkdir(accountFolder(NEW), { recursive: true });
	await writeFile(path.join(accountFolder(NEW), "mine"), "x");
	const res = await admin.post(REPLACE, BODY);
	assert.equal(res.status, 400, res.text);
	// NPMpro's own step failed, not the CA: no "The CA refused", and no local path in the answer
	assert.equal(res.body.error.message_i18n, "error.acme-replace-local");
	assert.ok(!res.text.includes(".replace-"), res.text);
	for (const id of [1, 2]) assert.equal(await readConf(id), confText(OLD, CA));
	assert.equal((await row()).account_id, OLD);
	assert.ok(await exists(path.join(accountFolder(NEW), "mine")));
	assert.ok(await exists(accountFolder(OLD)));
	assert.deepEqual(await leftovers(), []);
	assert.ok(await auditOf("replace-failed"));
});

it("puts the confs back, removes the moved folder and keeps the row when the row update fails", async () => {
	// the failure comes from a SQLite trigger
	if (api.db.client.config.client !== "better-sqlite3") return;
	await api.db.raw(
		"CREATE TRIGGER fail_replace BEFORE UPDATE ON npmpro_acme_account BEGIN SELECT RAISE(ABORT, 'row update failed'); END",
	);
	try {
		const res = await admin.post(REPLACE, BODY);
		assert.equal(res.status, 400, res.text);
		assert.equal(res.body.error.message_i18n, "error.acme-replace-local");
	} finally {
		await api.db.raw("DROP TRIGGER fail_replace");
	}
	for (const id of [1, 2]) assert.equal(await readConf(id), confText(OLD, CA));
	assert.ok(!(await exists(accountFolder(NEW))));
	assert.ok(await exists(accountFolder(OLD)));
	assert.equal((await row()).account_id, OLD);
	assert.deepEqual(await leftovers(), []);
});

it("a failing audit does not hide the CA's refusal", async () => {
	await writeFile(path.join(api.root, "fake/register.fail"), "invalidContact: nope");
	const audit = (await import("../internal/audit-log.js")).default;
	const original = audit.add;
	audit.add = () => Promise.reject(new Error("audit down"));
	try {
		const res = await admin.post(REPLACE, BODY);
		assert.equal(res.status, 400, res.text);
		assert.equal(res.body.error.message_i18n, "error.acme-refused");
		assert.ok(res.body.error.message_values.message.includes("invalidContact"));
	} finally {
		audit.add = original;
	}
});

const settle = (promise) => {
	const state = { done: false };
	promise.then(
		() => {
			state.done = true;
		},
		() => {
			state.done = true;
		},
	);
	return state;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check) => {
	for (let attempt = 0; attempt < 100 && !(await check()); attempt += 1) await wait(50);
};

it("serializes a replace with an account lookup and a second replace on the same CA", async () => {
	const { ensureAccount } = await import("../internal/acme-account.js");
	await writeFile(path.join(api.root, "fake/hold"), CA);
	try {
		acmeDirectory(api, CA, {
			body: { newNonce: "https://ca.lan/nonce", meta: { externalAccountRequired: true } },
			persist: false,
		});
		const first = admin.post(REPLACE, BODY);
		await waitFor(() => exists(path.join(api.root, "fake/register-1.ini")));
		const lookup = ensureAccount(CA);
		const lookupState = settle(lookup);
		const second = admin.post(REPLACE, { ...BODY, email: "third@example.com" });
		await wait(300);
		assert.equal(lookupState.done, false, "the lookup waits for the replace");
		assert.equal((await calls()).filter((line) => line.includes(" register ")).length, 1);
		await rm(path.join(api.root, "fake/hold"));
		assert.equal((await first).status, 200);
		assert.equal(await lookup, NEW, "the lookup sees the replaced account");
		assert.equal((await second).status, 200);
		assert.equal((await calls()).filter((line) => line.includes(" register ")).length, 2);
		assert.equal((await row()).account_id, "00000000000000000000000000000002");
	} finally {
		await rm(path.join(api.root, "fake/hold"), { force: true });
	}
});

it("a replace waits for a running certonly of the CA", async () => {
	const { default: certificateAcme } = await import("../internal/certificate-acme.js");
	await writeFile(path.join(api.root, "fake/hold-certonly"), "");
	try {
		const issued = certificateAcme.requestCertbot(
			{ id: 50, domain_names: ["x.example.com"], npmpro_acme_server: CA, npmpro_reuse_key: false },
			null,
		);
		const issuedState = settle(issued);
		await waitFor(async () => (await calls()).some((line) => line.includes(" certonly ")));
		const replaced = admin.post(REPLACE, BODY);
		await wait(300);
		assert.equal(issuedState.done, false);
		assert.deepEqual(
			(await calls()).filter((line) => line.includes(" register ")),
			[],
			"nothing registers while the certonly runs",
		);
		assert.ok(await exists(accountFolder(OLD)));
		await rm(path.join(api.root, "fake/hold-certonly"));
		await issued;
		const res = await replaced;
		assert.equal(res.status, 200, res.text);
		assert.equal(res.body.replaced.moved, 3, "the certificate issued meanwhile is moved too");
		assert.match(await readConf(50), new RegExp(`account = ${NEW}`, "u"));
	} finally {
		await rm(path.join(api.root, "fake/hold-certonly"), { force: true });
		await rm(certbotDir("live/npm-50"), { recursive: true, force: true });
		await rm(confPath(50), { force: true });
	}
});

it("a replace waits for a running renew of the CA, and the renewed conf then names the new account", async () => {
	const { default: certificateAcme } = await import("../internal/certificate-acme.js");
	const pair = await makeCertificate(api.root, "renew.example.com");
	await mkdir(certbotDir("live/npm-1"), { recursive: true });
	await writeFile(certbotDir("live/npm-1/cert.pem"), await readFile(pair.certificate));
	await writeFile(path.join(api.root, "fake/hold-renew"), "");
	try {
		const renewed = certificateAcme.renewCertbot(
			{ id: 1, domain_names: ["renew.example.com"], npmpro_dns_challenge: false },
			null,
		);
		const renewedState = settle(renewed);
		await waitFor(async () => (await calls()).some((line) => line.includes(" renew ")));
		const replaced = admin.post(REPLACE, BODY);
		await wait(300);
		assert.equal(renewedState.done, false);
		assert.deepEqual(
			(await calls()).filter((line) => line.includes(" register ")),
			[],
			"nothing registers while the renew runs",
		);
		await rm(path.join(api.root, "fake/hold-renew"));
		await renewed;
		const res = await replaced;
		assert.equal(res.status, 200, res.text);
		assert.equal(res.body.replaced.moved, 2);
		assert.match(await readConf(1), new RegExp(`account = ${NEW}`, "u"));
	} finally {
		await rm(path.join(api.root, "fake/hold-renew"), { force: true });
		await rm(certbotDir("live/npm-1"), { recursive: true, force: true });
	}
});

it("a replace waits for the timer's renewal, one certbot run under the CA locks", async () => {
	const { default: internalCertificate } = await import("../internal/certificate.js");
	await writeFile(path.join(api.root, "fake/hold-renew"), "");
	internalCertificate.intervalProcessing = false;
	try {
		const run = internalCertificate.processExpiringHosts();
		await waitFor(async () => (await calls()).some((line) => line.endsWith(" renew --quiet")));
		const replaced = admin.post(REPLACE, BODY);
		await wait(300);
		assert.deepEqual(
			(await calls()).filter((line) => line.includes(" register ")),
			[],
			"nothing registers while the renewal runs",
		);
		await rm(path.join(api.root, "fake/hold-renew"));
		await run;
		const res = await replaced;
		assert.equal(res.status, 200, res.text);
		assert.equal((await calls()).filter((line) => line.includes(" renew ")).length, 1, "one certbot renew");
		for (const id of [1, 2]) assert.match(await readConf(id), new RegExp(`account = ${NEW}`, "u"));
	} finally {
		await rm(path.join(api.root, "fake/hold-renew"), { force: true });
		internalCertificate.intervalProcessing = false;
	}
});

it("a renew holds the locks of two CAs, and a Replace on either waits", async () => {
	const { default: internalCertificate } = await import("../internal/certificate.js");
	await model.query().insert({ server: OTHER, account_id: OTHER_ACCOUNT, state: "registered" });
	acmeDirectory(api, OTHER, { persist: false });
	await writeFile(path.join(api.root, "fake/hold-renew"), "");
	internalCertificate.intervalProcessing = false;
	try {
		const run = internalCertificate.processExpiringHosts();
		await waitFor(async () => (await calls()).some((line) => line.endsWith(" renew --quiet")));
		const onCa = admin.post(REPLACE, BODY);
		const replaceOther = admin.post(REPLACE, { server: OTHER, email: "other@example.com" });
		await wait(300);
		assert.deepEqual(
			(await calls()).filter((line) => line.includes(" register ")),
			[],
			"neither CA registers while the renewal runs",
		);
		await rm(path.join(api.root, "fake/hold-renew"));
		await run;
		assert.equal((await onCa).status, 200);
		assert.equal((await replaceOther).status, 200);
		assert.equal((await calls()).filter((line) => line.includes(" register ")).length, 2);
		assert.notEqual((await model.query().where("server", OTHER).first()).account_id, OTHER_ACCOUNT);
		assert.doesNotMatch(await readConf(3), new RegExp(`account = ${OTHER_ACCOUNT}`, "u"));
	} finally {
		await rm(path.join(api.root, "fake/hold-renew"), { force: true });
		internalCertificate.intervalProcessing = false;
	}
});
