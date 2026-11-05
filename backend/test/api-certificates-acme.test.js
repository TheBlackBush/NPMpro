import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { certbotEnvironment, certbotFails, certbotSucceeds, makeCertificate } from "./support/certbot.js";
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

const certbotCalls = async () =>
	(await api.outside.calls())
		.filter((call) => call.startsWith("certbot "))
		.map((call) => call.replaceAll(api.root, ""));
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
	api = await startApi({ env: { ACME_SERVER: ACME, ...SECRETS } });
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
		`certbot --config ${INI} certonly --server ${ACME} --cert-name npm-${created.id} --domains a.example.com,www.a.example.com --no-reuse-key --authenticator webroot`,
	]);
	assert.equal(created.provider, "letsencrypt");
	assert.equal(created.nice_name, "a.example.com, www.a.example.com");
	assert.deepEqual(created.domain_names, ["a.example.com", "www.a.example.com"]);
	assert.equal(created.npmpro_dns_challenge, false);
	// the expiry comes from the certificate certbot wrote
	assert.ok(Date.parse(created.expires_on) > Date.now() + 25 * 86400000);
	const stored = await row(created.id);
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
		`certbot --config ${INI} certonly --server ${ACME} --cert-name npm-${created.id} --domains xn--mnchen-3ya.example.com --ip-address 192.0.2.7 --ip-address 2001:db8::1 --reuse-key --authenticator webroot`,
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

it("refuses a certbot certificate that has no files after a run that did nothing, and removes the row", async () => {
	await api.outside.hookCommand("certbot", "#!/bin/sh\nexit 0\n");
	const rows = await countRows(api, "certificate");
	const failed = await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["empty.example.com"] });
	assert.equal(failed.status >= 400, true);
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
		`certbot --config ${INI} certonly --server ${ACME} --cert-name npm-${certificate.id} --domains *.dns.example.com --reuse-key --authenticator ${plugin.full_plugin_name} --${plugin.full_plugin_name}-credentials /tmp/certbot-credentials/credentials-${certificate.id} --${plugin.full_plugin_name}-propagation-seconds 30`,
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
	await api.db("certificate").where({ id: created.id }).update({ expires_on: "2020-01-01 00:00:00" });
	await api.outside.clearCalls();
	const renewal = path.join(api.root, `data/tls/certbot/renewal/npm-${created.id}.conf`);
	const { writeFile } = await import("node:fs/promises");
	await writeFile(renewal, "server = https://old-acme.test/directory\n");
	const before = reloads(api);
	const done = await admin.post(`${CERTS}/${created.id}/renew`, {});
	assert.equal(done.status, 200, done.text);
	const calls = await certbotCalls();
	assert.equal(calls.length, 2);
	assert.equal(
		calls[0],
		`certbot --config ${INI} renew --server ${ACME} --cert-name npm-${created.id} --new-key --force-renewal`,
	);
	assert.equal(
		calls[1],
		`certbot --config ${INI} revoke --server https://old-acme.test/directory --cert-path /data/tls/certbot/live/npm-${created.id}/cert.pem --reason superseded --no-delete-after-revoke`,
	);
	assert.ok(reloads(api) > before);
	assert.ok(Date.parse(done.body.expires_on) > Date.now() + 25 * 86400000);
	assert.ok(Date.parse((await row(created.id)).expires_on) > Date.now());
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
	assert.equal(failed.status >= 400, true);
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
		`certbot --config ${INI} revoke --cert-name npm-${certificate.id} --reason unspecified --no-delete-after-revoke`,
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
