import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import {
	acmeDirectory,
	certbotSucceeds,
	makeCertificate,
	normalizedCalls,
	seedAccount,
	validFromProblem,
} from "./support/certbot.js";

const CERTS = "/nginx/certificates";
const ACME = "https://acme.test/directory";
const SECOND = "https://second.lan/dir";
const SECOND_ACCOUNT = "c".repeat(32);
const INI = "/run/npmpro/certbot.ini";
const ACCOUNT = /--account [0-9a-f]{32}/gu;
const ACCOUNT_LINE = /^account = (?<id>.+)$/mu;
const REISSUE_FAILED = /^The CA did not issue the certificate: Challenge failed/u;
const NO_REVOKE_FILES = /--cert-path .*--reason superseded/u;
const accountOf = (conf) => ACCOUNT_LINE.exec(conf).groups.id;

let api;
let admin;
let pair;

const calls = async () =>
	(await normalizedCalls(api))
		.filter((line) => !line.includes(" register "))
		.map((line) => line.replace(ACCOUNT, "--account ID"));
const row = (id) => api.db("certificate").where({ id }).first();
const confOf = (id) => path.join(api.root, `data/tls/certbot/renewal/npm-${id}.conf`);
const issued = async () => (await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["a.example.com"] })).body;

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME, NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("acme.test", "192.0.2.40");
	acmeDirectory(api, ACME);
	admin = await api.admin();
	pair = await makeCertificate(path.join(api.root, "fake"), "a.example.com");
	const model = (await import("../models/acme_account.js")).default;
	await seedAccount(api, SECOND, SECOND_ACCOUNT);
	await model.query().insert({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered" });
});
beforeEach(async () => {
	await api.outside.clearCalls();
	api.outside.passCommand("pip");
	await certbotSucceeds(api, pair);
	await rm(`${api.root}/fake/certonly.fail`, { force: true });
});
after(() => api?.stop());

it("issues again at another CA: its server and account, the row and conf follow, an audit entry, the old one is revoked on the old CA", async () => {
	const created = await issued();
	const oldConf = await readFile(confOf(created.id), "utf8");
	const oldAccount = accountOf(oldConf);
	await api.outside.clearCalls();
	await api.db("certificate").where({ id: created.id }).update({ npmpro_valid_from: null });

	const done = await admin.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: "https://Second.LAN/dir" });
	assert.equal(done.status, 200, done.text);
	assert.equal(validFromProblem(await row(created.id)), null);
	assert.equal(done.body.npmpro_acme_server, SECOND);
	assert.equal((await row(created.id)).npmpro_acme_server, SECOND);

	const run = await normalizedCalls(api);
	assert.equal(
		run[0].replace(ACCOUNT, "--account ID"),
		`certbot --config ${INI} certonly --server ${SECOND} --account ID --cert-name npm-${created.id} --domains a.example.com --no-reuse-key --authenticator webroot --force-renewal`,
	);
	assert.ok(run[0].includes(`--account ${SECOND_ACCOUNT}`));
	assert.match(run[1], new RegExp(`revoke --server ${ACME} --account ${oldAccount} ${NO_REVOKE_FILES.source}`, "u"));
	const conf = await readFile(confOf(created.id), "utf8");
	assert.match(conf, new RegExp(`^server = ${SECOND}$`, "mu"));
	assert.match(conf, new RegExp(`^account = ${SECOND_ACCOUNT}$`, "mu"));
	assert.notEqual(accountOf(conf), oldAccount);

	const audit = await api
		.db("audit_log")
		.where({ object_type: "certificate", object_id: created.id, action: "ca-changed" })
		.first();
	assert.deepEqual(JSON.parse(audit.meta), {
		old: ACME,
		new: SECOND,
		domain_names: ["a.example.com"],
		nice_name: "a.example.com",
	});
});

it("a failed re-issue changes nothing: the row, the conf and no revoke", async () => {
	const created = await issued();
	const stored = await row(created.id);
	const conf = await readFile(confOf(created.id), "utf8");
	const live = path.join(api.root, `data/tls/certbot/live/npm-${created.id}/fullchain.pem`);
	const files = await readFile(live, "utf8");
	await writeFile(`${api.root}/fake/certonly.fail`, "Challenge failed at the second CA");
	await api.outside.clearCalls();

	const failed = await admin.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: SECOND });
	assert.equal(failed.status, 400, failed.text);
	assert.equal(failed.body.error.message_i18n, "error.acme-reissue-failed");
	assert.equal(failed.body.error.message_values.message, "Challenge failed at the second CA");
	assert.match(failed.body.error.message, REISSUE_FAILED);
	assert.deepEqual(await row(created.id), stored);
	assert.equal(await readFile(confOf(created.id), "utf8"), conf);
	assert.equal(await readFile(live, "utf8"), files);
	assert.equal((await calls()).filter((line) => line.includes(" revoke ")).length, 0);
});

it("refuses the CA the certificate already has, in any spelling", async () => {
	const created = await issued();
	await api.outside.clearCalls();
	const same = await admin.post(`${CERTS}/${created.id}/reissue`, {
		npmpro_acme_server: "https://ACME.test/directory",
	});
	assert.equal(same.status, 400, same.text);
	assert.equal(same.body.error.message_i18n, "error.acme-same-ca");
	assert.deepEqual(await calls(), []);
});

it("refuses a CA outside the list", async () => {
	const created = await issued();
	await api.outside.clearCalls();
	const typo = await admin.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: "https://typo.lan/dir" });
	assert.equal(typo.status, 400, typo.text);
	assert.equal(typo.body.error.message_i18n, "error.acme-ca-not-allowed");
	assert.deepEqual(await calls(), []);
});

it("refuses a custom certificate", async () => {
	const made = await admin.post(CERTS, { provider: "other", nice_name: "custom" });
	assert.equal(made.status, 201, made.text);
	const refused = await admin.post(`${CERTS}/${made.body.id}/reissue`, { npmpro_acme_server: SECOND });
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.acme-reissue-acme-only");
});

it("needs certificates:manage", async () => {
	const created = await issued();
	const viewer = await api.limited({
		visibility: "all",
		certificates: "view",
		proxy_hosts: "hidden",
		redirection_hosts: "hidden",
		dead_hosts: "hidden",
		streams: "hidden",
		access_lists: "hidden",
	});
	const refused = await viewer.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: SECOND });
	assert.equal(refused.status, 403, refused.text);
});

it("a reload that fails after the re-issue still answers success, with the new CA, and revokes nothing", async () => {
	const created = await issued();
	await api.outside.clearCalls();
	api.outside.control.failNext = "nginx: reload failed";
	const done = await admin.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: SECOND });
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.npmpro_acme_server, SECOND);
	assert.equal((await row(created.id)).npmpro_acme_server, SECOND);
	assert.equal((await normalizedCalls(api)).filter((line) => line.includes(" revoke ")).length, 0);
});

it("a Let's Encrypt row without live files answers a clear error and runs nothing", async () => {
	const made = await api.db("certificate").insert({
		provider: "letsencrypt",
		nice_name: "nofiles.example.com",
		domain_names: JSON.stringify(["nofiles.example.com"]),
		owner_user_id: 1,
		npmpro_acme_server: ACME,
		meta: "{}",
		expires_on: "2027-01-01 00:00:00",
		created_on: "2026-11-19 10:00:00",
		modified_on: "2026-11-19 10:00:00",
	});
	const id = made[0];
	await api.outside.clearCalls();
	const refused = await admin.post(`${CERTS}/${id}/reissue`, { npmpro_acme_server: SECOND });
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.acme-reissue-no-files");
	assert.deepEqual(await calls(), []);
});

it("a re-issue at Let's Encrypt staging adds --break-my-certs and revokes nothing, any other CA does not", async () => {
	const model = (await import("../models/acme_account.js")).default;
	const staging = "https://acme-staging-v02.api.letsencrypt.org/directory";
	const stagingAccount = "d".repeat(32);
	await seedAccount(api, staging, stagingAccount);
	await model.query().insert({ server: staging, account_id: stagingAccount, state: "registered" });
	try {
		const created = await issued();
		await api.outside.clearCalls();
		const done = await admin.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: staging });
		assert.equal(done.status, 200, done.text);
		const [certonly, ...rest] = await normalizedCalls(api);
		assert.ok(certonly.endsWith("--force-renewal --break-my-certs"), certonly);
		// the trusted certificate stays valid: a test CA's one is no replacement
		assert.equal(rest.filter((line) => line.includes(" revoke ")).length, 0);
	} finally {
		await model.query().delete().where({ server: staging });
	}
});

it("a failed plugin install in a DNS re-issue keeps its own error, not the CA's", async () => {
	const credential = await admin.post("/nginx/dns-credentials", {
		name: "Cloudflare reissue",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "cf-token" }],
	});
	assert.equal(credential.status, 201, credential.text);
	const made = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["dns.example.com"],
		npmpro_dns_challenge: true,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: credential.body.id,
	});
	assert.equal(made.status, 201, made.text);
	await api.outside.failCommand("pip", "ERROR: no matching distribution");
	await api.outside.clearCalls();
	const failed = await admin.post(`${CERTS}/${made.body.id}/reissue`, { npmpro_acme_server: SECOND });
	assert.equal(failed.status, 500, failed.text);
	assert.notEqual(failed.body.error.message_i18n, "error.acme-reissue-failed");
	assert.equal((await row(made.body.id)).npmpro_acme_server, ACME);
	assert.deepEqual(await calls(), []);
});

it("an error after a successful certbot run still stores the CA the renewal conf names", async () => {
	const created = await issued();
	const good = await readFile(pair.certificate);
	await writeFile(pair.certificate, "not a certificate");
	try {
		const failed = await admin.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: SECOND });
		assert.ok(failed.status >= 400, failed.text);
	} finally {
		await writeFile(pair.certificate, good);
	}
	assert.match(await readFile(confOf(created.id), "utf8"), new RegExp(`^server = ${SECOND}$`, "mu"));
	assert.equal((await row(created.id)).npmpro_acme_server, SECOND);
});

it("a create stores the instance CA in one spelling, whatever the spelling of ACME_SERVER", async () => {
	const { allowedAcmeServers } = await import("../internal/acme-account.js");
	const model = (await import("../models/acme_account.js")).default;
	const original = process.env.ACME_SERVER;
	process.env.ACME_SERVER = "https://ACME.test/directory/";
	try {
		// the row's spelling
		assert.equal((await allowedAcmeServers())[0], ACME);
		const created = await issued();
		assert.equal(created.npmpro_acme_server, ACME);
		// no row: the CA's key
		const rows = await model.query().where("server", ACME);
		await model.query().delete().where("server", ACME);
		try {
			assert.equal((await allowedAcmeServers())[0], ACME);
		} finally {
			for (const saved of rows) await model.query().insert(saved);
		}
	} finally {
		process.env.ACME_SERVER = original;
	}
});
