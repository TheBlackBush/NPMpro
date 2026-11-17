import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { generateApiToken } from "../lib/api-token.js";
import { extractTo } from "../lib/backup/archive.js";
import { openBackupFile } from "../lib/backup/format.js";
import { startApi } from "./support/api.js";

// backups and API tokens (roadmap item 27): tokens are never exported, a users restore removes the replaced users'
// tokens, and a token cannot replace or merge users

const BASE = "/backups";
const ALL_TYPES = ["users", "proxy_hosts", "access_lists", "certificates", "settings_runtime"];
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const levels = (level) => ({ visibility: "user", ...Object.fromEntries(SECTIONS.map((s) => [s, level])) });
const now = () => Math.floor(Date.now() / 1000);

let api;
let admin;
let count = 0;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const makeToken = async (userId, fields = {}) => {
	count += 1;
	const made = generateApiToken();
	await api.db("npmpro_api_token").insert({
		user_id: userId,
		name: `token ${count}`,
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		...levels("view"),
		created_on: now(),
		expires_on: now() + 3600,
		...fields,
	});
	return made;
};
const bearer = (text) => {
	const client = api.client();
	const headers = { authorization: `Bearer ${text}` };
	return {
		get: (url) => client.get(url, { headers }),
		post: (url, body) => client.post(url, body, { headers }),
	};
};
const PASSPHRASE = "a long passphrase 1";
const keepBackup = async (types = ["users", "proxy_hosts"], extra = { secrets: false }) => {
	const done = await admin.post(BASE, { types, keep: true, ...extra });
	if (done.status !== 200) throw new Error(done.text);
	return done.body.entry;
};
const open = async (name) => {
	const done = await admin.post(`${BASE}/${name}/inspect`, {});
	if (done.status !== 200) throw new Error(done.text);
	return done.body.token;
};

it("an export has no token", async () => {
	const user = await api.limited(levels("view"));
	const made = await makeToken(user.user.id);
	const entry = await keepBackup(undefined, { secrets: true, passphrase: PASSPHRASE });
	const downloaded = await admin.get(`${BASE}/${entry.name}`);
	assert.equal(downloaded.status, 200, downloaded.text);
	const dir = await mkdtemp(path.join(os.tmpdir(), "token-backup-"));
	try {
		const file = path.join(dir, "backup.npmpro");
		await writeFile(file, downloaded.bytes);
		const out = path.join(dir, "out");
		await extractTo({
			source: await openBackupFile({ file, passphrase: PASSPHRASE }),
			dir: out,
			allow: () => true,
		});
		const names = await readdir(path.join(out, "data"));
		assert.equal(
			names.some((name) => name.includes("api_token")),
			false,
		);
		for (const name of names) {
			const text = await readFile(path.join(out, "data", name), "utf8");
			assert.equal(text.includes("npmpro_api_token"), false, name);
			assert.equal(text.includes(made.token), false, name);
			assert.equal(text.includes(made.secretHash), false, name);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("a merge keeps the tokens", async () => {
	const user = await api.limited(levels("view"));
	const made = await makeToken(user.user.id);
	const entry = await keepBackup();
	const stored = await api.db("npmpro_api_token").where({ lookup_id: made.lookupId }).first();
	const token = await open(entry.name);
	const plan = await admin.post(`${BASE}/restore/${token}/plan`, { mode: "merge", types: ["users"] });
	assert.equal(plan.status, 200, plan.text);
	const merged = await admin.post(`${BASE}/restore/${token}`, {
		mode: "merge",
		types: ["users"],
		plan_hash: plan.body.hash,
	});
	assert.equal(merged.status, 200, merged.text);
	assert.deepEqual(await api.db("npmpro_api_token").where({ lookup_id: made.lookupId }).first(), stored);
	assert.equal((await bearer(made.token).get("/nginx/proxy-hosts")).status, 200);
});

it("a users restore removes the replaced users' tokens, not the admin's", async () => {
	const user = await api.limited(levels("view"));
	const adminId = (await admin.get("/users/me")).body.id;
	const adminToken = await makeToken(adminId);
	const userToken = await makeToken(user.user.id);
	const entry = await keepBackup();
	const token = await open(entry.name);
	const done = await admin.post(`${BASE}/restore/${token}`, { types: ["users"], confirm: true });
	assert.equal(done.status, 200, done.text);
	assert.equal((await bearer(adminToken.token).get("/nginx/proxy-hosts")).status, 200);
	assert.ok(await api.db("npmpro_api_token").where({ lookup_id: adminToken.lookupId }).first());
	assert.equal(await api.db("npmpro_api_token").where({ lookup_id: userToken.lookupId }).first(), undefined);
	assert.equal((await bearer(userToken.token).get("/nginx/proxy-hosts")).status, 401);
	assert.ok(await api.db("user").where({ id: user.user.id }).first());
});

it("a users restore audits every token it deletes", async () => {
	const one = await api.limited(levels("view"));
	const two = await api.limited(levels("view"));
	const first = await makeToken(one.user.id);
	const second = await makeToken(two.user.id);
	const ids = (
		await api.db("npmpro_api_token").whereIn("lookup_id", [first.lookupId, second.lookupId]).select("id", "name")
	).sort((a, b) => a.id - b.id);
	const entry = await keepBackup();
	const token = await open(entry.name);
	const done = await admin.post(`${BASE}/restore/${token}`, { types: ["users"], confirm: true });
	assert.equal(done.status, 200, done.text);
	for (const row of ids) {
		const logged = await api
			.db("audit_log")
			.where({ action: "revoked", object_type: "api-token", object_id: row.id });
		assert.equal(logged.length, 1);
		const meta = typeof logged[0].meta === "string" ? JSON.parse(logged[0].meta) : logged[0].meta;
		assert.equal(meta.name, row.name);
		assert.equal(meta.reason, "restore");
	}
});

it("other restores keep tokens", async () => {
	const user = await api.limited(levels("view"));
	const adminId = (await admin.get("/users/me")).body.id;
	const adminToken = await makeToken(adminId);
	const userToken = await makeToken(user.user.id);
	const entry = await keepBackup();
	const replaced = await admin.post(`${BASE}/restore/${await open(entry.name)}`, {
		types: ["proxy_hosts"],
		confirm: true,
	});
	assert.equal(replaced.status, 200, replaced.text);
	for (const made of [adminToken, userToken]) {
		assert.equal((await bearer(made.token).get("/nginx/proxy-hosts")).status, 200);
	}
	const token = await open(entry.name);
	const plan = await admin.post(`${BASE}/restore/${token}/plan`, { mode: "merge", types: ["users"] });
	const merged = await admin.post(`${BASE}/restore/${token}`, {
		mode: "merge",
		types: ["users"],
		plan_hash: plan.body.hash,
	});
	assert.equal(merged.status, 200, merged.text);
	for (const made of [adminToken, userToken]) {
		assert.equal((await bearer(made.token).get("/nginx/proxy-hosts")).status, 200);
	}
});

it("a token cannot restore users", async () => {
	const adminId = (await admin.get("/users/me")).body.id;
	const made = await makeToken(adminId, { is_admin: true });
	const entry = await keepBackup();
	const token = await open(entry.name);
	const as = bearer(made.token);
	for (const body of [{ types: ["users"] }, { types: ["proxy_hosts", "users"] }, { types: ALL_TYPES }]) {
		const plan = await as.post(`${BASE}/restore/${token}/plan`, { mode: "merge", ...body });
		assert.equal(plan.status, 403, JSON.stringify(body));
		const replace = await as.post(`${BASE}/restore/${token}`, { ...body, confirm: true });
		assert.equal(replace.status, 403, JSON.stringify(body));
		const merge = await as.post(`${BASE}/restore/${token}`, { ...body, mode: "merge", plan_hash: "0".repeat(64) });
		assert.equal(merge.status, 403, JSON.stringify(body));
	}
	const plan = await as.post(`${BASE}/restore/${token}/plan`, { mode: "merge", types: ["proxy_hosts"] });
	assert.equal(plan.status, 200, plan.text);
});

it("a replace restore needs Allow delete", async () => {
	const adminId = (await admin.get("/users/me")).body.id;
	const plain = await makeToken(adminId, { is_admin: true });
	const allowed = await makeToken(adminId, { is_admin: true, allow_delete: true });
	const entry = await keepBackup(["proxy_hosts"]);
	const token = await open(entry.name);
	const refused = await bearer(plain.token).post(`${BASE}/restore/${token}`, {
		types: ["proxy_hosts"],
		confirm: true,
	});
	assert.equal(refused.status, 403, refused.text);
	assert.equal(refused.body.error.message, "This API token cannot delete: turn on Allow delete");
	// a merge adds and replaces, it deletes nothing: the switch is not needed
	const plan = await bearer(plain.token).post(`${BASE}/restore/${token}/plan`, {
		mode: "merge",
		types: ["proxy_hosts"],
	});
	assert.equal(plan.status, 200, plan.text);
	const done = await bearer(allowed.token).post(`${BASE}/restore/${token}`, {
		types: ["proxy_hosts"],
		confirm: true,
	});
	assert.equal(done.status, 200, done.text);
});
