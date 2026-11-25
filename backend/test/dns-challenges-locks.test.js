import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory } from "./support/certbot.js";

// The locks of the challenge cleanup on an instance whose CA has no account row and no renewal conf yet, and the
// delete taking only the locks (no account registration, no conf write).

const TOKEN = "cf-token-cleanup-locks-1234567890";
const HOST = "https://api.cloudflare.com";
const ACME = "https://acme.test/directory";
const ZONE_ID = "a".repeat(32);
const RECORD_ID = "b".repeat(32);
const NAME = "_acme-challenge.locks.example";
const json = { headers: { "content-type": "application/json" } };
const CONF = "data/tls/certbot/renewal/npm-999.conf";

let api;
let admin;
let credentialId;
let deletes = 0;

const item = { name: NAME, id: RECORD_ID, values: ["tok"] };
const del = () => admin.post(`/nginx/dns-credentials/${credentialId}/challenges/delete`, { items: [item] });

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME, NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	api.outside.dns.set("acme.test", "192.0.2.40");
	acmeDirectory(api, ACME);
	admin = await api.admin();
	const made = await admin.post("/nginx/dns-credentials", {
		name: "Locks credential",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
	});
	if (made.status !== 201) throw new Error(`credential create answered ${made.status}: ${made.text}`);
	credentialId = made.body.id;
	const added = await admin.post("/nginx/dns-domains", { dns_credential_id: credentialId, names: ["locks.example"] });
	if (added.status !== 201) throw new Error(`domain create answered ${added.status}: ${added.text}`);
	const record = { id: RECORD_ID, type: "TXT", name: NAME, content: "tok", modified_on: "2026-01-01T00:00:00Z" };
	const pool = api.outside.http.get(HOST);
	pool.intercept({ path: "/client/v4/zones?name=locks.example", method: "GET" })
		.reply(200, { success: true, result: [{ id: ZONE_ID }] }, json)
		.persist();
	pool.intercept({ path: (url) => url.includes("/dns_records?name.startswith="), method: "GET" })
		.reply(200, { success: true, result: [record], result_info: { page: 1, total_pages: 1 } }, json)
		.persist();
	pool.intercept({ path: (url) => url.includes("/dns_records?name.exact="), method: "GET" })
		.reply(200, { success: true, result: [record] }, json)
		.persist();
	pool.intercept({ path: `/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}`, method: "DELETE" })
		.reply(() => {
			deletes += 1;
			return { statusCode: 200, data: { success: true, result: { id: RECORD_ID } }, responseOptions: json };
		})
		.persist();
});
after(() => api?.stop());

it("holds the instance CA's lock even before the CA has an account row or a renewal conf", async () => {
	const { default: accounts } = await import("../models/acme_account.js");
	assert.equal((await accounts.query()).length, 0);
	const { withAccountLock } = await import("../internal/acme-account.js");
	let letGo;
	const held = new Promise((resolve) => {
		letGo = resolve;
	});
	let locked;
	const taken = new Promise((resolve) => {
		locked = resolve;
	});
	// a certificate request to the instance CA holds its lock
	const request = withAccountLock(ACME, () => {
		locked();
		return held;
	});
	await taken;
	const deleting = del();
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.equal(deletes, 0, "the delete ran beside the request");
	letGo();
	await request;
	const res = await deleting;
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.results[0].result, "deleted");
	assert.equal(deletes, 1);
});

it("takes only the locks: a renewal conf naming a missing account is not prepared", async () => {
	const text = `version = 2.11.0\n\n[renewalparams]\naccount = ${"c".repeat(32)}\nserver = ${ACME}\nauthenticator = webroot\n`;
	await writeFile(path.join(api.root, CONF), text);
	await api.outside.clearCalls();
	const res = await del();
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(
		(await api.outside.calls()).filter((line) => line.startsWith("certbot ")),
		[],
		"certbot ran for the cleanup",
	);
	assert.equal(await readFile(path.join(api.root, CONF), "utf8"), text);
});
