import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";
import { reloads } from "./support/hosts.js";

const CERTS = "/nginx/certificates";
const ACME = "https://acme.test/directory";
const INI = "/run/npmpro/certbot.ini";
const ACCOUNT = /--account [0-9a-f]{32}/gu;
const WILDCARD_DOMAINS = /--domains \*\.dns\.example\.com,dns\.example\.com /u;
const DNS_AUTHENTICATOR = /--authenticator \S*cloudflare/u;
const DNS_CREDENTIALS = /-credentials \/tmp\/certbot-credentials\/credentials-\d+/u;
const FAILED = /^The CA did not issue the certificate: Challenge failed/u;

let api;
let admin;
let pair;

const calls = async () =>
	(await normalizedCalls(api))
		.filter((line) => !line.includes(" register "))
		.map((line) => line.replace(ACCOUNT, "--account ID"));
const row = (id) => api.db("certificate").where({ id }).first();
const confOf = (id) => path.join(api.root, `data/tls/certbot/renewal/npm-${id}.conf`);
const issued = async (domains = ["a.example.com"]) => {
	const made = await admin.post(CERTS, { provider: "letsencrypt", domain_names: domains });
	if (made.status !== 201) throw new Error(made.text);
	return made.body;
};
const put = (id, domainNames) => admin.put(`${CERTS}/${id}/domains`, { domain_names: domainNames });

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME, NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("acme.test", "192.0.2.40");
	acmeDirectory(api, ACME);
	admin = await api.admin();
	pair = await makeCertificate(path.join(api.root, "fake"), "a.example.com");
});
beforeEach(async () => {
	await api.outside.clearCalls();
	api.outside.passCommand("pip");
	await certbotSucceeds(api, pair);
	await rm(`${api.root}/fake/certonly.fail`, { force: true });
});
after(() => api?.stop());

it("changes the names: its CA and account, the same lineage, the row, a reload and an audit entry", async () => {
	const created = await issued();
	await api.outside.clearCalls();
	const reloadsBefore = reloads(api);

	const done = await put(created.id, ["b.example.com", "c.example.com"]);
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.domain_names, ["b.example.com", "c.example.com"]);
	assert.equal(done.body.nice_name, "b.example.com, c.example.com");
	assert.deepEqual(await calls(), [
		`certbot --config ${INI} certonly --server ${ACME} --account ID --cert-name npm-${created.id} --domains b.example.com,c.example.com --no-reuse-key --authenticator webroot`,
	]);
	const stored = await row(created.id);
	assert.deepEqual(JSON.parse(stored.domain_names), ["b.example.com", "c.example.com"]);
	assert.equal(stored.nice_name, "b.example.com, c.example.com");
	assert.ok(reloads(api) > reloadsBefore);

	const audit = await api
		.db("audit_log")
		.where({ object_type: "certificate", object_id: created.id, action: "domains-changed" })
		.first();
	assert.deepEqual(JSON.parse(audit.meta), { old: ["a.example.com"], new: ["b.example.com", "c.example.com"] });
});

it("an unchanged list (another order, another case) runs nothing and answers the certificate", async () => {
	const created = await issued(["a.example.com", "b.example.com"]);
	await api.outside.clearCalls();
	const same = await put(created.id, ["B.example.com", "a.example.com"]);
	assert.equal(same.status, 200, same.text);
	assert.deepEqual(same.body.domain_names, ["a.example.com", "b.example.com"]);
	assert.deepEqual(await calls(), []);
	const audits = await api.db("audit_log").where({ object_id: created.id, action: "domains-changed" });
	assert.equal(audits.length, 0);
});

it("a failed run changes nothing: the row, the conf, the files, no reload", async () => {
	const created = await issued();
	const stored = await row(created.id);
	const conf = await readFile(confOf(created.id), "utf8");
	const live = path.join(api.root, `data/tls/certbot/live/npm-${created.id}/fullchain.pem`);
	const files = await readFile(live, "utf8");
	await writeFile(`${api.root}/fake/certonly.fail`, "Challenge failed for b.example.com");
	const reloadsBefore = reloads(api);

	const failed = await put(created.id, ["b.example.com"]);
	assert.equal(failed.status, 400, failed.text);
	assert.equal(failed.body.error.message_i18n, "error.acme-domains-failed");
	assert.equal(failed.body.error.message_values.message, "Challenge failed for b.example.com");
	assert.match(failed.body.error.message, FAILED);
	assert.deepEqual(await row(created.id), stored);
	assert.equal(await readFile(confOf(created.id), "utf8"), conf);
	assert.equal(await readFile(live, "utf8"), files);
	assert.equal(reloads(api), reloadsBefore);
	const audits = await api.db("audit_log").where({ object_id: created.id, action: "domains-changed" });
	assert.equal(audits.length, 0);
});

it("refuses a custom certificate", async () => {
	const made = await admin.post(CERTS, { provider: "other", nice_name: "custom" });
	assert.equal(made.status, 201, made.text);
	const refused = await put(made.body.id, ["a.example.com"]);
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.acme-domains-acme-only");
});

it("refuses a wildcard on the HTTP challenge before certbot, with the create rule's message", async () => {
	const created = await issued();
	await api.outside.clearCalls();
	const createRefused = await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["*.example.com"] });
	const refused = await put(created.id, ["*.example.com"]);
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message, createRefused.body.error.message);
	assert.deepEqual(await calls(), []);
	assert.deepEqual(JSON.parse((await row(created.id)).domain_names), ["a.example.com"]);
});

it("refuses a bad body: no names, a duplicate, an unknown field", async () => {
	const created = await issued();
	await api.outside.clearCalls();
	for (const body of [
		{},
		{ domain_names: [] },
		{ domain_names: ["a.example.com", "a.example.com"] },
		{ domain_names: ["not a domain"] },
	]) {
		const refused = await admin.put(`${CERTS}/${created.id}/domains`, body);
		assert.equal(refused.status, 400, JSON.stringify(body));
	}
	const extra = await admin.put(`${CERTS}/${created.id}/domains`, { domain_names: ["b.example.com"], x: 1 });
	assert.equal(extra.status, 400, extra.text);
	assert.deepEqual(await calls(), []);
});

it("a DNS certificate takes a wildcard with its plugin flags and refuses an IP", async () => {
	const cred = await admin.post("/nginx/dns-credentials", {
		name: "Cloudflare domains",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "cf-token-SECRET" }],
	});
	assert.equal(cred.status, 201, cred.text);
	const made = await admin.post(CERTS, {
		provider: "letsencrypt",
		domain_names: ["dns.example.com"],
		npmpro_dns_challenge: true,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: cred.body.id,
	});
	assert.equal(made.status, 201, made.text);
	await api.outside.clearCalls();

	const ip = await put(made.body.id, ["192.0.2.1"]);
	assert.equal(ip.status, 400, ip.text);
	assert.deepEqual(await calls(), []);

	const done = await put(made.body.id, ["*.dns.example.com", "dns.example.com"]);
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.domain_names, ["*.dns.example.com", "dns.example.com"]);
	const [certonly] = await calls();
	assert.match(certonly, WILDCARD_DOMAINS);
	assert.match(certonly, DNS_AUTHENTICATOR);
	assert.match(certonly, DNS_CREDENTIALS);
});

it("the certificate list with the hosts expanded gives the domain names the window warns about", async () => {
	const created = await issued();
	const host = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["a.example.com", "other.example.org"],
		forward_scheme: "http",
		forward_host: "10.0.0.1",
		forward_port: 8080,
		certificate_id: created.id,
	});
	assert.equal(host.status, 201, host.text);
	const dead = await admin.post("/nginx/dead-hosts", {
		domain_names: ["gone.example.com"],
		certificate_id: created.id,
	});
	assert.equal(dead.status, 201, dead.text);
	// the single read ignores expand: the list (what the certificate window reads) carries the hosts
	const listed = await admin.get(`${CERTS}?expand=proxy_hosts,redirection_hosts,dead_hosts`);
	assert.equal(listed.status, 200, listed.text);
	const expanded = { body: listed.body.find((certificate) => certificate.id === created.id) };
	assert.deepEqual(expanded.body.proxy_hosts[0].domain_names, ["a.example.com", "other.example.org"]);
	assert.deepEqual(expanded.body.redirection_hosts, []);
	assert.deepEqual(expanded.body.dead_hosts[0].domain_names, ["gone.example.com"]);
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
	const refused = await viewer.put(`${CERTS}/${created.id}/domains`, { domain_names: ["b.example.com"] });
	assert.equal(refused.status, 403, refused.text);
});
