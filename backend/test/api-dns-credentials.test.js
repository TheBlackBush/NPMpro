import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { countRows, fileExists } from "./support/hosts.js";

const BASE = "/nginx/dns-credentials";
const TOKEN = "cf-token-SECRET-1234567890";
const KEY_FILE = "data/npmpro/dns-credentials.key";

let api;
let admin;
let names = 0;

const name = () => {
	names += 1;
	return `Credential ${names}`;
};
const cloudflare = (fields = [{ key: "dns_cloudflare_api_token", value: TOKEN }]) => ({
	name: name(),
	provider: "cloudflare",
	fields,
});
const create = async (body = cloudflare(), session = admin) => {
	const done = await session.post(BASE, body);
	assert.equal(done.status, 201, done.text);
	return done.body;
};
// the values as stored, decrypted with the key file by the test itself (AES-256-GCM, "v1:iv:tag:data")
const stored = async (id) => {
	const row = await api.db("npmpro_dns_credential").where({ id }).first();
	const [, iv, tag, data] = row.values.split(":").map((part, n) => (n === 0 ? part : Buffer.from(part, "base64")));
	const decipher = createDecipheriv("aes-256-gcm", await readFile(path.join(api.root, KEY_FILE)), iv, {
		authTagLength: 16,
	});
	decipher.setAuthTag(tag);
	return { raw: row.values, values: JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString()) };
};
const addCertificate = async (credentialId, provider = "cloudflare", challenge = 1) => {
	const [id] = await api.db("certificate").insert({
		owner_user_id: 1,
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		provider: "letsencrypt",
		nice_name: "dns cert",
		domain_names: JSON.stringify(["*.dns.example.com"]),
		expires_on: "2099-01-01 00:00:00",
		meta: "{}",
		npmpro_dns_challenge: challenge,
		npmpro_dns_provider: provider,
		npmpro_dns_credential_id: credentialId,
	});
	return id;
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("creates a credential: 201, the secret never in the answer, encrypted in the database, an audit entry without values", async () => {
	const body = cloudflare();
	const created = await create(body);
	assert.equal(created.name, body.name);
	assert.equal(created.provider, "cloudflare");
	assert.equal(created.owner_user_id, 1);
	assert.equal(created.decrypt_error, false);
	assert.equal(created.ini_set, false);
	assert.deepEqual(created.fields, [
		{ key: "dns_cloudflare_api_token", is_set: true },
		{ key: "dns_cloudflare_email", is_set: false },
		{ key: "dns_cloudflare_api_key", is_set: false },
	]);
	assert.equal(JSON.stringify(created).includes(TOKEN), false);
	assert.equal("values" in created, false);
	const { raw, values } = await stored(created.id);
	assert.match(raw, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/u);
	assert.equal(raw.includes(TOKEN), false);
	assert.deepEqual(values, { fields: { dns_cloudflare_api_token: TOKEN } });
	const key = await stat(path.join(api.root, KEY_FILE));
	assert.equal(key.mode & 0o077, 0);
	const audit = await api.db("audit_log").where({ object_type: "dns-credential", object_id: created.id }).first();
	assert.equal(audit.action, "created");
	assert.equal(audit.meta.includes(TOKEN), false);
	assert.equal(JSON.parse(audit.meta).provider, "cloudflare");
});

it("shows non-secret values and hides secret ones when reading and listing", async () => {
	const created = await create({
		name: name(),
		provider: "cloudflare",
		fields: [
			{ key: "dns_cloudflare_email", value: "me@example.com" },
			{ key: "dns_cloudflare_api_key", value: "GLOBAL-KEY-SECRET" },
		],
	});
	const one = await admin.get(`${BASE}/${created.id}`);
	assert.equal(one.status, 200);
	assert.deepEqual(one.body.fields, [
		{ key: "dns_cloudflare_api_token", is_set: false },
		{ key: "dns_cloudflare_email", value: "me@example.com", is_set: true },
		{ key: "dns_cloudflare_api_key", is_set: true },
	]);
	const list = await admin.get(BASE);
	assert.equal(list.status, 200);
	assert.equal(list.text.includes("GLOBAL-KEY-SECRET"), false);
	assert.equal(list.text.includes(TOKEN), false);
	assert.ok(list.body.some((row) => row.id === created.id));
	const names_ = list.body.map((row) => row.name);
	assert.deepEqual(
		names_,
		[...names_].sort((a, b) => a.localeCompare(b)),
	);
	const search = await admin.get(`${BASE}?query=${encodeURIComponent(created.name)}`);
	assert.deepEqual(
		search.body.map((row) => row.id),
		[created.id],
	);
});

it("stores an INI credential for a provider without a form, and never returns its text", async () => {
	const ini = "dns_acmedns_api_url = https://acme-dns.example.com\ndns_acmedns_secret = INI-SECRET-VALUE";
	const created = await create({ name: name(), provider: "acmedns", ini });
	assert.equal(created.ini_set, true);
	assert.deepEqual(created.fields, []);
	assert.equal(JSON.stringify(created).includes("INI-SECRET-VALUE"), false);
	assert.equal(JSON.stringify(created).includes('ini"'), false);
	const { raw, values } = await stored(created.id);
	assert.equal(raw.includes("INI-SECRET-VALUE"), false);
	assert.deepEqual(values, { ini });
	assert.equal((await admin.get(`${BASE}/${created.id}`)).text.includes("INI-SECRET-VALUE"), false);
});

it("refuses a credential that breaks the schema or the provider rules: 400 and no row", async () => {
	const rows = await countRows(api, "npmpro_dns_credential");
	const token = { key: "dns_cloudflare_api_token", value: TOKEN };
	const bodies = [
		[{}, /name|required/u],
		[{ name: name() }, /provider|required/u],
		[{ name: "", provider: "cloudflare", fields: [token] }, /./u],
		[{ name: name(), provider: "cloudflare", fields: [token], extra: 1 }, /./u],
		[{ name: name(), provider: "cloudflare", fields: [{ value: "x" }] }, /./u],
		[{ name: name(), provider: "nobody", fields: [token] }, /Unknown DNS provider/u],
		[{ name: name(), provider: "cloudxns", ini: "a = b" }, /no longer supported/u],
		[{ name: name(), provider: "cloudflare", fields: [token], ini: "a = b" }, /either fields or ini/u],
		[{ name: name(), provider: "cloudflare", fields: [{ key: "dns_unknown", value: "x" }] }, /Unknown field/u],
		[{ name: name(), provider: "cloudflare", fields: [] }, /Fill in exactly one of/u],
		[
			{
				name: name(),
				provider: "cloudflare",
				fields: [token, { key: "dns_cloudflare_api_key", value: "also" }],
			},
			/Fill in exactly one of/u,
		],
		[{ name: name(), provider: "digitalocean", fields: [] }, /API token is required/u],
		[
			{ name: name(), provider: "digitalocean", fields: [{ key: "dns_digitalocean_token", value: "a\nb = c" }] },
			/line break/u,
		],
		[{ name: name(), provider: "acmedns", fields: [{ key: "x", value: "y" }] }, /no field definition/u],
		[{ name: name(), provider: "acmedns", ini: "   " }, /credentials are required/u],
	];
	for (const [body, message] of bodies) {
		const refused = await admin.post(BASE, body);
		assert.equal(refused.status, 400, JSON.stringify(body));
		assert.match(refused.body.error.message, message, JSON.stringify(body));
	}
	assert.equal(await countRows(api, "npmpro_dns_credential"), rows);
});

it("refuses a second credential with the same name for the same owner", async () => {
	const first = await create();
	const rows = await countRows(api, "npmpro_dns_credential");
	const again = await admin.post(BASE, cloudflare());
	assert.equal(again.status, 201);
	const dupe = await admin.post(BASE, { ...cloudflare(), name: first.name });
	assert.equal(dupe.status, 400);
	assert.match(dupe.body.error.message, /already exists/u);
	assert.equal(await countRows(api, "npmpro_dns_credential"), rows + 1);
});

it("updates the name and keeps the secrets; an empty secret keeps the stored value", async () => {
	const created = await create();
	const renamed = await admin.put(`${BASE}/${created.id}`, { name: "Renamed credential" });
	assert.equal(renamed.status, 200, renamed.text);
	assert.equal(renamed.body.name, "Renamed credential");
	assert.equal((await stored(created.id)).values.fields.dns_cloudflare_api_token, TOKEN);
	const kept = await admin.put(`${BASE}/${created.id}`, { fields: [{ key: "dns_cloudflare_api_token", value: "" }] });
	assert.equal(kept.status, 200, kept.text);
	assert.equal((await stored(created.id)).values.fields.dns_cloudflare_api_token, TOKEN);
	const changed = await admin.put(`${BASE}/${created.id}`, {
		fields: [{ key: "dns_cloudflare_api_token", value: "NEW-TOKEN" }],
	});
	assert.equal(changed.status, 200);
	assert.equal(changed.text.includes("NEW-TOKEN"), false);
	const { raw, values } = await stored(created.id);
	assert.equal(raw.includes("NEW-TOKEN"), false);
	assert.equal(values.fields.dns_cloudflare_api_token, "NEW-TOKEN");
	const audit = await api
		.db("audit_log")
		.where({ object_type: "dns-credential", object_id: created.id, action: "updated" });
	assert.equal(audit.length, 3);
	assert.equal(
		audit.some((entry) => entry.meta.includes("NEW-TOKEN") || entry.meta.includes(TOKEN)),
		false,
	);
});

it("rewrites the credentials file of the DNS certificates that use it when the values change", async () => {
	const created = await create();
	const certificate = await addCertificate(created.id);
	const file = `tmp/certbot-credentials/credentials-${certificate}`;
	assert.equal(await fileExists(api, file), false);
	const changed = await admin.put(`${BASE}/${created.id}`, {
		fields: [{ key: "dns_cloudflare_api_token", value: "ROTATED" }],
	});
	assert.equal(changed.status, 200, changed.text);
	assert.equal(await api.read(file), "dns_cloudflare_api_token = ROTATED\n");
	assert.equal((await stat(path.join(api.root, file))).mode & 0o077, 0);
	const renamed = await admin.put(`${BASE}/${created.id}`, { name: "Only a new name" });
	assert.equal(renamed.status, 200);
	assert.equal(await api.read(file), "dns_cloudflare_api_token = ROTATED\n");
});

it("switches the active group of a provider and drops the secret of the other group", async () => {
	const created = await create();
	const switched = await admin.put(`${BASE}/${created.id}`, {
		fields: [
			{ key: "dns_cloudflare_email", value: "me@example.com" },
			{ key: "dns_cloudflare_api_key", value: "GLOBAL" },
		],
	});
	assert.equal(switched.status, 200, switched.text);
	assert.deepEqual((await stored(created.id)).values, {
		fields: { dns_cloudflare_email: "me@example.com", dns_cloudflare_api_key: "GLOBAL" },
	});
});

it("asks for the secrets again when the endpoint of a saved credential changes", async () => {
	const created = await create({
		name: name(),
		provider: "powerdns",
		fields: [
			{ key: "dns_pdns_endpoint", value: "https://pdns.example.com" },
			{ key: "dns_pdns_api_key", value: "PDNS-KEY" },
		],
	});
	const refused = await admin.put(`${BASE}/${created.id}`, {
		fields: [{ key: "dns_pdns_endpoint", value: "https://elsewhere.example.net" }],
	});
	assert.equal(refused.status, 400);
	assert.match(refused.body.error.message, /requires entering API key again/u);
	assert.equal((await stored(created.id)).values.fields.dns_pdns_endpoint, "https://pdns.example.com");
	const ok = await admin.put(`${BASE}/${created.id}`, {
		fields: [
			{ key: "dns_pdns_endpoint", value: "https://elsewhere.example.net" },
			{ key: "dns_pdns_api_key", value: "OTHER-KEY" },
		],
	});
	assert.equal(ok.status, 200, ok.text);
});

it("changes the provider of an unused credential and carries no secret over; refuses it while a certificate uses it", async () => {
	const free = await create();
	const needFields = await admin.put(`${BASE}/${free.id}`, { provider: "digitalocean" });
	assert.equal(needFields.status, 400);
	assert.match(needFields.body.error.message, /requires entering its credentials/u);
	const moved = await admin.put(`${BASE}/${free.id}`, {
		provider: "digitalocean",
		fields: [{ key: "dns_digitalocean_token", value: "DO-TOKEN" }],
	});
	assert.equal(moved.status, 200, moved.text);
	assert.equal(moved.body.provider, "digitalocean");
	assert.deepEqual((await stored(free.id)).values, { fields: { dns_digitalocean_token: "DO-TOKEN" } });
	const used = await create();
	await addCertificate(used.id);
	const refused = await admin.put(`${BASE}/${used.id}`, {
		provider: "digitalocean",
		fields: [{ key: "dns_digitalocean_token", value: "DO-TOKEN" }],
	});
	assert.equal(refused.status, 400);
	assert.match(refused.body.error.message, /cannot change while certificates use/u);
	assert.equal((await api.db("npmpro_dns_credential").where({ id: used.id }).first()).provider, "cloudflare");
	const deprecated = await admin.put(`${BASE}/${free.id}`, { provider: "cloudxns", ini: "a = b" });
	assert.equal(deprecated.status, 400);
	assert.match(deprecated.body.error.message, /no longer supported/u);
});

it("refuses an update that breaks the schema, names a taken name or an unknown credential", async () => {
	const first = await create();
	const second = await create();
	const before = await stored(second.id);
	for (const body of [{}, { name: "" }, { extra: 1 }, { fields: [{ value: "x" }] }, { provider: "nobody" }]) {
		const refused = await admin.put(`${BASE}/${second.id}`, body);
		assert.equal(refused.status, 400, JSON.stringify(body));
	}
	const taken = await admin.put(`${BASE}/${second.id}`, { name: first.name });
	assert.equal(taken.status, 400);
	assert.match(taken.body.error.message, /already exists/u);
	assert.equal((await admin.put(`${BASE}/9999`, { name: "x" })).status, 404);
	assert.equal((await stored(second.id)).raw, before.raw);
	assert.equal((await api.db("npmpro_dns_credential").where({ id: second.id }).first()).name, second.name);
});

it("deletes an unused credential; refuses while a certificate uses it", async () => {
	const created = await create();
	const certificate = await addCertificate(created.id);
	const refused = await admin.delete(`${BASE}/${created.id}`);
	assert.equal(refused.status, 400);
	assert.match(refused.body.error.message, /still used by 1 certificate/u);
	assert.ok(await api.db("npmpro_dns_credential").where({ id: created.id }).first());
	await api.db("certificate").where({ id: certificate }).del();
	const done = await admin.delete(`${BASE}/${created.id}`);
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.id, created.id);
	assert.equal(JSON.stringify(done.body).includes(TOKEN), false);
	assert.equal(await api.db("npmpro_dns_credential").where({ id: created.id }).first(), undefined);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "dns-credential", object_id: created.id, action: "deleted" })
		.first();
	assert.ok(audit);
	assert.equal(audit.meta.includes(TOKEN), false);
	assert.equal((await admin.get(`${BASE}/${created.id}`)).status, 404);
	assert.equal((await admin.delete(`${BASE}/${created.id}`)).status, 404);
});

it("expands the owner and the certificates of a credential", async () => {
	const created = await create();
	const certificate = await addCertificate(created.id);
	const one = await admin.get(`${BASE}/${created.id}?expand=owner,certificates`);
	assert.equal(one.status, 200, one.text);
	assert.equal(one.body.owner.email, "admin@example.com");
	assert.deepEqual(
		one.body.certificates.map((row) => row.id),
		[certificate],
	);
	const list = await admin.get(`${BASE}?expand=certificates`);
	assert.equal(list.body.find((row) => row.id === created.id).certificates.length, 1);
	assert.equal((await admin.get(`${BASE}?expand=nothing`)).status, 400);
	assert.equal((await admin.get(`${BASE}/${created.id}?expand=nothing`)).status, 400);
});

it("reports a credential that cannot be decrypted without failing the list", async () => {
	const created = await create();
	await api.db("npmpro_dns_credential").where({ id: created.id }).update({ values: "v1:AAAA:BBBB:CCCC" });
	const one = await admin.get(`${BASE}/${created.id}`);
	assert.equal(one.status, 200);
	assert.equal(one.body.decrypt_error, true);
	const list = await admin.get(BASE);
	assert.equal(list.status, 200);
	assert.equal(list.body.find((row) => row.id === created.id).decrypt_error, true);
});

it("answers 401 without a session on every DNS credential route", async () => {
	const none = api.client();
	for (const [method, url, body] of [
		["get", BASE],
		["post", BASE, cloudflare()],
		["get", `${BASE}/1`],
		["put", `${BASE}/1`, { name: "x" }],
		["delete", `${BASE}/1`],
	]) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
	}
});

it("refuses a user without the permission: hidden sees nothing, view-only reads but cannot write", async () => {
	const created = await create();
	const hidden = await api.limited({ visibility: "all", certificates: "hidden" });
	const viewer = await api.limited({ visibility: "all", certificates: "view" });
	const rows = await countRows(api, "npmpro_dns_credential");
	for (const [method, url, body] of [
		["get", BASE],
		["get", `${BASE}/${created.id}`],
		["post", BASE, cloudflare()],
		["put", `${BASE}/${created.id}`, { name: "denied" }],
		["delete", `${BASE}/${created.id}`],
	]) {
		assert.equal((await hidden[method](url, body)).status, 403, `hidden ${method} ${url}`);
	}
	assert.equal((await viewer.get(BASE)).status, 200);
	assert.equal((await viewer.get(`${BASE}/${created.id}`)).status, 200);
	assert.equal((await viewer.get(`${BASE}/${created.id}`)).text.includes(TOKEN), false);
	for (const [method, url, body] of [
		["post", BASE, cloudflare()],
		["put", `${BASE}/${created.id}`, { name: "denied" }],
		["delete", `${BASE}/${created.id}`],
	]) {
		assert.equal((await viewer[method](url, body)).status, 403, `view ${method} ${url}`);
	}
	assert.equal(await countRows(api, "npmpro_dns_credential"), rows);
	assert.equal((await api.db("npmpro_dns_credential").where({ id: created.id }).first()).name, created.name);
});

it("shows a user with the visibility user only their own credentials", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const mine = await create(cloudflare(), own);
	assert.equal(mine.owner_user_id, own.user.id);
	const foreign = await create();
	assert.deepEqual(
		(await own.get(BASE)).body.map((row) => row.id),
		[mine.id],
	);
	assert.equal((await own.get(`${BASE}/${foreign.id}`)).status, 404);
	assert.equal((await own.put(`${BASE}/${foreign.id}`, { name: "taken over" })).status, 404);
	assert.equal((await own.delete(`${BASE}/${foreign.id}`)).status, 404);
	assert.equal((await api.db("npmpro_dns_credential").where({ id: foreign.id }).first()).name, foreign.name);
	const sameName = await create({ ...cloudflare(), name: foreign.name }, own);
	assert.equal(sameName.name, foreign.name);
});

it("documents the status the create answers with", { todo: "BUG-10" }, async () => {
	const schema = await admin.get("/schema");
	assert.equal(schema.status, 200);
	const responses = schema.body.paths["/nginx/dns-credentials"].post.responses;
	const created = await create();
	assert.ok(created.id);
	assert.ok(responses["201"], `the schema lists ${Object.keys(responses).join(", ")} but the route answers 201`);
});
