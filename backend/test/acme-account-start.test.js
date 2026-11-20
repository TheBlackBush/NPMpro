import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";

const LE = "https://acme-v02.api.letsencrypt.org/directory";
const PEBBLE = "https://pebble.test:14000/dir";
const [A, B, C, D, E] = ["a", "b", "c", "d", "e"].map((c) => c.repeat(32));
const account = (rel, id, created) => ({
	[`/data/tls/certbot/accounts/${rel}/${id}/meta.json`]: JSON.stringify({ creation_dt: created }),
	[`/data/tls/certbot/accounts/${rel}/${id}/regr.json`]: "{}",
	[`/data/tls/certbot/accounts/${rel}/${id}/private_key.json`]: "{}",
});
const conf = (server, id) =>
	`version = 5.10.0\n[renewalparams]\naccount = ${id}\nserver = ${server}\nauthenticator = webroot\n`;
const REFUSED = /refused/u;
const LOCK_MESSAGE = /already running/u;
const OLD_RUN = "tmp/acme-register-crashed";
let api;
let model;

before(async () => {
	api = await startApi({
		env: { ACME_SERVER: PEBBLE, ACME_EMAIL: "ops@example.com", NPMPRO_TEST_OUTBOUND: "mock" },
		files: {
			...account("acme-v01.api.letsencrypt.org/directory", A, "2023-01-01T00:00:00Z"),
			...account("acme-v01.api.letsencrypt.org/directory", B, "2024-01-01T00:00:00Z"),
			...account("pebble.test:14000/dir", C, "2025-01-01T00:00:00Z"),
			...account("ca.other/acme", E, "2025-02-01T00:00:00Z"),
			"/data/tls/certbot/renewal/npm-1.conf": conf(LE, B),
			"/data/tls/certbot/renewal/npm-2.conf": conf(LE, B),
			"/data/tls/certbot/renewal/npm-3.conf": conf(LE, A),
			"/data/tls/certbot/renewal/npm-4.conf": conf(PEBBLE, D),
			"/data/tls/certbot/renewal/npm-5.conf": conf(`${PEBBLE}/`, D),
			"/data/tls/certbot/renewal/npm-6.conf": conf("https://acme-v01.api.letsencrypt.org/directory", D),
			"/data/tls/certbot/renewal/npm-7.conf": conf("https://nocreds.test/dir", D),
			"/data/tls/certbot/renewal/npm-8.conf": conf("https://Old.Test/dir", D),
			"/tmp/acme-register-crashed/certbot.ini": "email = old@example.com\neab-hmac-key = secret\n",
			"/tmp/keep-me/file": "x",
		},
	});
	model = (await import("../models/acme_account.js")).default;
});
after(() => api.stop());

it("adopts each CA's account at the start: the one most confs name, Let's Encrypt from its v01 folder", async () => {
	const rows = Object.fromEntries((await model.query()).map((row) => [row.server, row]));
	assert.equal(rows[LE].account_id, B);
	assert.equal(rows[LE].state, "registered");
	assert.equal(rows[LE].email, null);
	assert.equal(rows[PEBBLE].account_id, C);
	assert.equal(rows[PEBBLE].email, "ops@example.com");
	assert.equal(rows["https://ca.other/acme"].account_id, E);
	assert.equal(rows["https://acme-v01.api.letsencrypt.org/directory"], undefined);
});

it("points a conf whose account is missing at its CA's registered account, without certbot or the network", async () => {
	const text = await readFile(path.join(api.root, "data/tls/certbot/renewal/npm-4.conf"), "utf8");
	assert.match(text, new RegExp(`^account = ${C}$`, "mu"));
	assert.deepEqual(await normalizedCalls(api), []);
});

it("keys rows and repairs on one spelling per CA: a trailing slash or the v01 URL", async () => {
	const rows = await model.query();
	assert.equal(rows.length, 3);
	const read = (n) => readFile(path.join(api.root, `data/tls/certbot/renewal/npm-${n}.conf`), "utf8");
	assert.match(await read(5), new RegExp(`^account = ${C}$`, "mu"));
	assert.match(await read(6), new RegExp(`^account = ${B}$`, "mu"));
});

it("leaves a conf alone when its CA has no registered account, even if other CAs do", async () => {
	const text = await readFile(path.join(api.root, "data/tls/certbot/renewal/npm-7.conf"), "utf8");
	assert.equal(text, conf("https://nocreds.test/dir", D));
});

it("removes stale run folders at the start and leaves other folders alone", async () => {
	await assert.rejects(readFile(path.join(api.root, OLD_RUN, "certbot.ini")), { code: "ENOENT" });
	assert.equal(await api.read("tmp/keep-me/file"), "x");
});

it("adopts a folder whose row is missing or not registered, so no second account registers", async () => {
	const { syncAccountsWithFiles } = await import("../internal/acme-account.js");
	const dir = path.join(api.root, "data/tls/certbot/accounts/restored.test/dir", D);
	await mkdir(dir, { recursive: true });
	for (const [name, text] of [
		["meta.json", '{"creation_dt":"2025-03-01T00:00:00Z"}'],
		["regr.json", "{}"],
		["private_key.json", "{}"],
	]) {
		await writeFile(path.join(dir, name), text);
	}
	await syncAccountsWithFiles();
	const added = await model.query().where("server", "https://restored.test/dir").first();
	assert.equal(added.account_id, D);
	assert.equal(added.state, "registered");
	await model.query().where("server", "https://restored.test/dir").patch({ state: "pending", account_id: null });
	await model
		.query()
		.where("server", "https://restored.test/dir")
		.patch({ eab_kid: "sealed", eab_hmac_key: "sealed" });
	await syncAccountsWithFiles();
	const again = await model.query().where("server", "https://restored.test/dir").first();
	assert.equal(again.account_id, D);
	assert.equal(again.eab_kid, null);
	assert.equal(again.eab_hmac_key, null);
	assert.deepEqual(await normalizedCalls(api), []);
});

it("marks a registered account whose folder is gone as pending", async () => {
	const { syncAccountsWithFiles } = await import("../internal/acme-account.js");
	await rm(path.join(api.root, "data/tls/certbot/accounts/ca.other"), { recursive: true });
	await syncAccountsWithFiles();
	const row = await model.query().where("server", "https://ca.other/acme").first();
	assert.equal(row.state, "pending");
	assert.equal(row.account_id, null);
});

it("fills the CA of each certificate from its renewal conf, else the instance CA, and leaves custom ones null", async () => {
	const { fillCertificateServers } = await import("../internal/acme-account.js");
	const insert = (id, provider) =>
		api.db("certificate").insert({
			id,
			owner_user_id: 1,
			created_on: "2026-01-01 00:00:00",
			modified_on: "2026-01-01 00:00:00",
			provider,
			nice_name: `c${id}`,
			domain_names: "[]",
			expires_on: "2099-01-01 00:00:00",
			meta: "{}",
		});
	// 5: a trailing slash on a CA with a row, 6: a v01 conf, 8: a CA without a row, 9: no conf, 10: custom
	for (const [id, provider] of [
		[5, "letsencrypt"],
		[6, "letsencrypt"],
		[8, "letsencrypt"],
		[9, "letsencrypt"],
		[10, "other"],
	]) {
		await insert(id, provider);
	}
	await api.db("certificate").where({ id: 6 }).update({ npmpro_acme_server: "https://keep.test/dir" });
	assert.equal(await fillCertificateServers(), 3);
	const servers = Object.fromEntries(
		(await api.db("certificate").whereIn("id", [5, 6, 8, 9, 10])).map((row) => [row.id, row.npmpro_acme_server]),
	);
	assert.deepEqual(servers, {
		5: PEBBLE,
		6: "https://keep.test/dir",
		8: "https://old.test/dir",
		9: PEBBLE,
		10: null,
	});
	await api.db("certificate").where({ id: 6 }).update({ npmpro_acme_server: null });
	assert.equal(await fillCertificateServers(), 1);
	assert.equal((await api.db("certificate").where({ id: 6 }).first()).npmpro_acme_server, LE);
	assert.equal(await fillCertificateServers(), 0);
	assert.deepEqual(await normalizedCalls(api), []);
});

it("updates the recorded email from ACME_EMAIL in the background; a failure stays on the row", async () => {
	const { syncEnvEmail } = await import("../internal/acme-account.js");
	await certbotSucceeds(api, await makeCertificate(api.root, "a.example.com"));
	acmeDirectory(api, PEBBLE);
	await model.query().where("server", PEBBLE).patch({ email: "old@example.com" });
	await syncEnvEmail();
	assert.equal((await model.query().where("server", PEBBLE).first()).email, "ops@example.com");
	const calls = await normalizedCalls(api);
	assert.ok(calls.some((line) => line.includes(`update_account --server ${PEBBLE} --account ${C}`)));
	await model.query().where("server", PEBBLE).patch({ email: "old@example.com" });
	await writeFile(path.join(api.root, "fake/update_account.fail"), "refused");
	await syncEnvEmail();
	const row = await model.query().where("server", PEBBLE).first();
	assert.equal(row.state, "registered");
	assert.equal(row.email, "old@example.com");
	assert.match(row.error, REFUSED);
});

it("retries the start email update while another certbot run holds the lock, without storing that as the error", async () => {
	const { syncEnvEmail } = await import("../internal/acme-account.js");
	acmeDirectory(api, PEBBLE);
	await model.query().where("server", PEBBLE).patch({ email: "old@example.com", error: null });
	await rm(path.join(api.root, "fake/update_account.fail"), { force: true });
	const hook = path.join(api.root, "fake/certbot.hook");
	const count = path.join(api.root, "fake/lock-count");
	await writeFile(count, "");
	await writeFile(
		hook,
		`#!/bin/sh\necho x >> "${count}"\nif [ "$(wc -l < "${count}")" -le 2 ]; then echo "Another instance of Certbot is already running." >&2; exit 1; fi\n`,
	);
	await chmod(hook, 0o755);
	try {
		await syncEnvEmail({ retries: 3, delayMs: 5 });
		let row = await model.query().where("server", PEBBLE).first();
		assert.equal(row.email, "ops@example.com");
		assert.equal(row.error, null);
		assert.equal((await readFile(count, "utf8")).trim().split("\n").length, 3);
		await model.query().where("server", PEBBLE).patch({ email: "old@example.com" });
		await writeFile(count, "");
		await writeFile(
			hook,
			`#!/bin/sh\necho x >> "${count}"\necho "Another instance of Certbot is already running." >&2\nexit 1\n`,
		);
		await syncEnvEmail({ retries: 1, delayMs: 5 });
		row = await model.query().where("server", PEBBLE).first();
		assert.equal(row.email, "old@example.com");
		assert.match(row.error, LOCK_MESSAGE);
		assert.equal((await readFile(count, "utf8")).trim().split("\n").length, 2);
	} finally {
		await rm(hook, { force: true });
	}
});
