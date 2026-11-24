import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, it } from "node:test";
import { extractTo } from "../lib/backup/archive.js";
import { openBackupFile } from "../lib/backup/format.js";
import { startApi } from "./support/api.js";

const RECORDS = "/nginx/ddns-records";
const PUBLIC_IP = "81.2.69.160";
const PASSWORD = "preset-PASS-secret-4321";
const USER = "someone@example.com";
const PASSPHRASE = "a long enough passphrase of my own";
const SEALED = /^v1:/u;

let api;
let admin;
let seen = [];
const logged = [];
const answer = { status: 200, body: "good 81.2.69.160" };

const add = (body, session = admin) => session.post(RECORDS, body);
const addOk = async (body, session = admin) => {
	const done = await add(body, session);
	if (done.status !== 201) throw new Error(`preset create answered ${done.status}: ${done.text}`);
	return done.body;
};
const noip = (name, extra = {}) => ({
	provider: "noip",
	name,
	username: USER,
	password: PASSWORD,
	...extra,
});
const reply = (options) => {
	seen.push({ path: options.path, auth: options.headers?.Authorization });
	return { statusCode: answer.status, data: answer.body };
};
const mockProviders = () => {
	for (const host of [
		"https://dynupdate.no-ip.com",
		"https://api.dynu.com",
		"https://dynamicdns.park-your-domain.com",
	]) {
		api.outside.http
			.get(host)
			.intercept({ path: () => true, method: "GET" })
			.reply((options) => reply({ ...options, origin: host }))
			.persist();
	}
};

before(async () => {
	api = await startApi({
		env: {
			DDNS_IPV4_SERVICES: "https://ip1.test https://ip2.test",
			DDNS_IPV6_SERVICES: "https://ip6a.test https://ip6b.test",
		},
	});
	admin = await api.admin();
	for (const method of ["log", "warn", "error", "info"]) {
		console[method] = (...args) => logged.push(args.map(String).join(" "));
	}
	for (const [host, ip] of [
		["ip1.test", "198.51.100.50"],
		["ip2.test", "198.51.100.51"],
		["dynupdate.no-ip.com", "198.51.100.71"],
		["api.dynu.com", "198.51.100.72"],
		["dynamicdns.park-your-domain.com", "198.51.100.73"],
	]) {
		api.outside.dns.set(host, ip);
	}
	for (const host of ["ip1.test", "ip2.test"]) {
		api.outside.http
			.get(`https://${host}`)
			.intercept({ path: "/", method: "GET" })
			.reply(() => ({ statusCode: 200, data: `${PUBLIC_IP}\n` }))
			.persist();
	}
	mockProviders();
});
afterEach(async () => {
	seen = [];
	answer.status = 200;
	answer.body = "good 81.2.69.160";
	await api.db("npmpro_ddns_history").del();
	await api.db("npmpro_ddns_record").del();
});
after(() => api?.stop());

it("lists the presets without a credential, for everyone who manages certificates", async () => {
	const providers = await admin.get("/nginx/ddns/providers");
	for (const id of ["namecheap", "noip", "dynu"]) {
		const preset = providers.body.find((provider) => provider.id === id);
		assert.equal(preset.preset, true, id);
		assert.equal(preset.admin_only, false);
		assert.equal(preset.credential_provider, null);
		assert.equal(preset.zoneless, true);
		assert.equal(preset.wildcards, false);
		assert.equal(preset.aliases, false);
	}
	assert.equal(providers.body.find((provider) => provider.id === "namecheap").ipv6, false);
});

it("creates a preset record for a user who is no administrator, who alone sees and changes it", async () => {
	const manager = await api.limited({ visibility: "user", certificates: "manage" });
	const record = await addOk(noip("home.example.net"), manager);
	assert.equal(record.provider, "noip");
	assert.equal(record.dns_credential_id, null);
	assert.equal(record.secret_set, true);
	assert.equal(record.ttl, null);
	assert.equal((await manager.get(`${RECORDS}/${record.id}`)).status, 200);
	const other = await api.limited({ visibility: "user", certificates: "manage" });
	assert.equal((await other.get(`${RECORDS}/${record.id}`)).status, 404);
	assert.equal((await other.delete(`${RECORDS}/${record.id}`)).status, 404);
	assert.equal((await manager.put(`${RECORDS}/${record.id}`, { enabled: false })).status, 200);
	assert.equal((await manager.delete(`${RECORDS}/${record.id}`)).status, 200);
});

it("updates through the provider with Basic auth, then does not write again for the same address", async () => {
	const record = await addOk(noip("home.example.net"));
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.status, 200, run.text);
	assert.equal(run.body.state, "ok", run.text);
	assert.equal(seen.length, 1);
	assert.equal(seen[0].path, `/nic/update?hostname=home.example.net&myip=${PUBLIC_IP}`);
	assert.equal(seen[0].auth, `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`);
	assert.equal(run.body.last_ipv4, PUBLIC_IP);
	const history = await admin.get(`${RECORDS}/${record.id}/history`);
	assert.equal(history.body.length, 1);
	assert.equal(history.body[0].new_ip, PUBLIC_IP);
});

it("writes a Namecheap record with the host, the domain and the password, and refuses IPv6 at save", async () => {
	answer.body =
		'<?xml version="1.0" encoding="utf-16"?><interface-response><ErrCount>0</ErrCount><errors /></interface-response>';
	const base = { provider: "namecheap", password: PASSWORD, domain: "Example.com" };
	const six = await add({ ...base, name: "home.example.com", ip_version: "ipv6" });
	assert.equal(six.status, 400, six.text);
	assert.equal(six.body.error.message_i18n, "error.ddns-ipv4-only");
	assert.equal(
		(await add({ ...base, name: "home.example.com", ip_version: "both" })).body.error.message_i18n,
		"error.ddns-ipv4-only",
	);
	const outside = await add({ ...base, name: "home.example.org" });
	assert.equal(outside.body.error.message_i18n, "error.ddns-zone-mismatch");
	const noDomain = await add({ provider: "namecheap", password: PASSWORD, name: "home.example.com" });
	assert.equal(noDomain.body.error.message_i18n, "error.ddns-preset-required");
	const record = await addOk({ ...base, name: "home.example.com" });
	assert.equal(record.domain, "example.com");
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.body.state, "ok", run.text);
	assert.equal(seen[0].path, `/update?host=home&domain=example.com&password=${PASSWORD}&ip=${PUBLIC_IP}`);
});

it("sends a Dynu record with the hostname always", async () => {
	const record = await addOk({ provider: "dynu", name: "home.example.org", username: USER, password: PASSWORD });
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.body.state, "ok", run.text);
	assert.equal(seen[0].path, `/nic/update?hostname=home.example.org&myip=${PUBLIC_IP}&myipv6=no`);
});

it("never shows the password or the user name: not in an answer, list, history, audit entry, log or error", async () => {
	const record = await addOk(noip("leak.example.net"));
	answer.status = 401;
	answer.body = `badauth ${PASSWORD} ${USER}`;
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.status, 200, run.text);
	assert.equal(run.body.state, "failed");
	const row = await api.db("npmpro_ddns_record").where({ id: record.id }).first();
	assert.match(row.secret, SEALED);
	const texts = [
		JSON.stringify(row),
		JSON.stringify(await api.db("npmpro_ddns_history").where({ ddns_record_id: record.id })),
		JSON.stringify(await api.db("audit_log").where({ object_type: "ddns-record" })),
		run.text,
		(await admin.get(`${RECORDS}/${record.id}`)).text,
		(await admin.get(RECORDS)).text,
		(await admin.get(`${RECORDS}?expand=credential,owner`)).text,
		(await admin.get(`${RECORDS}/${record.id}/history`)).text,
		(await admin.get("/nginx/ddns/status")).text,
		JSON.stringify(record),
		logged.join("\n"),
	];
	for (const text of texts) {
		assert.ok(!text.includes(PASSWORD), text.slice(0, 200));
		assert.ok(!text.includes(USER), text.slice(0, 200));
	}
});

it("refuses a credential, a TTL, an alias, a wildcard, a foreign field and missing details", async () => {
	const refuse = async (body, key) => {
		const done = await add({ ...noip("a.example.net"), ...body });
		assert.equal(done.status, 400, `${done.text} ${JSON.stringify(body)}`);
		assert.equal(done.body.error.message_i18n, key, JSON.stringify(body));
		assert.ok(!done.text.includes(PASSWORD));
	};
	await refuse({ ttl: 300 }, "error.ddns-ttl-unsupported");
	await refuse({ kind: "alias", target: "b.example.net" }, "error.ddns-alias-unsupported");
	await refuse({ name: "*.example.net" }, "error.ddns-wildcard-unsupported");
	await refuse({ dns_credential_id: 1 }, "error.ddns-preset-no-credential");
	await refuse({ domain: "example.net" }, "error.ddns-preset-field");
	await refuse({ url: "https://dyn.test/x" }, "error.ddns-custom-fields-only");
	await refuse({ password: undefined }, "error.ddns-preset-required");
	await refuse({ username: undefined }, "error.ddns-preset-required");
	const count = Number((await api.db("npmpro_ddns_record").count({ count: "*" }).first()).count);
	assert.equal(count, 0);
});

it("keeps the stored details when a change sends none, and starts over when a new password is saved", async () => {
	const record = await addOk(noip("keep.example.net"));
	const kept = await admin.put(`${RECORDS}/${record.id}`, { password: "", enabled: true });
	assert.equal(kept.status, 200, kept.text);
	assert.equal(kept.body.secret_set, true);
	assert.equal(kept.body.state, "pending");
	assert.equal((await admin.post(`${RECORDS}/${record.id}/update`)).body.state, "ok");
	assert.equal(seen[0].auth, `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`);
	const changed = await admin.put(`${RECORDS}/${record.id}`, { password: "another-PASS-5678" });
	assert.equal(changed.status, 200, changed.text);
	assert.equal(changed.body.state, "pending");
	seen = [];
	// the write cooldown of the first update would hold this one back
	await api.db("npmpro_ddns_record").where({ id: record.id }).update({ last_changed_on: null });
	const again = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(again.body.state, "ok", again.text);
	assert.equal(seen[0].auth, `Basic ${Buffer.from(`${USER}:another-PASS-5678`).toString("base64")}`);
});

it("clears 'Enter the password again' when a password is saved, and leaves the record disabled", async () => {
	const record = await addOk(noip("restored.example.net"));
	await api
		.db("npmpro_ddns_record")
		.where({ id: record.id })
		.update({
			secret: null,
			enabled: 0,
			state: "disabled",
			meta: JSON.stringify({ error_i18n: "error.ddns-secret-missing" }),
		});
	const shown = (await admin.get(`${RECORDS}/${record.id}`)).body;
	assert.equal(shown.secret_set, false);
	assert.equal(shown.error_i18n, "error.ddns-secret-missing");
	const enabling = await admin.put(`${RECORDS}/${record.id}`, { enabled: true });
	assert.equal(enabling.body.error.message_i18n, "error.ddns-preset-required");
	const saved = await admin.put(`${RECORDS}/${record.id}`, { username: USER, password: PASSWORD });
	assert.equal(saved.status, 200, saved.text);
	assert.equal(saved.body.secret_set, true);
	assert.equal(saved.body.error_i18n, null);
	assert.equal(saved.body.enabled, false);
});

const exportedDdns = async (session, id, secrets) => {
	const made = await session.post("/backups/export", {
		kind: "ddns",
		ids: [id],
		linked: {},
		secrets,
		passphrase: secrets ? PASSPHRASE : undefined,
	});
	if (made.status !== 200) throw new Error(`export answered ${made.status}: ${made.text}`);
	const downloaded = await session.get(`/backups/pending/${made.body.pending}`);
	if (downloaded.status !== 200) throw new Error(`download answered ${downloaded.status}`);
	const dir = await mkdtemp(path.join(os.tmpdir(), "preset-export-"));
	try {
		const file = path.join(dir, "export.npmpro");
		await writeFile(file, downloaded.bytes);
		await extractTo({
			source: await openBackupFile({ file, passphrase: secrets ? PASSPHRASE : undefined }),
			dir: path.join(dir, "out"),
			allow: () => true,
		});
		return await readFile(path.join(dir, "out", "data", "ddns.json"), "utf8");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};

it("exports the details in an archive with secrets and never in one without, for a user too", async () => {
	const manager = await api.limited({ visibility: "user", certificates: "manage" });
	const record = await addOk(noip("export.example.net"), manager);
	const withSecrets = JSON.parse(await exportedDdns(manager, record.id, true)).npmpro_ddns_record[0];
	assert.deepEqual(withSecrets.secret, { username: USER, password: PASSWORD });
	const without = await exportedDdns(manager, record.id, false);
	assert.ok(!without.includes(PASSWORD));
	assert.ok(!without.includes(USER));
	assert.equal(JSON.parse(without).npmpro_ddns_record[0].secret, null);
});

it("a failing provider answer is shown scrubbed and the record fails with a retry time", async () => {
	const record = await addOk({ provider: "dynu", name: "bad.example.org", username: USER, password: PASSWORD });
	answer.body = "badauth";
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.body.state, "failed", run.text);
	assert.ok(run.body.error.includes("badauth"));
	assert.ok(!run.text.includes(PASSWORD));
});
