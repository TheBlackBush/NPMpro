import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { makeCertificate, makeExpiredCertificate, readZip } from "./support/certbot.js";
import { addCertificate, countRows, fileExists, reloads } from "./support/hosts.js";

const CERTS = "/nginx/certificates";
const CHALLENGE = "data/public/acme-challenge/.well-known/acme-challenge/test-challenge";

let api;
let admin;
let pair;
let other;
let expired;

const upload = (session, id, files) => {
	const form = new FormData();
	for (const [name, content] of Object.entries(files)) form.append(name, new Blob([content]), `${name}.pem`);
	return session.send("POST", `${CERTS}/${id}/upload`, { form });
};
const validate = (session, files) => {
	const form = new FormData();
	for (const [name, content] of Object.entries(files)) form.append(name, new Blob([content]), `${name}.pem`);
	return session.send("POST", `${CERTS}/validate`, { form });
};
const read = (file) => readFile(file, "utf8");
const make = async (provider = "other", nice_name = `${provider} cert`) => {
	const created = await admin.post(CERTS, { provider, nice_name });
	assert.equal(created.status, 201, created.text);
	return created.body;
};
const uploaded = async () => {
	const row = await make();
	const done = await upload(admin, row.id, {
		certificate: await read(pair.certificate),
		certificate_key: await read(pair.key),
	});
	assert.equal(done.status, 200, done.text);
	return row.id;
};

before(async () => {
	api = await startApi({ env: { ACME_SERVER: "https://acme.test/directory" } });
	admin = await api.admin();
	const dir = path.join(api.root, "fake");
	pair = await makeCertificate(dir, "a.example.com");
	other = await makeCertificate(dir, "b.example.com");
	expired = await makeExpiredCertificate(dir, "old.example.com");
});
after(() => api?.stop());

it("creates a custom certificate and an mTLS certificate: 201, a row, an audit entry, no files before the upload", async () => {
	for (const provider of ["other", "mtls"]) {
		const created = await admin.post(CERTS, { provider, nice_name: `My ${provider}` });
		assert.equal(created.status, 201, created.text);
		assert.equal(created.body.provider, provider);
		assert.equal(created.body.nice_name, `My ${provider}`);
		assert.deepEqual(created.body.domain_names, []);
		assert.equal(created.body.owner_user_id, 1);
		const row = await api.db("certificate").where({ id: created.body.id }).first();
		assert.equal(row.provider, provider);
		assert.equal(row.nice_name, `My ${provider}`);
		assert.equal(await fileExists(api, `data/tls/custom/npm-${created.body.id}`), false);
		assert.equal(await fileExists(api, `data/tls/mtls/npm-${created.body.id}.pem`), false);
		const audit = await api
			.db("audit_log")
			.where({ object_type: "certificate", object_id: created.body.id })
			.first();
		assert.equal(audit.action, "created");
	}
});

it("refuses a certificate that breaks the schema: 400 and no row", async () => {
	const rows = await countRows(api, "certificate");
	const bodies = [
		{},
		{ provider: "other" },
		{ provider: "other", nice_name: "" },
		{ provider: "mtls" },
		{ provider: "nobody", nice_name: "x" },
		{ provider: "other", nice_name: "x", domain_names: ["a.example.com"] },
		{ provider: "other", nice_name: "x", unknown: true },
		{ provider: "letsencrypt" },
		{ provider: "letsencrypt", domain_names: [] },
		{ provider: "letsencrypt", domain_names: ["*.example.com"] },
		{ provider: "letsencrypt", domain_names: ["not a domain"] },
		{ provider: "letsencrypt", domain_names: ["a.example.com", "a.example.com"] },
		{ provider: "letsencrypt", domain_names: ["a.example.com"], npmpro_dns_challenge: true },
		{
			provider: "letsencrypt",
			domain_names: ["192.0.2.1"],
			npmpro_dns_challenge: true,
			npmpro_dns_provider: "cloudflare",
			npmpro_dns_credential_id: 1,
		},
	];
	for (const body of bodies) {
		const refused = await admin.post(CERTS, body);
		assert.equal(refused.status, 400, JSON.stringify(body));
		assert.ok(refused.body.error.message, JSON.stringify(body));
	}
	assert.equal(await countRows(api, "certificate"), rows);
});

it("uploads a custom certificate: files on disk, the key private, the row filled from the certificate, nginx reloaded", async () => {
	const row = await make("other", "Upload me");
	const before = reloads(api);
	const done = await upload(admin, row.id, {
		certificate: await read(pair.certificate),
		certificate_key: await read(pair.key),
	});
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.domain_names, ["a.example.com"]);
	assert.equal(done.body.nice_name, "Upload me");
	assert.ok(Date.parse(done.body.expires_on) > Date.now() + 25 * 86400000);
	assert.equal(done.text.includes("PRIVATE KEY"), false);
	const stored = await api.db("certificate").where({ id: row.id }).first();
	assert.deepEqual(JSON.parse(stored.domain_names), ["a.example.com"]);
	const dir = path.join(api.root, `data/tls/custom/npm-${row.id}`);
	assert.equal(await read(path.join(dir, "fullchain.pem")), await read(pair.certificate));
	assert.equal(await read(path.join(dir, "cert.pem")), await read(pair.certificate));
	assert.equal(await read(path.join(dir, "privkey.pem")), await read(pair.key));
	assert.equal((await stat(path.join(dir, "privkey.pem"))).mode & 0o077, 0);
	assert.ok(reloads(api) > before);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "certificate", object_id: row.id, action: "updated" })
		.first();
	assert.ok(audit);
	assert.equal(audit.meta.includes("PRIVATE KEY"), false);
});

it("replaces the files of a custom certificate by a second upload", async () => {
	const id = await uploaded();
	const again = await upload(admin, id, {
		certificate: await read(other.certificate),
		certificate_key: await read(other.key),
	});
	assert.equal(again.status, 200, again.text);
	assert.deepEqual(again.body.domain_names, ["b.example.com"]);
	const dir = path.join(api.root, `data/tls/custom/npm-${id}`);
	assert.equal(await read(path.join(dir, "fullchain.pem")), await read(other.certificate));
	assert.equal(await read(path.join(dir, "privkey.pem")), await read(other.key));
});

it("uploads an mTLS certificate without a key: only the CA file is written", async () => {
	const row = await make("mtls", "Client CA");
	const done = await upload(admin, row.id, { certificate: await read(pair.certificate) });
	assert.equal(done.status, 200, done.text);
	assert.equal(await api.read(`data/tls/mtls/npm-${row.id}.pem`), await read(pair.certificate));
	assert.equal(await fileExists(api, `data/tls/custom/npm-${row.id}`), false);
	const noKey = await upload(admin, (await make("mtls", "CA two")).id, {
		certificate: await read(pair.certificate),
		certificate_key: await read(pair.key),
	});
	assert.equal(noKey.status, 200, noKey.text);
});

it("refuses an upload that is wrong: 400 or 404, nothing written, no reload, the row unchanged", async () => {
	const row = await make("other", "Refusals");
	const good = await read(pair.certificate);
	const goodKey = await read(pair.key);
	const mismatch = await read(other.key);
	const cases = [
		["key and certificate that do not match", { certificate: good, certificate_key: mismatch }, /does not match/u],
		[
			"garbage as certificate",
			{ certificate: "not a certificate", certificate_key: goodKey },
			/Certificate is not valid/u,
		],
		["garbage as key", { certificate: good, certificate_key: "not a key" }, /Certificate Key is not valid/u],
		[
			"an expired certificate",
			{ certificate: await read(expired.certificate), certificate_key: await read(expired.key) },
			/expired/u,
		],
		["no key", { certificate: good }, /Key file was not provided/u],
		["no certificate", { certificate_key: goodKey }, /certificate file is required/u],
	];
	const before = reloads(api);
	for (const [label, files, message] of cases) {
		const refused = await upload(admin, row.id, files);
		assert.equal(refused.status, 400, label);
		assert.match(refused.body.error.message, message, label);
	}
	assert.equal(reloads(api), before);
	assert.equal(await fileExists(api, `data/tls/custom/npm-${row.id}`), false);
	const stored = await api.db("certificate").where({ id: row.id }).first();
	assert.equal(stored.domain_names, "[]");
	const missing = await upload(admin, 9999, { certificate: good, certificate_key: goodKey });
	assert.equal(missing.status, 404);
});

it("refuses to upload to a certbot certificate", async () => {
	const [id] = await api.db("certificate").insert({
		owner_user_id: 1,
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		provider: "letsencrypt",
		nice_name: "le",
		domain_names: JSON.stringify(["le.example.com"]),
		expires_on: "2099-01-01 00:00:00",
		meta: "{}",
	});
	const refused = await upload(admin, id, {
		certificate: await read(pair.certificate),
		certificate_key: await read(pair.key),
	});
	assert.equal(refused.status, 400);
	assert.match(refused.body.error.message, /Cannot upload certificates for this type of provider/u);
	assert.equal(await fileExists(api, `data/tls/custom/npm-${id}`), false);
});

it("validates a key and certificate without storing anything", async () => {
	const rows = await countRows(api, "certificate");
	const both = await validate(admin, {
		certificate: await read(pair.certificate),
		certificate_key: await read(pair.key),
	});
	assert.equal(both.status, 200, both.text);
	assert.deepEqual(both.body.certificate.cn, ["a.example.com"]);
	assert.match(both.body.certificate.issuer, /CN=a\.example\.com/u);
	assert.ok(both.body.certificate.dates.to > both.body.certificate.dates.from);
	assert.equal(both.body.certificate_key, true);
	assert.equal(both.text.includes("PRIVATE KEY"), false);
	const alone = await validate(admin, { certificate: await read(pair.certificate) });
	assert.equal(alone.status, 200);
	assert.equal(alone.body.certificate_key, undefined);
	assert.equal(await countRows(api, "certificate"), rows);
});

it("refuses to validate a mismatch, garbage, an expired certificate or no certificate: 400", async () => {
	const cases = [
		[{ certificate: await read(pair.certificate), certificate_key: await read(other.key) }, /does not match/u],
		[{ certificate: "garbage" }, /Certificate is not valid/u],
		[{ certificate: await read(pair.certificate), certificate_key: "garbage" }, /Certificate Key is not valid/u],
		[{ certificate: await read(expired.certificate) }, /expired/u],
		[{ certificate_key: await read(pair.key) }, /certificate file is required/u],
		[{}, /certificate file is required/u],
	];
	for (const [files, message] of cases) {
		const refused = await validate(admin, files);
		assert.equal(refused.status, 400, JSON.stringify(Object.keys(files)));
		assert.match(refused.body.error.message, message);
	}
});

it("lists, searches and reads certificates, with the hosts that use one when expanded", async () => {
	const id = await uploaded();
	const list = await admin.get(`${CERTS}?query=${encodeURIComponent("other cert")}`);
	assert.equal(list.status, 200);
	assert.ok(list.body.length >= 1);
	assert.ok(list.body.every((row) => row.nice_name.includes("other cert")));
	const none = await admin.get(`${CERTS}?query=nothing-has-this-name`);
	assert.deepEqual(none.body, []);
	const one = await admin.get(`${CERTS}/${id}`);
	assert.equal(one.status, 200);
	assert.equal(one.body.id, id);
	const host = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["use.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.0.1",
		forward_port: 8080,
		certificate_id: id,
	});
	assert.equal(host.status, 201, host.text);
	const expanded = await admin.get(`${CERTS}/${id}?expand=owner`);
	assert.equal(expanded.status, 200);
	assert.equal(
		(await admin.get(`${CERTS}?expand=proxy_hosts`)).body.find((row) => row.id === id).proxy_hosts[0].id,
		host.body.id,
	);
	assert.equal((await admin.get(`${CERTS}?expand=nothing`)).status, 400);
	assert.equal((await admin.get(`${CERTS}/9999`)).status, 404);
});

it("downloads a custom certificate as a zip with its certificate and key, and writes an audit entry", async () => {
	const id = await uploaded();
	const downloaded = await admin.get(`${CERTS}/${id}/download`);
	assert.equal(downloaded.status, 200);
	assert.match(downloaded.headers.get("content-disposition"), /attachment; filename=npm-\d+-\d+\.zip/u);
	const files = readZip(downloaded.bytes);
	assert.deepEqual(Object.keys(files).sort(), ["fullchain.pem", "privkey.pem"]);
	assert.equal(files["fullchain.pem"].toString(), await read(pair.certificate));
	assert.equal(files["privkey.pem"].toString(), await read(pair.key));
	const audit = await api
		.db("audit_log")
		.where({ object_type: "certificate", object_id: id, action: "downloaded" })
		.first();
	assert.ok(audit);
	assert.equal(audit.meta.includes("PRIVATE KEY"), false);
});

it("downloads an mTLS certificate: the zip holds the CA file only", async () => {
	const row = await make("mtls", "Zip CA");
	await upload(admin, row.id, { certificate: await read(pair.certificate) });
	const downloaded = await admin.get(`${CERTS}/${row.id}/download`);
	assert.equal(downloaded.status, 200);
	assert.deepEqual(Object.keys(readZip(downloaded.bytes)), [`npm-${row.id}.pem`]);
});

it("refuses a download when the files are missing, the id is unknown or the user may not manage: 404 and 403", async () => {
	const row = await make("other", "No files");
	const missing = await admin.get(`${CERTS}/${row.id}/download`);
	assert.equal(missing.status, 404);
	assert.equal((await admin.get(`${CERTS}/9999/download`)).status, 404);
	const viewer = await api.limited({ visibility: "all", certificates: "view" });
	assert.equal((await viewer.get(`${CERTS}/${row.id}/download`)).status, 403);
	assert.equal((await api.client().get(`${CERTS}/${row.id}/download`)).status, 401);
	const audit = await api.db("audit_log").where({ object_id: row.id, action: "downloaded" });
	assert.equal(audit.length, 0);
});

it("limits downloads to 10 in 10 minutes per client: the 11th answers 429", async () => {
	const id = await uploaded();
	const session = await api.limited({ visibility: "all", certificates: "manage" });
	for (let n = 0; n < 10; n += 1)
		assert.equal((await session.get(`${CERTS}/${id}/download`)).status, 200, `download ${n + 1}`);
	const limited = await session.get(`${CERTS}/${id}/download`);
	assert.equal(limited.status, 429);
	assert.match(limited.body.error.message, /Too many requests/u);
	assert.equal((await admin.get(`${CERTS}/${id}/download`)).status, 200);
});

it("deletes a custom certificate: the row, its files and its audit entry", async () => {
	const id = await uploaded();
	const dir = `data/tls/custom/npm-${id}`;
	assert.equal(await fileExists(api, dir), true);
	const deleted = await admin.delete(`${CERTS}/${id}`);
	assert.equal(deleted.status, 200, deleted.text);
	assert.equal(deleted.body.id, id);
	assert.equal(await api.db("certificate").where({ id }).first(), undefined);
	assert.equal(await fileExists(api, dir), false);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "certificate", object_id: id, action: "deleted" })
		.first();
	assert.ok(audit);
	assert.equal((await admin.get(`${CERTS}/${id}`)).status, 404);
	assert.equal((await admin.delete(`${CERTS}/${id}`)).status, 404);
});

it("deletes an mTLS certificate with its CA file", async () => {
	const row = await make("mtls", "Delete CA");
	await upload(admin, row.id, { certificate: await read(pair.certificate) });
	assert.equal(await fileExists(api, `data/tls/mtls/npm-${row.id}.pem`), true);
	assert.equal((await admin.delete(`${CERTS}/${row.id}`)).status, 200);
	assert.equal(await fileExists(api, `data/tls/mtls/npm-${row.id}.pem`), false);
});

it("refuses to delete a certificate a host uses, as server certificate or as mTLS CA; the files stay", async () => {
	const id = await uploaded();
	const ca = await make("mtls", "Used CA");
	await upload(admin, ca.id, { certificate: await read(pair.certificate) });
	const host = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["inuse.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.0.1",
		forward_port: 8080,
		certificate_id: id,
		npmpro_mtls_certificate_id: ca.id,
	});
	assert.equal(host.status, 201, host.text);
	for (const [target, dir] of [
		[id, `data/tls/custom/npm-${id}/fullchain.pem`],
		[ca.id, `data/tls/mtls/npm-${ca.id}.pem`],
	]) {
		const refused = await admin.delete(`${CERTS}/${target}`);
		assert.equal(refused.status, 400);
		assert.match(refused.body.error.message, /still in use/u);
		assert.ok(await api.db("certificate").where({ id: target }).first());
		assert.equal(await fileExists(api, dir), true);
	}
	assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.body.id}`)).status, 200);
	assert.equal((await admin.delete(`${CERTS}/${id}`)).status, 200);
});

it("lists the DNS providers of certbot/dns-plugins.json sorted by name, with their fields", async () => {
	const plugins = JSON.parse(await readFile(new URL("../certbot/dns-plugins.json", import.meta.url), "utf8"));
	const list = await admin.get(`${CERTS}/dns-providers`);
	assert.equal(list.status, 200);
	assert.equal(list.body.length, Object.keys(plugins).length);
	assert.deepEqual(list.body.map((entry) => entry.id).sort(), Object.keys(plugins).sort());
	const names = list.body.map((entry) => entry.name);
	assert.deepEqual(
		names,
		[...names].sort((a, b) => a.localeCompare(b)),
	);
	const cloudflare = list.body.find((entry) => entry.id === "cloudflare");
	assert.equal(cloudflare.name, plugins.cloudflare.name);
	assert.equal(cloudflare.deprecated, false);
	assert.deepEqual(cloudflare.one_of, ["token", "global-key"]);
	assert.equal(cloudflare.fields.find((field) => field.key === "dns_cloudflare_api_token").type, "secret");
	const old = Object.entries(plugins).find(([, plugin]) => plugin.deprecated === true)[0];
	assert.equal(list.body.find((entry) => entry.id === old).deprecated, true);
	const plain = list.body.find((entry) => entry.fields === null);
	assert.ok(plain, "a provider without a field form");
	assert.equal((await api.client().get(`${CERTS}/dns-providers`)).status, 401);
});

const answer = (api_, body, code = 200) =>
	api_.outside.http
		.get("https://www.site24x7.com")
		.intercept({ path: "/tools/restapi-tester", method: "POST" })
		.reply(code, body);

it("tests the HTTP challenge for each domain through the outside tester and writes the challenge file", async () => {
	answer(api, { responsecode: 200, htmlresponse: "Success" });
	answer(api, { responsecode: 200, htmlresponse: "Other" });
	answer(api, { responsecode: 404 });
	answer(api, { responsecode: 0 });
	answer(api, { reason: "Host Unavailable" });
	answer(api, { error: { msg: "Invalid domain or IP" } });
	answer(api, { responsecode: 502 });
	const domains = [
		"ok.example.com",
		"wrong.example.com",
		"nf.example.com",
		"zero.example.com",
		"gone.example.com",
		"bad.example.com",
		"five.example.com",
	];
	const result = await admin.post(`${CERTS}/test-http`, { domains });
	assert.equal(result.status, 200, result.text);
	assert.deepEqual(
		result.body.map((entry) => entry.status),
		["ok", "wrong-data", "404", "no-host", "no-host", "other:Invalid domain or IP", "other:502"],
	);
	assert.deepEqual(
		result.body.map((entry) => entry.domain),
		domains,
	);
	assert.equal(await api.read(CHALLENGE), "Success");
});

it("reports an unreachable tester or an unreadable answer as failed", async () => {
	// no interceptor: the mock agent refuses the connection
	const unreachable = await admin.post(`${CERTS}/test-http`, { domains: ["down.example.com"] });
	assert.equal(unreachable.status, 200);
	assert.deepEqual(unreachable.body, [{ domain: "down.example.com", status: "failed" }]);
	api.outside.http
		.get("https://www.site24x7.com")
		.intercept({ path: "/tools/restapi-tester", method: "POST" })
		.reply(500, "<html>boom</html>");
	const broken = await admin.post(`${CERTS}/test-http`, { domains: ["down.example.com"] });
	assert.equal(broken.body[0].status, "failed");
});

it("sends the domain to the tester as the challenge CERTS", async () => {
	let sent = "";
	api.outside.http
		.get("https://www.site24x7.com")
		.intercept({ path: "/tools/restapi-tester", method: "POST" })
		.reply(200, (options) => {
			sent = String(options.body);
			return { responsecode: 200, htmlresponse: "Success" };
		});
	const result = await admin.post(`${CERTS}/test-http`, { domains: ["münchen.example.com"] });
	assert.equal(result.body[0].status, "ok");
	assert.match(sent, /url=http:\/\/xn--mnchen-3ya\.example\.com\/\.well-known\/acme-challenge\/test-challenge/u);
});

it("refuses a test without domains: 400", async () => {
	assert.equal((await admin.post(`${CERTS}/test-http`, {})).status, 400);
	assert.equal((await admin.post(`${CERTS}/test-http`, { domains: [] })).status, 400);
	assert.equal((await admin.post(`${CERTS}/test-http`, { domains: ["a.example.com"], more: 1 })).status, 400);
});

it("refuses renewing a custom certificate and an unknown one", async () => {
	const id = await uploaded();
	const refused = await admin.post(`${CERTS}/${id}/renew`, {});
	assert.equal(refused.status, 400);
	assert.match(refused.body.error.message, /Only Certbot certificates can be renewed/u);
	assert.equal((await admin.post(`${CERTS}/9999/renew`, {})).status, 404);
	assert.deepEqual(
		(await api.outside.calls()).filter((call) => call.startsWith("certbot")),
		[],
	);
});

it("answers 401 without a session on every certificate route", async () => {
	const none = api.client();
	const routes = [
		["get", CERTS],
		["post", CERTS, {}],
		["get", `${CERTS}/1`],
		["delete", `${CERTS}/1`],
		["post", `${CERTS}/test-http`, { domains: ["a.example.com"] }],
		["post", `${CERTS}/validate`, {}],
		["post", `${CERTS}/1/upload`, {}],
		["post", `${CERTS}/1/renew`, {}],
		["put", `${CERTS}/1/dns-credential`, { npmpro_dns_credential_id: 1 }],
	];
	for (const [method, url, body] of routes) {
		const refused = await none[method](url, body);
		assert.equal(refused.status, 401, `${method} ${url}`);
	}
});

it("refuses a user without the permission: 403 on every route, a view-only user may list, read and test", async () => {
	const id = await uploaded();
	const hidden = await api.limited({ visibility: "all", certificates: "hidden" });
	const viewer = await api.limited({ visibility: "all", certificates: "view" });
	const form = new FormData();
	form.append("certificate", new Blob([await read(pair.certificate)]), "c.pem");
	const refusals = [
		["get", CERTS],
		["get", `${CERTS}/${id}`],
		["post", `${CERTS}/test-http`, { domains: ["a.example.com"] }],
	];
	for (const [method, url, body] of refusals)
		assert.equal((await hidden[method](url, body)).status, 403, `${method} ${url}`);
	assert.equal((await viewer.get(CERTS)).status, 200);
	assert.equal((await viewer.get(`${CERTS}/${id}`)).status, 200);
	const manage = [
		["post", CERTS, { provider: "other", nice_name: "denied" }],
		["delete", `${CERTS}/${id}`],
		["post", `${CERTS}/${id}/renew`, {}],
		["put", `${CERTS}/${id}/dns-credential`, { npmpro_dns_credential_id: 1 }],
	];
	const rows = await countRows(api, "certificate");
	for (const session of [hidden, viewer]) {
		for (const [method, url, body] of manage)
			assert.equal((await session[method](url, body)).status, 403, `${method} ${url}`);
		assert.equal((await session.send("POST", `${CERTS}/validate`, { form })).status, 403);
		assert.equal((await session.send("POST", `${CERTS}/${id}/upload`, { form })).status, 403);
	}
	assert.equal(await countRows(api, "certificate"), rows);
	assert.ok(await api.db("certificate").where({ id }).first());
});

it("shows a user with the visibility user only their own certificates", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const mine = await own.post(CERTS, { provider: "other", nice_name: "Mine only" });
	assert.equal(mine.status, 201);
	assert.equal(mine.body.owner_user_id, own.user.id);
	const ids = (await own.get(CERTS)).body.map((row) => row.id);
	assert.deepEqual(ids, [mine.body.id]);
	const foreign = await admin.post(CERTS, { provider: "other", nice_name: "Not yours" });
	assert.equal((await own.get(`${CERTS}/${foreign.body.id}`)).status, 404);
	assert.equal((await own.delete(`${CERTS}/${foreign.body.id}`)).status, 404);
	assert.ok(await api.db("certificate").where({ id: foreign.body.id }).first());
	assert.equal(
		(await admin.get(CERTS)).body.some((row) => row.id === foreign.body.id),
		true,
	);
});
