import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
	await syncAccountsWithFiles();
	assert.equal((await model.query().where("server", "https://restored.test/dir").first()).account_id, D);
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
