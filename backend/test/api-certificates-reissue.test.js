import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls, seedAccount } from "./support/certbot.js";

const CERTS = "/nginx/certificates";
const ACME = "https://acme.test/directory";
const SECOND = "https://second.lan/dir";
const SECOND_ACCOUNT = "c".repeat(32);
const INI = "/run/npmpro/certbot.ini";
const ACCOUNT = /--account [0-9a-f]{32}/gu;

let api;
let admin;
let pair;

const calls = async () =>
	(await normalizedCalls(api))
		.filter((line) => !line.includes(" register "))
		.map((line) => line.replace(ACCOUNT, "--account ID"));
const row = (id) => api.db("certificate").where({ id }).first();
const confOf = (id) => path.join(api.root, `data/tls/certbot/renewal/npm-${id}.conf`);
const issued = async () => {
	const made = await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["a.example.com"] });
	assert.equal(made.status, 201, made.text);
	return made.body;
};

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
after(() => api?.stop());
beforeEach(async () => {
	await api.outside.clearCalls();
	api.outside.passCommand("pip");
	await certbotSucceeds(api, pair);
	await rm(`${api.root}/fake/certonly.fail`, { force: true });
});

it("issues again at another CA: its server and account, the row and conf follow, an audit entry, the old one is revoked on the old CA", async () => {
	const created = await issued();
	const oldConf = await readFile(confOf(created.id), "utf8");
	const oldAccount = /^account = (.+)$/mu.exec(oldConf)[1];
	await api.outside.clearCalls();

	const done = await admin.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: "https://Second.LAN/dir" });
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.npmpro_acme_server, SECOND);
	assert.equal((await row(created.id)).npmpro_acme_server, SECOND);

	const run = await normalizedCalls(api);
	assert.equal(
		run[0].replace(ACCOUNT, "--account ID"),
		`certbot --config ${INI} certonly --server ${SECOND} --account ID --cert-name npm-${created.id} --domains a.example.com --no-reuse-key --authenticator webroot --force-renewal`,
	);
	assert.ok(run[0].includes(`--account ${SECOND_ACCOUNT}`));
	assert.match(
		run[1],
		new RegExp(`revoke --server ${ACME} --account ${oldAccount} --cert-path .*--reason superseded`, "u"),
	);
	const conf = await readFile(confOf(created.id), "utf8");
	assert.match(conf, new RegExp(`^server = ${SECOND}$`, "mu"));

	const audit = await api
		.db("audit_log")
		.where({ object_type: "certificate", object_id: created.id, action: "ca-changed" })
		.first();
	assert.deepEqual(JSON.parse(audit.meta), { old: ACME, new: SECOND });
});

it("a failed re-issue changes nothing: the row, the conf and no revoke", async () => {
	const created = await issued();
	const before = await row(created.id);
	const conf = await readFile(confOf(created.id), "utf8");
	await writeFile(`${api.root}/fake/certonly.fail`, "Challenge failed at the second CA");
	await api.outside.clearCalls();

	const failed = await admin.post(`${CERTS}/${created.id}/reissue`, { npmpro_acme_server: SECOND });
	assert.ok(failed.status >= 400, failed.text);
	assert.match(failed.body.error.output, /Challenge failed at the second CA/u);
	assert.deepEqual(await row(created.id), before);
	assert.equal(await readFile(confOf(created.id), "utf8"), conf);
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
