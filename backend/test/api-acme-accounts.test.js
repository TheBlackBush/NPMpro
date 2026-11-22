import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { generateApiToken } from "../lib/api-token.js";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls, seedAccount } from "./support/certbot.js";

const LE = "https://acme-v02.api.letsencrypt.org/directory";
const SECOND = "https://second.lan/dir";
const ACCOUNTS = "/settings/acme/accounts";
const FAKE_FILES = [".ini", ".fail", ".mode"];
const SECOND_ACCOUNT = "c".repeat(32);
const SECRET_WORDS = /secret|eab/u;

let api;
let admin;
let model;
let directory;

const certbotDir = (...parts) => path.join(api.root, "data/tls/certbot", ...parts);
const exists = (file) =>
	stat(file).then(
		() => true,
		() => false,
	);
const rowOf = (server) => model.query().where("server", server).first();
const auditOf = async (action) => {
	const found = (await api.db("audit_log").where({ object_type: "acme-account", action })).at(-1);
	return found && { ...found, meta: typeof found.meta === "string" ? JSON.parse(found.meta) : found.meta };
};
const addCertificate = (id, server) =>
	api.db("certificate").insert({
		id,
		owner_user_id: 1,
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		provider: "letsencrypt",
		nice_name: `c${id}`,
		domain_names: "[]",
		expires_on: "2099-01-01 00:00:00",
		meta: "{}",
		npmpro_acme_server: server,
	});

before(async () => {
	api = await startApi({ env: { NPMPRO_TEST_OUTBOUND: "mock" } });
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	api.outside.dns.set("second.lan", "192.168.1.10");
	api.outside.dns.set("ca.lan", "192.168.1.11");
	api.outside.dns.set("acme-v02.api.letsencrypt.org", "192.0.2.30");
	admin = await api.admin();
	model = (await import("../models/acme_account.js")).default;
	directory = await import("../lib/acme-directory.js");
});
beforeEach(async () => {
	await model.query().delete();
	await api.db("certificate").whereIn("id", [901, 902]).delete();
	await api.db("audit_log").where("object_type", "acme-account").delete();
	await api.db("setting").where("id", "acme").delete();
	await rm(certbotDir("accounts"), { recursive: true, force: true });
	await chmod(certbotDir(), 0o755).catch(() => {});
	for (const name of await readdir(path.join(api.root, "fake"))) {
		if (FAKE_FILES.some((end) => name.endsWith(end))) await rm(path.join(api.root, "fake", name));
	}
	await api.outside.clearCalls();
	directory.clearAcmeDirectoryCache();
	acmeDirectory(api, SECOND, { persist: false });
});
after(() => api.stop());

it("adds a CA, refuses it twice and refuses the instance CA", async () => {
	const res = await admin.post(ACCOUNTS, { server: "https://Second.LAN/dir", email: "ops@example.com" });
	assert.equal(res.status, 200, res.text);
	const found = res.body.accounts.find((account) => account.server === SECOND);
	assert.equal(found.state, "registered");
	assert.equal(found.email, "ops@example.com");
	assert.equal(res.body.server, LE);
	assert.equal((await rowOf(SECOND)).state, "registered");
	assert.equal((await normalizedCalls(api)).filter((line) => line.includes(" register ")).length, 1);
	const again = await admin.post(ACCOUNTS, { server: SECOND });
	assert.equal(again.status, 400, again.text);
	assert.equal(again.body.error.message_i18n, "error.acme-exists");
	const instance = await admin.post(ACCOUNTS, { server: LE });
	assert.equal(instance.status, 400, instance.text);
	assert.equal(instance.body.error.message_i18n, "error.acme-exists");
	const plain = await admin.post(ACCOUNTS, { server: "http://second.lan/dir" });
	assert.equal(plain.status, 400, plain.text);
});

it("stores an unreachable CA as pending with a warning, and a refusal stores nothing", async () => {
	directory.clearAcmeDirectoryCache();
	acmeDirectory(api, "https://down.lan/dir", { status: 503, body: "down", persist: false });
	api.outside.dns.set("down.lan", "192.168.1.12");
	const res = await admin.post(ACCOUNTS, { server: "https://down.lan/dir" });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.warning, "unreachable");
	assert.equal((await rowOf("https://down.lan/dir")).state, "pending");
	api.outside.dns.set("loop.lan", "::1");
	const blocked = await admin.post(ACCOUNTS, { server: "https://loop.lan/dir" });
	assert.equal(blocked.status, 400, blocked.text);
	assert.equal(await rowOf("https://loop.lan/dir"), undefined);
});

it("edits the email of an added CA", async () => {
	await seedAccount(api, SECOND, SECOND_ACCOUNT);
	const saved = await model.query().insertAndFetch({
		server: SECOND,
		email: "old@example.com",
		account_id: SECOND_ACCOUNT,
		state: "registered",
	});
	const res = await admin.put(`${ACCOUNTS}/${saved.id}`, { email: "new@example.com" });
	assert.equal(res.status, 200, res.text);
	assert.equal((await rowOf(SECOND)).email, "new@example.com");
	assert.ok((await normalizedCalls(api)).some((line) => line.includes("update_account")));
	assert.equal((await admin.put(`${ACCOUNTS}/99999`, { email: "a@example.com" })).status, 404);
});

it("removes a CA's row unless a certificate uses it or it is the instance CA", async () => {
	await seedAccount(api, SECOND, SECOND_ACCOUNT);
	const saved = await model
		.query()
		.insertAndFetch({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered" });
	await addCertificate(901, "HTTPS://SECOND.lan/dir");
	const used = await admin.delete(`${ACCOUNTS}/${saved.id}`);
	assert.equal(used.status, 400, used.text);
	assert.equal(used.body.error.message_i18n, "error.acme-in-use");
	await api.db("certificate").where({ id: 901 }).update({ npmpro_acme_server: LE });
	const res = await admin.delete(`${ACCOUNTS}/${saved.id}`);
	assert.equal(res.status, 200, res.text);
	assert.equal(await rowOf(SECOND), undefined);
	assert.ok(await exists(certbotDir("accounts/second.lan/dir", SECOND_ACCOUNT)));
	assert.equal((await auditOf("deleted")).meta.server, SECOND);
	const instance = await model
		.query()
		.insertAndFetch({ server: LE, account_id: "d".repeat(32), state: "registered" });
	const refused = await admin.delete(`${ACCOUNTS}/${instance.id}`);
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.acme-in-use");
	assert.ok(await rowOf(LE));
});

it("a removed CA stays removed at the next start, restore or merge, until it is added again", async () => {
	const { removedServers, syncAccountsWithFiles } = await import("../internal/acme-account.js");
	await seedAccount(api, SECOND, SECOND_ACCOUNT);
	const saved = await model
		.query()
		.insertAndFetch({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered" });
	assert.equal((await admin.delete(`${ACCOUNTS}/${saved.id}`)).status, 200);
	assert.deepEqual([...(await removedServers())], [SECOND]);

	// what the start, a restore and a merge run: the kept folder is not adopted again
	await syncAccountsWithFiles();
	assert.equal(await rowOf(SECOND), undefined);
	const manager = await api.limited({ visibility: "all", certificates: "manage" });
	const list = await manager.get("/nginx/certificates/acme-servers");
	assert.deepEqual(
		list.body.map((entry) => entry.server),
		[LE],
	);
	const meta = (await api.db("setting").where("id", "acme").first()).meta;
	assert.deepEqual(JSON.parse(meta).removed, [SECOND]);

	// added again: the kept account is adopted (no new registration) and the removal ends
	const added = await admin.post(ACCOUNTS, { server: SECOND });
	assert.equal(added.status, 200, added.text);
	assert.equal((await rowOf(SECOND)).account_id, SECOND_ACCOUNT);
	assert.equal((await normalizedCalls(api)).filter((line) => line.includes(" register ")).length, 0);
	assert.deepEqual([...(await removedServers())], []);
});

it("a save of the instance CA and a removal at the same time keep both changes of the acme setting row", async () => {
	const { markRemoved, removedServers, saveAcmeSetting } = await import("../internal/acme-account.js");
	const servers = Array.from({ length: 5 }, (_, n) => `https://ca${n}.lan/dir`);
	await Promise.all(servers.flatMap((server) => [markRemoved(server, true), saveAcmeSetting(null)]));
	assert.deepEqual([...(await removedServers())], servers);
	const meta = JSON.parse((await api.db("setting").where("id", "acme").first()).meta);
	assert.deepEqual(meta, { server: null, removed: servers });
});

it("a restored row of a removed CA ends the removal", async () => {
	const { removedServers, syncAccountsWithFiles } = await import("../internal/acme-account.js");
	await seedAccount(api, SECOND, SECOND_ACCOUNT);
	const saved = await model
		.query()
		.insertAndFetch({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered" });
	assert.equal((await admin.delete(`${ACCOUNTS}/${saved.id}`)).status, 200);
	await model.query().insert({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered" });
	await syncAccountsWithFiles();
	assert.deepEqual([...(await removedServers())], []);
	assert.equal((await rowOf(SECOND)).state, "registered");
});

it("refuses to add a blocked CA with a kept folder, and stores no row", async () => {
	api.outside.dns.set("loop.lan", "::1");
	await seedAccount(api, "https://loop.lan/dir", SECOND_ACCOUNT);
	const blocked = await admin.post(ACCOUNTS, { server: "https://loop.lan/dir" });
	assert.equal(blocked.status, 400, blocked.text);
	assert.equal(blocked.body.error.message_i18n, "error.acme-blocked");
	assert.equal(await rowOf("https://loop.lan/dir"), undefined);
});

it("needs an administrator, and a session for the removal", async () => {
	const saved = await model
		.query()
		.insertAndFetch({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered" });
	const limited = await api.limited({ visibility: "all", certificates: "manage" });
	assert.equal((await limited.post(ACCOUNTS, { server: SECOND })).status, 403);
	assert.equal((await limited.put(`${ACCOUNTS}/${saved.id}`, { email: "a@example.com" })).status, 403);
	assert.equal((await limited.delete(`${ACCOUNTS}/${saved.id}`)).status, 403);
	const made = generateApiToken();
	await api.db("npmpro_api_token").insert({
		user_id: (await admin.get("/users/me")).body.id,
		name: "accounts token",
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		visibility: "all",
		...Object.fromEntries(
			["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"].map((s) => [
				s,
				"manage",
			]),
		),
		is_admin: true,
		created_on: Math.floor(Date.now() / 1000),
		expires_on: Math.floor(Date.now() / 1000) + 3600,
	});
	const res = await api
		.client()
		.delete(`${ACCOUNTS}/${saved.id}`, { headers: { authorization: `Bearer ${made.token}` } });
	assert.equal(res.status, 403, res.text);
	assert.ok(await rowOf(SECOND));
});

it("lists the CAs for a user who manages certificates, without account details", async () => {
	await model.query().insert({
		server: SECOND,
		email: "secret@example.com",
		account_id: SECOND_ACCOUNT,
		state: "failed",
		error: "secret refusal",
		eab_kid: "x",
	});
	const manager = await api.limited({ visibility: "all", certificates: "manage" });
	const res = await manager.get("/nginx/certificates/acme-servers");
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body, [
		{ server: LE, preset: "letsencrypt", state: "none", instance: true },
		{ server: SECOND, preset: null, state: "failed", instance: false },
	]);
	assert.doesNotMatch(JSON.stringify(res.body), SECRET_WORDS);
	const viewer = await api.limited({ visibility: "all", certificates: "view" });
	assert.equal((await viewer.get("/nginx/certificates/acme-servers")).status, 403);
});

it("replaces the account of another CA", async () => {
	await seedAccount(api, SECOND, SECOND_ACCOUNT);
	await model
		.query()
		.insert({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered", email: "a@example.com" });
	await mkdir(certbotDir("renewal"), { recursive: true });
	await writeFile(
		certbotDir("renewal/npm-1.conf"),
		`version = 5.10.0\n[renewalparams]\naccount = ${SECOND_ACCOUNT}\nserver = ${SECOND}\n`,
	);
	acmeDirectory(api, SECOND, { persist: false });
	const res = await admin.post("/settings/acme/replace", { server: SECOND });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.replaced.moved, 1);
	const saved = await rowOf(SECOND);
	assert.notEqual(saved.account_id, SECOND_ACCOUNT);
	assert.match(await readFile(certbotDir("renewal/npm-1.conf"), "utf8"), new RegExp(saved.account_id, "u"));
});
