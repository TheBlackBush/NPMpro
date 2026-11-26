import assert from "node:assert/strict";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import {
	acmeDirectory,
	certbotEnvironment,
	certbotFails,
	certbotSucceeds,
	makeCertificate,
	normalizedCalls,
	seedAccount,
	validFromProblem,
} from "./support/certbot.js";
import { countRows, fileExists, reloads } from "./support/hosts.js";

const CERTS = "/nginx/certificates";
const ACME = "https://acme.test/directory";
const INI = "/run/npmpro/certbot.ini";
// the names certbot may get from the backend (lib/certbot.js), plus what the shell of the fake adds itself
const ALLOWED = new Set([
	"PATH",
	"HOME",
	"TZ",
	"LANG",
	"LC_ALL",
	"PIP_USER",
	"PYTHONUSERBASE",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"REQUESTS_CA_BUNDLE",
	"PWD",
	"OLDPWD",
	"SHLVL",
	"_",
	// added by Node itself to every child process when the run is measured with c8
	"NODE_V8_COVERAGE",
]);
const SECRETS = {
	COOKIE_SECRET: "api-test-cookie-secret",
	ACME_EAB_HMAC_KEY: "eab-hmac-secret-value",
	ACME_EAB_KID: "eab-kid-value",
	OIDC_CLIENT_SECRET: "oidc-client-secret-value",
	DB_POSTGRES_PASSWORD: "postgres-secret-value",
	CROWDSEC_API_KEY: "crowdsec-secret-value",
};

let api;
let admin;
let pair;
let plugins;

const ACCOUNT = /--account [0-9a-f]{32}/gu;
// the calls without registrations, the account id shown as ID
const certbotCalls = async () =>
	(await normalizedCalls(api))
		.filter((line) => !line.includes(" register "))
		.map((line) => line.replace(ACCOUNT, "--account ID"));
const pipCalls = async () =>
	(await api.outside.calls()).filter((call) => call.startsWith("pip ")).map((call) => call.replaceAll(api.root, ""));
const row = (id) => api.db("certificate").where({ id }).first();
let credentials = 0;
const credential = async (token = "cf-token-SECRET", session = admin) => {
	credentials += 1;
	const made = await session.post("/nginx/dns-credentials", {
		name: `Cloudflare ${credentials}`,
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: token }],
	});
	assert.equal(made.status, 201, made.text);
	return made.body;
};
const requested = async (domains = ["a.example.com"], extra = {}) => {
	const made = await admin.post(CERTS, { provider: "letsencrypt", domain_names: domains, ...extra });
	assert.equal(made.status, 201, made.text);
	return made.body;
};
const dnsRequested = async (token = "cf-token-SECRET", extra = {}) => {
	const cred = await credential(token);
	const made = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["*.dns.example.com"],
		npmpro_dns_challenge: true,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: cred.id,
		...extra,
	});
	assert.equal(made.status, 201, made.text);
	return { certificate: made.body, credential: cred };
};

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME, NPMPRO_TEST_OUTBOUND: "mock", ...SECRETS } });
	api.outside.dns.set("acme.test", "192.0.2.40");
	acmeDirectory(api, ACME);
	admin = await api.admin();
	pair = await makeCertificate(path.join(api.root, "fake"), "a.example.com");
	plugins = JSON.parse(await readFile(new URL("../certbot/dns-plugins.json", import.meta.url), "utf8"));
});
after(() => api?.stop());
beforeEach(async () => {
	await api.outside.clearCalls();
	api.outside.passCommand("pip");
	await certbotSucceeds(api, pair);
});

it("requests a certificate over HTTP: certbot gets the config file, server, name, domains and the webroot authenticator", async () => {
	const created = await requested(["a.example.com", "www.a.example.com"]);
	assert.deepEqual(await certbotCalls(), [
		`certbot --config ${INI} certonly --server ${ACME} --account ID --cert-name npm-${created.id} --domains a.example.com,www.a.example.com --no-reuse-key --authenticator webroot`,
	]);
	assert.equal(created.provider, "letsencrypt");
	assert.equal(created.nice_name, "a.example.com, www.a.example.com");
	assert.deepEqual(created.domain_names, ["a.example.com", "www.a.example.com"]);
	assert.equal(created.npmpro_dns_challenge, false);
	// the expiry comes from the certificate certbot wrote
	assert.ok(Date.parse(created.expires_on) > Date.now() + 25 * 86400000);
	const stored = await row(created.id);
	assert.equal(validFromProblem(stored), null);
	assert.equal(stored.provider, "letsencrypt");
	assert.equal(
		await api.read(`data/tls/certbot/live/npm-${created.id}/fullchain.pem`),
		await readFile(pair.certificate, "utf8"),
	);
	assert.equal(await fileExists(api, `data/tls/certbot/renewal/npm-${created.id}.conf`), true);
	const audit = await api.db("audit_log").where({ object_type: "certificate", object_id: created.id }).first();
	assert.equal(audit.action, "created");
	assert.equal(await fileExists(api, `tmp/certbot-credentials/credentials-${created.id}`), false);
});

it("asks for the same key again when the certificate says so, and passes IP addresses and international names", async () => {
	const created = await requested(["münchen.example.com", "192.0.2.7", "[2001:db8::1]"], { npmpro_reuse_key: true });
	assert.deepEqual(await certbotCalls(), [
		`certbot --config ${INI} certonly --server ${ACME} --account ID --cert-name npm-${created.id} --domains xn--mnchen-3ya.example.com --ip-address 192.0.2.7 --ip-address 2001:db8::1 --reuse-key --authenticator webroot`,
	]);
	assert.equal((await row(created.id)).npmpro_reuse_key, 1);
});

it("runs certbot with the minimal environment and none of the backend's secrets", async () => {
	await requested();
	const env = await certbotEnvironment(api);
	assert.deepEqual(
		Object.keys(env).filter((key) => !ALLOWED.has(key)),
		[],
	);
	for (const key of ["PATH", "HOME"]) assert.ok(env[key], key);
	assert.ok(env.PATH.startsWith(path.join(api.root, "bin")));
	for (const [key, secret] of Object.entries(SECRETS)) {
		assert.equal(key in env, false, key);
		assert.equal(
			Object.values(env).some((value) => value.includes(secret)),
			false,
			key,
		);
	}
	for (const key of ["NPMPRO_TEST_ROOT", "ACME_SERVER", "COOKIE_SECRET", "DB_POSTGRES_PASSWORD"])
		assert.equal(key in env, false, key);
});

it("shows the output of a failed certbot in error.output and removes the new row", async () => {
	await certbotFails(api, "Challenge failed for domain fail.example.com");
	const rows = await countRows(api, "certificate");
	const failed = await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["fail.example.com"] });
	assert.equal(failed.status, 500);
	assert.equal(failed.body.error.message, "Internal Error");
	assert.match(failed.body.error.output, /Challenge failed for domain fail\.example\.com/u);
	assert.equal(await countRows(api, "certificate"), rows);
	assert.equal(
		await api
			.db("audit_log")
			.where({ object_type: "certificate", action: "created", object_id: rows + 1 })
			.first(),
		undefined,
	);
});

it("returns the readable message of a failed request, without certbot's log path and help text", async () => {
	await api.outside.hookCommand(
		"certbot",
		`#!/bin/sh
echo "Saving debug log to /tmp/letsencrypt/logs/letsencrypt.log" >&2
echo "An unexpected error occurred:" >&2
echo "urn:ietf:params:acme:error:accountDoesNotExist :: Account not found" >&2
echo "Ask for help or search for solutions at https://community.letsencrypt.org. See the logfile /tmp/letsencrypt/logs/letsencrypt.log or re-run Certbot with -v for more details." >&2
exit 1
`,
	);
	const failed = await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["clean.example.com"] });
	assert.equal(failed.status, 500);
	assert.equal(failed.body.error.output, "urn:ietf:params:acme:error:accountDoesNotExist :: Account not found");
});

it("refuses a certbot certificate that has no files after a run that did nothing, and removes the row", async () => {
	await api.outside.hookCommand("certbot", "#!/bin/sh\nexit 0\n");
	const rows = await countRows(api, "certificate");
	const failed = await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["empty.example.com"] });
	assert.equal(failed.status, 500);
	assert.equal(await countRows(api, "certificate"), rows);
});

it("requests a certificate over DNS: installs the plugin, writes the credentials file, passes it to certbot", async () => {
	const { certificate, credential: saved } = await dnsRequested("cf-token-SECRET", {
		npmpro_propagation_seconds: 30,
		npmpro_reuse_key: true,
	});
	const plugin = plugins.cloudflare;
	assert.deepEqual(await pipCalls(), [
		`pip install --no-cache-dir --constraint /usr/local/share/npmpro/certbot-constraints.txt ${plugin.package_name}==${plugin.version}`,
	]);
	assert.deepEqual(await certbotCalls(), [
		`certbot --config ${INI} certonly --server ${ACME} --account ID --cert-name npm-${certificate.id} --domains *.dns.example.com --reuse-key --authenticator ${plugin.full_plugin_name} --${plugin.full_plugin_name}-credentials /tmp/certbot-credentials/credentials-${certificate.id} --${plugin.full_plugin_name}-propagation-seconds 30`,
	]);
	const file = `tmp/certbot-credentials/credentials-${certificate.id}`;
	assert.equal(await api.read(file), "dns_cloudflare_api_token = cf-token-SECRET\n");
	assert.equal((await stat(path.join(api.root, file))).mode & 0o077, 0);
	assert.equal(certificate.npmpro_dns_challenge, true);
	assert.equal(certificate.npmpro_dns_provider, "cloudflare");
	assert.equal(certificate.npmpro_dns_credential_id, saved.id);
	assert.equal(JSON.stringify(certificate).includes("cf-token-SECRET"), false);
	const stored = await row(certificate.id);
	assert.equal(JSON.stringify(stored).includes("cf-token-SECRET"), false);
});

it("leaves out the propagation option when it is 0, and does not leak the credentials into the environment", async () => {
	const { certificate } = await dnsRequested();
	const [call] = await certbotCalls();
	assert.equal(call.includes("propagation"), false);
	assert.ok(call.endsWith(`credentials-${certificate.id}`));
	const env = await certbotEnvironment(api);
	assert.equal(
		Object.values(env).some((value) => value.includes("cf-token-SECRET")),
		false,
	);
});

it("removes the credentials file and the row when the DNS request fails", async () => {
	await certbotFails(api, "DNS problem: NXDOMAIN looking up TXT");
	const cred = await credential("fail-token");
	const rows = await countRows(api, "certificate");
	const files = await readdirOrEmpty("tmp/certbot-credentials");
	const failed = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["dnsfail.example.com"],
		npmpro_dns_challenge: true,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: cred.id,
	});
	assert.equal(failed.status, 500);
	assert.match(failed.body.error.output, /NXDOMAIN/u);
	assert.equal(await countRows(api, "certificate"), rows);
	assert.deepEqual(await readdirOrEmpty("tmp/certbot-credentials"), files);
});

const readdirOrEmpty = async (dir) => {
	const { readdir } = await import("node:fs/promises");
	return (await readdir(path.join(api.root, dir)).catch(() => [])).filter((file) => file.startsWith("credentials-"));
};

it("removes the row when the plugin cannot be installed, and does not call certbot", async () => {
	await api.outside.failCommand("pip", "ERROR: no matching distribution");
	const cred = await credential("pip-token");
	const rows = await countRows(api, "certificate");
	const failed = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["pipfail.example.com"],
		npmpro_dns_challenge: true,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: cred.id,
	});
	assert.equal(failed.status, 500);
	assert.match(failed.body.error.output, /no matching distribution/u);
	assert.equal(await countRows(api, "certificate"), rows);
	assert.deepEqual(await certbotCalls(), []);
});

it("installs no plugin when the account check fails for a DNS certificate", async () => {
	const cred = await credential("order-token");
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	await api.db("npmpro_acme_account").delete();
	await writeFile(path.join(api.root, "fake/register.fail"), "Account refused");
	await api.outside.clearCalls();
	const failed = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["*.order.example.com"],
		npmpro_dns_challenge: true,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: cred.id,
	});
	await rm(path.join(api.root, "fake/register.fail"));
	assert.ok(failed.status >= 400, failed.text);
	assert.deepEqual(await pipCalls(), []);
});

it("refuses a DNS certificate with a wrong credential, provider or user, before certbot runs", async () => {
	const cred = await credential("other-token");
	const rows = await countRows(api, "certificate");
	const base = {
		provider: "letsencrypt",
		domain_names: ["refuse.example.com"],
		npmpro_dns_challenge: true,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: cred.id,
	};
	const wrongProvider = await admin.post(CERTS, { ...base, npmpro_dns_provider: "digitalocean" });
	assert.equal(wrongProvider.status, 400);
	assert.match(wrongProvider.body.error.message, /belongs to another DNS provider/u);
	const unknown = await admin.post(CERTS, { ...base, npmpro_dns_credential_id: 9999 });
	assert.equal(unknown.status, 404);
	const old = await admin.post(CERTS, { ...base, npmpro_dns_provider: "cloudxns" });
	assert.equal(old.status, 400);
	assert.match(old.body.error.message, /no longer supported/u);
	const foreign = await api.limited({ visibility: "user", certificates: "manage" });
	const notYours = await foreign.post(CERTS, base);
	assert.equal(notYours.status, 404);
	assert.equal(await countRows(api, "certificate"), rows);
	assert.deepEqual(await certbotCalls(), []);
});

it("renews a certificate: certbot renews with a new key, revokes the old one, nginx reloads, the expiry is read again", async () => {
	const created = await requested(["renew.example.com"]);
	await api
		.db("certificate")
		.where({ id: created.id })
		.update({ expires_on: "2020-01-01 00:00:00", npmpro_valid_from: null });
	await api.outside.clearCalls();
	const renewal = path.join(api.root, `data/tls/certbot/renewal/npm-${created.id}.conf`);
	const old = "https://old-acme.test/directory";
	await seedAccount(api, old, "c".repeat(32));
	await writeFile(renewal, `[renewalparams]\naccount = ${"c".repeat(32)}\nserver = ${old}\n`);
	const before = reloads(api);
	const done = await admin.post(`${CERTS}/${created.id}/renew`, {});
	assert.equal(done.status, 200, done.text);
	const calls = await certbotCalls();
	assert.equal(calls.length, 2);
	assert.equal(calls[0], `certbot --config ${INI} renew --cert-name npm-${created.id} --new-key --force-renewal`);
	assert.equal(
		calls[1],
		`certbot --config ${INI} revoke --server ${old} --account ID --cert-path /data/tls/certbot/live/npm-${created.id}/cert.pem --reason superseded --no-delete-after-revoke`,
	);
	assert.ok(reloads(api) > before);
	assert.ok(Date.parse(done.body.expires_on) > Date.now() + 25 * 86400000);
	assert.ok(Date.parse((await row(created.id)).expires_on) > Date.now());
	assert.equal(validFromProblem(await row(created.id)), null);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "certificate", object_id: created.id, action: "updated" })
		.first();
	assert.ok(audit);
	const env = await certbotEnvironment(api);
	assert.deepEqual(
		Object.keys(env).filter((key) => !ALLOWED.has(key)),
		[],
	);
});

it("renews a certificate on the CA that issued it, after the instance CA changed", async () => {
	const OLD = "https://old-acme.test/directory";
	const OLD_ID = "d".repeat(32);
	api.outside.dns.set("old-acme.test", "192.0.2.41");
	acmeDirectory(api, OLD);
	await seedAccount(api, OLD, OLD_ID);
	const certificate = await requested(["old.example.com"]);
	const conf = path.join(api.root, `data/tls/certbot/renewal/npm-${certificate.id}.conf`);
	// the conf names the old CA and an account that no longer exists there
	await writeFile(
		conf,
		`version = 5.10.0\n[renewalparams]\naccount = ${"f".repeat(32)}\nserver = ${OLD}\nauthenticator = webroot\n`,
	);
	await api.db("npmpro_acme_account").insert({
		server: OLD,
		state: "registered",
		account_id: OLD_ID,
		created_on: "2026-11-19 10:00:00",
		modified_on: "2026-11-19 10:00:00",
	});
	await api.outside.clearCalls();
	assert.equal((await admin.post(`${CERTS}/${certificate.id}/renew`, {})).status, 200);
	const calls = await normalizedCalls(api);
	assert.equal(calls[0], `certbot --config ${INI} renew --cert-name npm-${certificate.id} --new-key --force-renewal`);
	assert.ok(calls.every((line) => !line.includes(` --server ${ACME}`)));
	assert.match(calls[1], new RegExp(`revoke --server ${OLD} --account ${OLD_ID} --cert-path`, "u"));
	const text = await readFile(conf, "utf8");
	assert.match(text, new RegExp(`^server = ${OLD}$`, "mu"));
	assert.match(text, new RegExp(`^account = ${OLD_ID}$`, "mu"));
});

it("fails a manual renew whose CA has no usable account with the registration message, before certbot renews", async () => {
	const GONE = "https://gone.lan/dir";
	api.outside.dns.set("gone.lan", "192.168.1.30");
	acmeDirectory(api, GONE, { status: 503, body: "down" });
	const certificate = await requested(["gone.example.com"]);
	await writeFile(
		path.join(api.root, `data/tls/certbot/renewal/npm-${certificate.id}.conf`),
		`[renewalparams]\naccount = ${"e".repeat(32)}\nserver = ${GONE}\n`,
	);
	await api.outside.clearCalls();
	const res = await admin.post(`${CERTS}/${certificate.id}/renew`, {});
	assert.equal(res.status, 400, res.text);
	assert.equal(res.body.error.message_i18n, "error.acme-unreachable");
	assert.deepEqual(
		(await normalizedCalls(api)).filter((line) => line.includes(" renew ")),
		[],
	);
});

it("revokes with the certificate's key when the revoke by account is refused", async () => {
	const certificate = await requested(["revoke.example.com"]);
	await writeFile(path.join(api.root, "fake/revoke.fail"), "unauthorized");
	await api.outside.clearCalls();
	assert.equal((await admin.delete(`${CERTS}/${certificate.id}`)).status, 200);
	const revokes = (await certbotCalls()).filter((line) => line.includes(" revoke "));
	const live = `/data/tls/certbot/live/npm-${certificate.id}`;
	assert.equal(
		revokes[0],
		`certbot --config ${INI} revoke --server ${ACME} --account ID --cert-name npm-${certificate.id} --reason unspecified --no-delete-after-revoke`,
	);
	assert.equal(
		revokes[1],
		`certbot --config ${INI} revoke --server ${ACME} --cert-path ${live}/cert.pem --key-path ${live}/privkey.pem --reason unspecified --no-delete-after-revoke`,
	);
	await rm(path.join(api.root, "fake/revoke.fail"));
});

it("answers a clear error for an unreachable CA and leaves no certificate", async () => {
	const DOWN = "https://down.lan/dir";
	api.outside.dns.set("down.lan", "192.168.1.31");
	acmeDirectory(api, DOWN, { status: 503, body: "down" });
	const rows = await countRows(api, "certificate");
	await api.db("npmpro_acme_account").delete();
	// a CA with a row that has no account yet registers at the request
	await (await import("../models/acme_account.js")).default.query().insert({ server: DOWN, state: "pending" });
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	const { default: acmeAccount } = await import("../internal/certificate-acme.js");
	await assert.rejects(
		acmeAccount.requestCertbot({ id: 9999, domain_names: ["x.example.com"], npmpro_acme_server: DOWN }, null),
		(err) => err.message_i18n === "error.acme-unreachable",
	);
	assert.equal(await countRows(api, "certificate"), rows);
	assert.deepEqual(
		(await certbotCalls()).filter((line) => line.includes(" certonly ")),
		[],
	);
});

it("refuses the request, with no certonly and no row, when the CA refuses the registration", async () => {
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	await api.db("npmpro_acme_account").delete();
	await writeFile(path.join(api.root, "fake/register.fail"), "Account refused");
	const rows = await countRows(api, "certificate");
	const failed = await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["refused.example.com"] });
	await rm(path.join(api.root, "fake/register.fail"));
	assert.ok(failed.status >= 400, failed.text);
	assert.equal(await countRows(api, "certificate"), rows);
	assert.deepEqual(
		(await certbotCalls()).filter((line) => line.includes(" certonly ")),
		[],
	);
});

it("does not revoke with the key when the certificate has no renewal conf (no known CA)", async () => {
	const certificate = await requested(["noconf.example.com"]);
	await rm(path.join(api.root, `data/tls/certbot/renewal/npm-${certificate.id}.conf`));
	await writeFile(path.join(api.root, "fake/revoke.fail"), "unauthorized");
	await api.outside.clearCalls();
	assert.equal((await admin.delete(`${CERTS}/${certificate.id}`)).status, 200);
	await rm(path.join(api.root, "fake/revoke.fail"));
	const revokes = (await certbotCalls()).filter((line) => line.includes(" revoke "));
	assert.equal(revokes.length, 1);
	assert.equal(revokes[0].includes("--key-path"), false);
});

it("registers lazily at the first request: one register, then the same account", async () => {
	await rm(path.join(api.root, "data/tls/certbot/accounts"), { recursive: true, force: true });
	await api.db("npmpro_acme_account").delete();
	await api.outside.clearCalls();
	await requested(["lazy.example.com"]);
	const calls = await normalizedCalls(api);
	assert.ok(calls[0].includes(" register "));
	assert.equal(calls.filter((line) => line.includes(" register ")).length, 1);
	assert.ok(calls[1].includes(" certonly --server "));
});

it("keeps a certificate when certbot fails to renew it: the error output, no reload, the expiry unchanged", async () => {
	const created = await requested(["keep.example.com"]);
	const expires = (await row(created.id)).expires_on;
	await certbotFails(api, "Rate limit hit for keep.example.com");
	const before = reloads(api);
	const failed = await admin.post(`${CERTS}/${created.id}/renew`, {});
	assert.equal(failed.status, 500);
	assert.match(failed.body.error.output, /Rate limit hit/u);
	assert.equal(reloads(api), before);
	assert.equal((await row(created.id)).expires_on, expires);
	assert.equal(await fileExists(api, `data/tls/certbot/live/npm-${created.id}/fullchain.pem`), true);
});

it("refuses to renew a certificate that has no certbot files", async () => {
	const [id] = await api.db("certificate").insert({
		owner_user_id: 1,
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		provider: "letsencrypt",
		nice_name: "nofiles",
		domain_names: JSON.stringify(["nofiles.example.com"]),
		expires_on: "2099-01-01 00:00:00",
		meta: "{}",
	});
	const failed = await admin.post(`${CERTS}/${id}/renew`, {});
	assert.equal(failed.status, 500);
	assert.deepEqual(await certbotCalls(), []);
});

it("deletes a certbot certificate: certbot revokes and deletes it, its files and credentials file are gone", async () => {
	const { certificate } = await dnsRequested();
	const file = `tmp/certbot-credentials/credentials-${certificate.id}`;
	assert.equal(await fileExists(api, file), true);
	await api.outside.clearCalls();
	const deleted = await admin.delete(`${CERTS}/${certificate.id}`);
	assert.equal(deleted.status, 200, deleted.text);
	assert.deepEqual(await certbotCalls(), [
		`certbot --config ${INI} revoke --server ${ACME} --account ID --cert-name npm-${certificate.id} --reason unspecified --no-delete-after-revoke`,
		`certbot --config ${INI} delete --cert-name npm-${certificate.id}`,
	]);
	assert.equal(await row(certificate.id), undefined);
	assert.equal(await fileExists(api, file), false);
	assert.equal(await fileExists(api, `data/tls/certbot/live/npm-${certificate.id}`), false);
	assert.equal(await fileExists(api, `data/tls/certbot/renewal/npm-${certificate.id}.conf`), false);
});

it("deletes the row even when certbot cannot revoke it", async () => {
	const created = await requested(["gone.example.com"]);
	await certbotFails(api, "revoke failed");
	const deleted = await admin.delete(`${CERTS}/${created.id}`);
	assert.equal(deleted.status, 200, deleted.text);
	assert.equal(await row(created.id), undefined);
});

it("refuses to delete a certbot certificate a host uses: certbot is not called", async () => {
	const created = await requested(["used.example.com"]);
	const host = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["used.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.0.1",
		forward_port: 8080,
		certificate_id: created.id,
	});
	assert.equal(host.status, 201, host.text);
	await api.outside.clearCalls();
	const refused = await admin.delete(`${CERTS}/${created.id}`);
	assert.equal(refused.status, 400);
	assert.match(refused.body.error.message, /still in use/u);
	assert.deepEqual(await certbotCalls(), []);
	assert.ok(await row(created.id));
	assert.equal(await fileExists(api, `data/tls/certbot/live/npm-${created.id}/fullchain.pem`), true);
});

it("writes the certbot certificate path into the config of a host that uses it", async () => {
	const created = await requested(["conf.example.com"]);
	const host = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["conf.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.0.1",
		forward_port: 8080,
		certificate_id: created.id,
		ssl_forced: true,
	});
	assert.equal(host.status, 201, host.text);
	const config = await api.read(`data/nginx/proxy_host/${host.body.id}.conf`);
	assert.match(config, new RegExp(`ssl_certificate /data/tls/certbot/live/npm-${created.id}/fullchain\\.pem;`, "u"));
	assert.match(
		config,
		new RegExp(`ssl_certificate_key /data/tls/certbot/live/npm-${created.id}/privkey\\.pem;`, "u"),
	);
	assert.equal(config.includes(api.root), false);
});

it("downloads a certbot certificate: the zip holds fullchain.pem and privkey.pem from the live folder", async () => {
	const created = await requested(["zip.example.com"]);
	const { readZip } = await import("./support/certbot.js");
	const downloaded = await admin.get(`${CERTS}/${created.id}/download`);
	assert.equal(downloaded.status, 200);
	const files = readZip(downloaded.bytes);
	assert.deepEqual(Object.keys(files).sort(), ["fullchain.pem", "privkey.pem"]);
	assert.equal(files["privkey.pem"].toString(), await readFile(pair.key, "utf8"));
});

it("links another saved credential to a DNS certificate and rewrites its credentials file", async () => {
	const { certificate, credential: first } = await dnsRequested("first-token");
	const second = await credential("second-token");
	const file = `tmp/certbot-credentials/credentials-${certificate.id}`;
	assert.equal(await api.read(file), "dns_cloudflare_api_token = first-token\n");
	const linked = await admin.put(`${CERTS}/${certificate.id}/dns-credential`, {
		npmpro_dns_credential_id: second.id,
	});
	assert.equal(linked.status, 200, linked.text);
	assert.equal(linked.body.npmpro_dns_credential_id, second.id);
	assert.equal((await row(certificate.id)).npmpro_dns_credential_id, second.id);
	assert.equal(await api.read(file), "dns_cloudflare_api_token = second-token\n");
	assert.equal(linked.text.includes("second-token"), false);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "certificate", object_id: certificate.id, action: "updated" })
		.first();
	assert.ok(audit);
	// the first credential is free again, the second one is in use
	assert.equal((await admin.delete(`/nginx/dns-credentials/${first.id}`)).status, 200);
	const used = await admin.delete(`/nginx/dns-credentials/${second.id}`);
	assert.equal(used.status, 400);
	assert.match(used.body.error.message, /still used by 1 certificate/u);
});

it("refuses to link a credential that is wrong: 400 or 404 and the link stays", async () => {
	const { certificate, credential: first } = await dnsRequested("keep-token");
	const ovh = await admin.post("/nginx/dns-credentials", {
		name: "Digital ocean",
		provider: "digitalocean",
		fields: [{ key: "dns_digitalocean_token", value: "do-token" }],
	});
	const http = await requested(["http.example.com"]);
	const url = (id) => `${CERTS}/${id}/dns-credential`;
	const wrongProvider = await admin.put(url(certificate.id), { npmpro_dns_credential_id: ovh.body.id });
	assert.equal(wrongProvider.status, 400);
	assert.match(wrongProvider.body.error.message, /belongs to another DNS provider/u);
	const notDns = await admin.put(url(http.id), { npmpro_dns_credential_id: first.id });
	assert.equal(notDns.status, 400);
	assert.match(notDns.body.error.message, /Only DNS challenge certificates/u);
	assert.equal((await admin.put(url(certificate.id), { npmpro_dns_credential_id: 9999 })).status, 404);
	assert.equal((await admin.put(url(9999), { npmpro_dns_credential_id: first.id })).status, 404);
	for (const body of [{}, { npmpro_dns_credential_id: 0 }, { npmpro_dns_credential_id: 1, more: 1 }]) {
		assert.equal((await admin.put(url(certificate.id), body)).status, 400, JSON.stringify(body));
	}
	assert.equal((await row(certificate.id)).npmpro_dns_credential_id, first.id);
	assert.equal(
		await api.read(`tmp/certbot-credentials/credentials-${certificate.id}`),
		"dns_cloudflare_api_token = keep-token\n",
	);
});

it("refuses to create or link without the permission, or another user's credential: no certbot call", async () => {
	const viewer = await api.limited({ visibility: "all", certificates: "view" });
	const cred = await credential("perm-token");
	const rows = await countRows(api, "certificate");
	const body = { provider: "letsencrypt", domain_names: ["perm.example.com"] };
	assert.equal((await viewer.post(CERTS, body)).status, 403);
	assert.equal(
		(
			await viewer.post(CERTS, {
				...body,
				npmpro_dns_challenge: true,
				npmpro_dns_provider: "cloudflare",
				npmpro_dns_credential_id: cred.id,
			})
		).status,
		403,
	);
	assert.equal((await api.client().post(CERTS, body)).status, 401);
	assert.equal(await countRows(api, "certificate"), rows);
	assert.deepEqual(await certbotCalls(), []);
	assert.deepEqual(await pipCalls(), []);
});

it("the HTTP challenge test needs certificates:manage (it writes into the public ACME folder)", async () => {
	const viewer = await api.limited({
		visibility: "all",
		certificates: "view",
		proxy_hosts: "hidden",
		redirection_hosts: "hidden",
		dead_hosts: "hidden",
		streams: "hidden",
		access_lists: "hidden",
	});
	const answer = await viewer.post("/nginx/certificates/test-http", { domains: ["view.example.com"] });
	assert.equal(answer.status, 403, answer.text);
});

const SECOND = "https://second.lan/dir";
const SECOND_ACCOUNT = "c".repeat(32);
const setUpSecond = async () => {
	const model = (await import("../models/acme_account.js")).default;
	await model.query().delete();
	await seedAccount(api, SECOND, SECOND_ACCOUNT);
	return await model.query().insertAndFetch({ server: SECOND, account_id: SECOND_ACCOUNT, state: "registered" });
};

it("requests a certificate from a set-up second CA: its server and account, none of the instance options, the row keeps it", async () => {
	await setUpSecond();
	const created = await requested(["a.example.com"], { npmpro_acme_server: "https://Second.LAN/dir" });
	assert.deepEqual(await certbotCalls(), [
		`certbot --config ${INI} certonly --server ${SECOND} --account ID --cert-name npm-${created.id} --domains a.example.com --no-reuse-key --authenticator webroot`,
	]);
	assert.equal(created.npmpro_acme_server, SECOND);
	assert.equal((await row(created.id)).npmpro_acme_server, SECOND);
});

it("a request without a CA stores the instance CA", async () => {
	const created = await requested(["a.example.com"]);
	assert.equal((await row(created.id)).npmpro_acme_server, ACME);
	const again = await requested(["a.example.com"], { npmpro_acme_server: "https://ACME.test/directory" });
	assert.equal((await row(again.id)).npmpro_acme_server, ACME);
});

it("a CA outside the list is refused before any certbot call, for an administrator and a manager", async () => {
	await setUpSecond();
	const manager = await api.limited({
		visibility: "all",
		certificates: "manage",
		proxy_hosts: "hidden",
		redirection_hosts: "hidden",
		dead_hosts: "hidden",
		streams: "hidden",
		access_lists: "hidden",
	});
	const rows = await countRows(api, "certificate");
	for (const session of [admin, manager]) {
		const refused = await session.post(CERTS, {
			provider: "letsencrypt",
			domain_names: ["a.example.com"],
			npmpro_acme_server: "https://typo.lan/dir",
		});
		assert.equal(refused.status, 400, refused.text);
		assert.equal(refused.body.error.message_i18n, "error.acme-ca-not-allowed");
	}
	assert.equal(await countRows(api, "certificate"), rows);
	assert.deepEqual(await certbotCalls(), []);
});

it("a custom certificate drops the CA field", async () => {
	const { default: certificateModel } = await import("../models/certificate.js");
	const made = await admin.post(CERTS, { provider: "other", nice_name: "custom", npmpro_acme_server: SECOND });
	assert.equal(made.status, 201, made.text);
	assert.equal((await certificateModel.query().findById(made.body.id)).npmpro_acme_server, null);
});

it("a delete of a CA's account waits for a running request at that CA and then refuses (the row is stored first)", async () => {
	const account = await setUpSecond();
	const { withAccountLock } = await import("../internal/acme-account.js");
	let release;
	const held = withAccountLock(
		SECOND,
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	const create = admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["a.example.com"],
		npmpro_acme_server: SECOND,
	});
	for (
		let tries = 0;
		tries < 100 && !(await api.db("certificate").where({ npmpro_acme_server: SECOND }).first());
		tries++
	) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.ok(
		await api.db("certificate").where({ npmpro_acme_server: SECOND }).first(),
		"the row is stored before certonly",
	);
	const removal = admin.delete(`/settings/acme/accounts/${account.id}`);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.deepEqual(await certbotCalls(), [], "nothing ran while the CA's lock is held");
	release();
	await held;
	const [created, removed] = await Promise.all([create, removal]);
	assert.equal(created.status, 201, created.text);
	assert.equal(removed.status, 400, removed.text);
	assert.equal(removed.body.error.message_i18n, "error.acme-in-use");
	assert.ok(await (await import("../models/acme_account.js")).default.query().findById(account.id));
});

it("requests a DNS-challenge certificate from a second CA with its server, account and the DNS flags", async () => {
	await setUpSecond();
	const { certificate } = await dnsRequested("cf-token-SECRET", { npmpro_acme_server: SECOND });
	const calls = await certbotCalls();
	assert.equal(calls.length, 1);
	assert.ok(
		calls[0].includes(`certonly --server ${SECOND} --account ID --cert-name npm-${certificate.id}`),
		calls[0],
	);
	assert.ok(calls[0].includes("--authenticator"), calls[0]);
	assert.ok(calls[0].includes("credentials-"), calls[0]);
	assert.equal((await row(certificate.id)).npmpro_acme_server, SECOND);
});

it("a failed certonly at a second CA leaves no certificate row", async () => {
	await setUpSecond();
	const rows = await countRows(api, "certificate");
	await certbotFails(api, "Challenge failed for domain fail.example.com");
	const failed = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["fail.example.com"],
		npmpro_acme_server: SECOND,
	});
	assert.equal(failed.status, 500, failed.text);
	assert.equal(await countRows(api, "certificate"), rows);
});

it("a CA whose account is removed after the create's check is refused inside the lock, not registered again", async () => {
	const account = await setUpSecond();
	await api.db("certificate").where({ npmpro_acme_server: SECOND }).delete();
	const { withAccountLock } = await import("../internal/acme-account.js");
	const model = (await import("../models/acme_account.js")).default;
	let release;
	const held = withAccountLock(
		SECOND,
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	const create = admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["a.example.com"],
		npmpro_acme_server: SECOND,
	});
	for (
		let tries = 0;
		tries < 100 && !(await api.db("certificate").where({ npmpro_acme_server: SECOND }).first());
		tries++
	) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	// the row of the CA's account goes while the request waits for the lock
	await model.query().deleteById(account.id);
	release();
	await held;
	const refused = await create;
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.acme-ca-not-allowed");
	assert.equal(await model.query().where("server", SECOND).first(), undefined);
	assert.deepEqual(await certbotCalls(), []);
	assert.equal(await api.db("certificate").where({ npmpro_acme_server: SECOND }).first(), undefined);
});
