import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { countRows, fileExists } from "./support/hosts.js";

// /backups* (schema/paths/backups, wiki/Backup-and-restore): create, list, inspect, download, delete, upload, the export
// and import of page items and the restore plan, on backups made in the test.

const BASE = "/backups";
const PASSPHRASE = "a long passphrase 1";
const OCTET = { "content-type": "application/octet-stream" };
const ALL_TYPES = [
	"proxy_hosts",
	"redirection_hosts",
	"dead_hosts",
	"streams",
	"certificates",
	"access_lists",
	"dns_credentials",
	"users",
	"settings_runtime",
	"settings_default_site",
	"settings_oidc",
	"settings_monitoring",
	"custom_nginx",
	"crowdsec_files",
	"backup_schedules",
];

let api;
let admin;
let hosts = 0;

const addHost = async (domain, session = admin) => {
	hosts += 1;
	const done = await session.post("/nginx/proxy-hosts", {
		domain_names: [domain ?? `bk${hosts}.example.com`],
		forward_scheme: "http",
		forward_host: `10.0.7.${hosts}`,
		forward_port: 8080,
	});
	assert.equal(done.status, 201, done.text);
	return done.body;
};
const domains = async () => (await admin.get("/nginx/proxy-hosts")).body.flatMap((host) => host.domain_names).sort();
const keep = async (body = {}) => {
	const done = await admin.post(BASE, { types: ["proxy_hosts"], secrets: false, keep: true, ...body });
	assert.equal(done.status, 200, done.text);
	return done.body.entry;
};
const inspect = async (name, body = {}) => {
	const done = await admin.post(`${BASE}/${name}/inspect`, body);
	assert.equal(done.status, 200, done.text);
	return done.body;
};
const raw = (session, url, bytes) => session.send("POST", url, { form: bytes, headers: OCTET });

before(async () => {
	api = await startApi({ env: { TZ: "Europe/Berlin" } });
	admin = await api.admin();
});
after(() => api?.stop());

it("answers the backup types with the categories, the counts of what exists and the time zone", async () => {
	const empty = await admin.get(`${BASE}/types`);
	assert.equal(empty.status, 200, empty.text);
	assert.deepEqual(empty.body.categories.flatMap((category) => category.types).sort(), [...ALL_TYPES].sort());
	assert.deepEqual(
		empty.body.categories.map((category) => category.id),
		["hosts", "certificates", "access_lists", "dns_credentials", "users", "settings", "custom_files"],
	);
	assert.equal(empty.body.counts.proxy_hosts, 0);
	assert.equal(empty.body.counts.users, 1);
	assert.equal(empty.body.counts.settings_default_site, 1);
	assert.deepEqual(empty.body.certificateKinds, { letsencrypt: 0, other: 0, mtls: 0 });
	// the schedules show times in this zone
	assert.equal(empty.body.time_zone, "Europe/Berlin");

	await addHost();
	assert.equal((await admin.get(`${BASE}/types`)).body.counts.proxy_hosts, 1);
});

it("lists nothing before the first backup", async () => {
	const done = await admin.get(BASE);
	assert.equal(done.status, 200);
	assert.deepEqual(done.body, []);
});

it("refuses invalid backup requests with 400 and stores nothing", async () => {
	const bodies = [
		{},
		{ types: ["proxy_hosts"], secrets: false },
		{ types: [], secrets: false, keep: true },
		{ types: ["proxy_hosts", "proxy_hosts"], secrets: false, keep: true },
		{ types: ["audit_log"], secrets: false, keep: true },
		{ types: ["proxy_hosts"], secrets: true, keep: true, passphrase: "short" },
		{ types: ["proxy_hosts"], secrets: false, keep: "yes" },
		{ types: ["proxy_hosts"], secrets: false, keep: true, extra: 1 },
	];
	for (const body of bodies) {
		const done = await admin.post(BASE, body);
		assert.equal(done.status, 400, `${JSON.stringify(body)}: ${done.text}`);
	}
	const withoutPassphrase = await admin.post(BASE, { types: ["proxy_hosts"], secrets: true, keep: true });
	assert.equal(withoutPassphrase.status, 400, withoutPassphrase.text);
	assert.deepEqual((await admin.get(BASE)).body, []);
});

it("creates a backup that is kept on the server: private file, listed with its summary", async () => {
	const entry = await keep({ types: ["proxy_hosts", "settings_default_site"] });
	assert.match(entry.name, /^npmpro-backup-.+\.npmpro$/u);
	assert.equal(entry.auto, false);
	assert.equal(entry.encrypted, false);
	assert.equal(entry.instance_key, false);
	assert.equal(entry.schedule_id, null);
	assert.deepEqual(entry.summary.types, ["proxy_hosts", "settings_default_site"]);
	assert.deepEqual(entry.summary.counts, { proxy_hosts: 1, settings_default_site: 1 });
	assert.equal(entry.summary.secrets, false);
	assert.ok(entry.size > 100);
	const file = path.join(api.root, "data/backups", entry.name);
	assert.equal((await stat(file)).mode & 0o777, 0o600);
	assert.equal((await stat(file)).size, entry.size);

	const listed = (await admin.get(BASE)).body.find((row) => row.name === entry.name);
	assert.deepEqual(listed, entry);
	const audit = await api.db("audit_log").where({ object_type: "backup", action: "created" }).first();
	assert.equal(JSON.parse(audit.meta).name ?? entry.name, entry.name);
});

it("encrypts a backup with secrets, and hands a backup that is not kept over once", async () => {
	const entry = await keep({ secrets: true, passphrase: PASSPHRASE });
	assert.equal(entry.encrypted, true);
	assert.equal(entry.summary.secrets, true);
	const bytes = (await admin.get(`${BASE}/${entry.name}`)).bytes;
	assert.equal(bytes.includes(Buffer.from("example.com")), false);

	const pending = await admin.post(BASE, { types: ["proxy_hosts"], secrets: false, keep: false });
	assert.equal(pending.status, 200, pending.text);
	assert.ok(pending.body.pending);
	assert.match(pending.body.name, /\.npmpro$/u);
	assert.equal(pending.body.entry, undefined);
	assert.equal(
		(await admin.get(BASE)).body.some((row) => row.name === pending.body.name),
		false,
	);
	const url = `${BASE}/pending/${pending.body.pending}?name=${pending.body.name}`;
	const downloaded = await admin.get(url);
	assert.equal(downloaded.status, 200);
	assert.equal(downloaded.headers.get("content-disposition"), `attachment; filename=${pending.body.name}`);
	assert.ok(downloaded.bytes.length > 100);
	assert.equal((await admin.get(url)).status, 410);
	assert.equal((await admin.get(`${BASE}/pending/not-a-token`)).status, 410);
	const fallback = await admin.post(BASE, { types: ["proxy_hosts"], secrets: false, keep: false });
	const named = await admin.get(`${BASE}/pending/${fallback.body.pending}?name=evil.txt`);
	assert.equal(named.headers.get("content-disposition"), "attachment; filename=npmpro-backup.npmpro");
});

it("inspects a backup: the passphrase is checked and the answer holds the token, summary and manifest", async () => {
	const entry = await keep({ secrets: true, passphrase: PASSPHRASE });
	const wrong = await admin.post(`${BASE}/${entry.name}/inspect`, { passphrase: "not the passphrase 2" });
	assert.equal(wrong.status, 400);
	assert.equal(wrong.body.error.message_i18n, "backup.error.wrong-passphrase");
	const missing = await admin.post(`${BASE}/${entry.name}/inspect`, {});
	assert.equal(missing.status, 400);
	assert.equal(missing.body.error.message, "This backup needs its passphrase");
	assert.equal((await admin.post(`${BASE}/${entry.name}/inspect`, { passphrase: "short" })).status, 400);
	assert.equal((await admin.post(`${BASE}/${entry.name}/inspect`, { extra: 1 })).status, 400);

	const opened = await inspect(entry.name, { passphrase: PASSPHRASE });
	assert.ok(opened.token);
	assert.deepEqual(opened.summary, entry.summary);
	assert.equal(opened.manifest.created_by.email, "admin@example.com");
	assert.equal(opened.manifest.secrets, true);
	assert.deepEqual(opened.manifest.types, ["proxy_hosts"]);
	assert.ok(opened.preview);
	assert.equal(JSON.stringify(opened).includes(PASSPHRASE), false);

	const plain = await keep();
	assert.ok((await inspect(plain.name)).token);
});

it("downloads a stored backup as an attachment, and answers 404 for an unknown or unsafe name", async () => {
	const entry = await keep();
	const done = await admin.get(`${BASE}/${entry.name}`);
	assert.equal(done.status, 200);
	assert.equal(done.headers.get("content-disposition"), `attachment; filename=${entry.name}`);
	assert.equal(done.bytes.length, entry.size);
	for (const name of ["npmpro-backup-none.npmpro", "..%2F..%2Fetc%2Fpasswd", "notes.txt", "auto", ".hidden.npmpro"]) {
		const missing = await admin.get(`${BASE}/${name}`);
		assert.ok([400, 404].includes(missing.status), `${name}: ${missing.status}`);
		assert.equal(missing.text.includes("root:"), false);
	}
	const inspected = await admin.post(`${BASE}/..%2F..%2Fetc%2Fpasswd/inspect`, {});
	assert.ok([400, 404].includes(inspected.status), String(inspected.status));
});

it("uploads a backup file as a stored backup, and refuses a file that is not a backup", async () => {
	const entry = await keep();
	const bytes = (await admin.get(`${BASE}/${entry.name}`)).bytes;
	const uploaded = await raw(admin, `${BASE}/upload?name=npmpro-backup-copied-20260101-000000.npmpro`, bytes);
	assert.equal(uploaded.status, 200, uploaded.text);
	assert.equal(uploaded.body.entry.name, "npmpro-backup-copied-20260101-000000.npmpro");
	assert.equal(uploaded.body.entry.auto, false);
	assert.deepEqual(uploaded.body.entry.summary, entry.summary);
	assert.equal(await fileExists(api, "data/backups/npmpro-backup-copied-20260101-000000.npmpro"), true);
	// the same name again gets another name, an unusable name gets one made from the file
	const twice = await raw(admin, `${BASE}/upload?name=npmpro-backup-copied-20260101-000000.npmpro`, bytes);
	assert.notEqual(twice.body.entry.name, "npmpro-backup-copied-20260101-000000.npmpro");
	const unnamed = await raw(admin, `${BASE}/upload?name=..%2Fx`, bytes);
	assert.equal(unnamed.status, 200, unnamed.text);
	assert.match(unnamed.body.entry.name, /^npmpro-backup-upload-.+\.npmpro$/u);

	const rows = (await admin.get(BASE)).body.length;
	const junk = await raw(admin, `${BASE}/upload`, Buffer.from("not a backup"));
	assert.equal(junk.status, 400);
	assert.equal(junk.body.error.message_i18n, "backup.error.not-a-backup");
	assert.equal((await admin.get(BASE)).body.length, rows);
});

it("deletes a stored backup and its file, and answers 404 for one that is gone", async () => {
	const entry = await keep();
	const file = `data/backups/${entry.name}`;
	assert.equal(await fileExists(api, file), true);
	const done = await admin.delete(`${BASE}/${entry.name}`);
	assert.equal(done.status, 200);
	assert.equal(done.body, true);
	assert.equal(await fileExists(api, file), false);
	assert.equal(
		(await admin.get(BASE)).body.some((row) => row.name === entry.name),
		false,
	);
	assert.equal((await admin.get(`${BASE}/${entry.name}`)).status, 404);
	assert.equal((await admin.delete(`${BASE}/${entry.name}`)).status, 404);
	const audit = await api.db("audit_log").where({ object_type: "backup", action: "deleted" });
	assert.equal(audit.length >= 1, true);
});

it("plans a merge of a backup: the host that was deleted is added, and the plan answers a hash", async () => {
	const host = await addHost("plan.example.com");
	const entry = await keep();
	assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
	const { token } = await inspect(entry.name);

	const plan = await admin.post(`${BASE}/restore/${token}/plan`, { mode: "merge", types: ["proxy_hosts"] });
	assert.equal(plan.status, 200, plan.text);
	const item = plan.body.items.find((row) => row.label === "plan.example.com");
	assert.equal(item.type, "proxy_hosts");
	assert.equal(item.action, "add");
	assert.equal(plan.body.counts.add >= 1, true);
	assert.match(plan.body.hash, /^[0-9a-f]{64}$/u);
	assert.deepEqual(plan.body.cleared_links, []);
	// the plan changes nothing
	assert.equal((await domains()).includes("plan.example.com"), false);

	const check = await admin.post(`${BASE}/restore/${token}/check`, { types: ["proxy_hosts"] });
	assert.equal(check.status, 200, check.text);
	assert.deepEqual(check.body, { references: [], skippedUsers: [], missingSecrets: [] });

	const merged = await admin.post(`${BASE}/restore/${token}`, {
		mode: "merge",
		types: ["proxy_hosts"],
		plan_hash: plan.body.hash,
	});
	assert.equal(merged.status, 200, merged.text);
	assert.equal((await domains()).includes("plan.example.com"), true);
	const audit = await api.db("audit_log").where({ object_type: "backup", action: "merged" }).first();
	assert.ok(audit);
	// the host that came back has a config again
	const row = await api.db("proxy_host").where({ npmpro_nginx_online: 1 }).orderBy("id", "desc").first();
	assert.equal(await fileExists(api, `data/nginx/proxy_host/${row.id}.conf`), true);
});

it("stops a merge whose instance changed since the plan, with 409 and the new plan, and applies nothing", async () => {
	const host = await addHost("clash.example.com");
	const entry = await keep();
	assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
	const { token } = await inspect(entry.name);
	const plan = await admin.post(`${BASE}/restore/${token}/plan`, { mode: "merge", types: ["proxy_hosts"] });
	const clashing = plan.body.items.find((row) => row.label === "clash.example.com");
	assert.equal(clashing.action, "add");

	await addHost("clash.example.com");
	const rows = await countRows(api, "proxy_host");
	const stale = await admin.post(`${BASE}/restore/${token}`, {
		mode: "merge",
		types: ["proxy_hosts"],
		plan_hash: plan.body.hash,
	});
	assert.equal(stale.status, 409, stale.text);
	assert.equal(stale.body.error.message_i18n, "backup.error.plan-changed");
	const changed = stale.body.error.plan.items.find((row) => row.label === "clash.example.com");
	assert.equal(changed.action, "skip");
	assert.equal(changed.reason, "domain-in-use");
	assert.notEqual(stale.body.error.plan.hash, plan.body.hash);
	assert.equal(await countRows(api, "proxy_host"), rows);

	// a merge needs the hash of a plan
	const noHash = await admin.post(`${BASE}/restore/${token}`, { mode: "merge", types: ["proxy_hosts"] });
	assert.equal(noHash.status, 400);
});

it("replaces whole parts on a restore that is confirmed, and refuses one that is not", async () => {
	const keepHost = await addHost("keep-me.example.com");
	const entry = await keep();
	const extra = await addHost("added-later.example.com");
	const { token } = await inspect(entry.name);
	const unconfirmed = await admin.post(`${BASE}/restore/${token}`, { types: ["proxy_hosts"] });
	assert.equal(unconfirmed.status, 400, unconfirmed.text);
	assert.equal((await domains()).includes("added-later.example.com"), true);
	for (const body of [
		{ types: [], confirm: true },
		{ types: ["audit_log"], confirm: true },
		{ types: ["proxy_hosts"], confirm: false },
		{ types: ["proxy_hosts"], confirm: true, mode: "merge" },
	]) {
		assert.equal((await admin.post(`${BASE}/restore/${token}`, body)).status, 400, JSON.stringify(body));
	}

	const done = await admin.post(`${BASE}/restore/${token}`, { types: ["proxy_hosts"], confirm: true });
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.counts.proxy_hosts >= 1, true);
	assert.equal(done.body.restartNeeded, false);
	assert.deepEqual(done.body.offlineHosts, []);
	const left = await domains();
	assert.equal(left.includes("keep-me.example.com"), true);
	assert.equal(left.includes("added-later.example.com"), false);
	assert.equal(await fileExists(api, `data/nginx/proxy_host/${extra.id}.conf`), false);
	assert.equal(await fileExists(api, `data/nginx/proxy_host/${keepHost.id}.conf`), true);
	// the instance is safe before the restore: an automatic backup was made first
	assert.equal(
		(await admin.get(BASE)).body.some((row) => row.auto),
		true,
	);
	const audit = await api.db("audit_log").where({ object_type: "backup", action: "restored" }).first();
	assert.ok(audit);
});

it("cancels a restore session, after which its token has expired", async () => {
	const entry = await keep();
	const { token } = await inspect(entry.name);
	const cancelled = await admin.delete(`${BASE}/restore/${token}`);
	assert.equal(cancelled.status, 200);
	assert.equal(cancelled.body, true);
	for (const [method, url, body] of [
		["post", `${BASE}/restore/${token}/plan`, { mode: "merge", types: ["proxy_hosts"] }],
		["post", `${BASE}/restore/${token}/check`, { types: ["proxy_hosts"] }],
		["post", `${BASE}/restore/${token}`, { types: ["proxy_hosts"], confirm: true }],
	]) {
		const done = await admin[method](url, body);
		assert.equal(done.status, 410, `${url}: ${done.text}`);
		assert.equal(done.body.error.message_i18n, "backup.error.token-expired");
	}
	assert.equal(
		(await admin.post(`${BASE}/restore/${token}/plan`, { mode: "replace", types: ["proxy_hosts"] })).status,
		400,
	);
});

it("previews and exports the items of a page, and imports the file on a page", async () => {
	const host = await addHost("export.example.com");
	const preview = await admin.post(`${BASE}/export/preview`, { kind: "proxy_hosts", ids: [host.id] });
	assert.equal(preview.status, 200, preview.text);
	assert.deepEqual(preview.body, {
		items: [{ id: host.id, label: "export.example.com" }],
		linked: [],
		secrets_allowed: true,
	});
	assert.equal((await admin.post(`${BASE}/export/preview`, { kind: "proxy_hosts" })).body.items.length >= 1, true);
	for (const body of [
		{},
		{ kind: "users" },
		{ kind: "proxy_hosts", ids: [0] },
		{ kind: "proxy_hosts", ids: [1, 1] },
	]) {
		assert.equal((await admin.post(`${BASE}/export/preview`, body)).status, 400, JSON.stringify(body));
	}

	const exported = await admin.post(`${BASE}/export`, {
		kind: "proxy_hosts",
		ids: [host.id],
		linked: {},
		secrets: false,
	});
	assert.equal(exported.status, 200, exported.text);
	assert.match(exported.body.name, /^npmpro-export-proxy-hosts-.+\.npmpro$/u);
	const file = await admin.get(`${BASE}/pending/${exported.body.pending}?name=${exported.body.name}`);
	assert.equal(file.status, 200);
	// an export is not stored on the server
	assert.equal(
		(await admin.get(BASE)).body.some((row) => row.name === exported.body.name),
		false,
	);
	for (const body of [
		{ kind: "proxy_hosts", ids: [host.id], secrets: false },
		{ kind: "proxy_hosts", ids: [], linked: {}, secrets: false },
		{ kind: "proxy_hosts", ids: [host.id], linked: {}, secrets: true, passphrase: "short" },
	]) {
		assert.equal((await admin.post(`${BASE}/export`, body)).status, 400, JSON.stringify(body));
	}

	const imported = await raw(admin, `${BASE}/import?kind=proxy_hosts`, file.bytes);
	assert.equal(imported.status, 200, imported.text);
	assert.equal(imported.body.encrypted, false);
	assert.equal(imported.body.summary.partial, true);
	assert.equal(imported.body.summary.counts.proxy_hosts, 1);
	const opened = await admin.post(`${BASE}/import/${imported.body.id}/open`, {});
	assert.equal(opened.status, 200, opened.text);
	assert.ok(opened.body.token);
	const plan = await admin.post(`${BASE}/restore/${opened.body.token}/plan`, {
		mode: "merge",
		types: ["proxy_hosts"],
	});
	const item = plan.body.items.find((row) => row.label === "export.example.com");
	assert.equal(item.action, "skip");
	assert.equal(item.reason, "domain-in-use");
	assert.deepEqual(item.choices, ["skip", "replace"]);

	assert.equal((await raw(admin, `${BASE}/import?kind=users`, file.bytes)).status, 400);
	assert.equal((await raw(admin, `${BASE}/import`, file.bytes)).status, 400);
	assert.equal((await raw(admin, `${BASE}/import?kind=proxy_hosts`, Buffer.from("junk"))).status, 400);
	assert.equal((await admin.post(`${BASE}/import/not-an-id/open`, {})).status, 410);
});

it("answers 401 without a session on every backup route", async () => {
	const none = api.client();
	for (const [method, url, body] of [
		["get", `${BASE}/types`],
		["get", BASE],
		["post", BASE, { types: ["proxy_hosts"], secrets: false, keep: true }],
		["get", `${BASE}/some.npmpro`],
		["delete", `${BASE}/some.npmpro`],
		["post", `${BASE}/some.npmpro/inspect`, {}],
		["get", `${BASE}/pending/x`],
		["post", `${BASE}/export/preview`, { kind: "proxy_hosts" }],
		["post", `${BASE}/export`, { kind: "proxy_hosts", ids: [1], linked: {}, secrets: false }],
		["post", `${BASE}/import/x/open`, {}],
		["post", `${BASE}/restore/x/plan`, { mode: "merge", types: ["proxy_hosts"] }],
		["post", `${BASE}/restore/x/check`, { types: ["proxy_hosts"] }],
		["post", `${BASE}/restore/x`, { types: ["proxy_hosts"], confirm: true }],
		["delete", `${BASE}/restore/x`],
	]) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
	}
	assert.equal((await raw(none, `${BASE}/upload`, Buffer.from("x"))).status, 401);
	assert.equal((await raw(none, `${BASE}/import?kind=proxy_hosts`, Buffer.from("x"))).status, 401);
});

it("keeps the whole-instance backup routes for administrators, and lets page users export and import", async () => {
	const entry = await keep();
	const viewer = await api.limited({
		visibility: "all",
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	const manager = await api.limited({
		visibility: "all",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const hidden = await api.limited({
		visibility: "all",
		proxy_hosts: "hidden",
		redirection_hosts: "hidden",
		dead_hosts: "hidden",
		streams: "hidden",
		access_lists: "hidden",
		certificates: "hidden",
	});
	const names = (await admin.get(BASE)).body.length;
	for (const session of [viewer, manager, hidden]) {
		for (const [method, url, body] of [
			["get", `${BASE}/types`],
			["get", BASE],
			["post", BASE, { types: ["proxy_hosts"], secrets: false, keep: true }],
			["get", `${BASE}/${entry.name}`],
			["delete", `${BASE}/${entry.name}`],
			["post", `${BASE}/${entry.name}/inspect`, {}],
		]) {
			assert.equal((await session[method](url, body)).status, 403, `${method} ${url}`);
		}
		assert.equal((await raw(session, `${BASE}/upload`, Buffer.from("x"))).status, 403);
	}
	// a restore session belongs to the administrator who opened it: another user can not plan with it, and a replace is for administrators
	const { token } = await inspect(entry.name);
	for (const session of [viewer, manager]) {
		const plan = await session.post(`${BASE}/restore/${token}/plan`, { mode: "merge", types: ["proxy_hosts"] });
		assert.equal(plan.status, 410);
		const restore = await session.post(`${BASE}/restore/${token}`, { types: ["proxy_hosts"], confirm: true });
		assert.equal(restore.status, 403);
	}
	assert.equal(
		(await admin.post(`${BASE}/restore/${token}/plan`, { mode: "merge", types: ["proxy_hosts"] })).status,
		200,
	);
	assert.equal((await admin.get(BASE)).body.length, names);

	// view permission exports, manage permission imports, hidden does neither
	assert.equal((await viewer.post(`${BASE}/export/preview`, { kind: "proxy_hosts" })).status, 200);
	assert.equal((await hidden.post(`${BASE}/export/preview`, { kind: "proxy_hosts" })).status, 403);
	const host = await addHost("page-user.example.com");
	const exported = await viewer.post(`${BASE}/export`, {
		kind: "proxy_hosts",
		ids: [host.id],
		linked: {},
		secrets: false,
	});
	assert.equal(exported.status, 200, exported.text);
	const file = await viewer.get(`${BASE}/pending/${exported.body.pending}?name=${exported.body.name}`);
	assert.equal(file.status, 200);
	assert.equal((await raw(viewer, `${BASE}/import?kind=proxy_hosts`, file.bytes)).status, 403);
	assert.equal((await raw(hidden, `${BASE}/import?kind=proxy_hosts`, file.bytes)).status, 403);
	const imported = await raw(manager, `${BASE}/import?kind=proxy_hosts`, file.bytes);
	assert.equal(imported.status, 200, imported.text);
});
