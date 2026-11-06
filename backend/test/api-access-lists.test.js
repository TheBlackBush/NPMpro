import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { countRows, fileExists, reloads } from "./support/hosts.js";

// /nginx/access-lists (schema/paths/nginx/access-lists): rules, the htpasswd file in data/access, and the hosts that use
// a list.

const BASE = "/nginx/access-lists";
const HOSTS = "/nginx/proxy-hosts";

let api;
let admin;
let names = 0;
let hosts = 0;

const name = () => {
	names += 1;
	return `List ${names}`;
};
const list = (overrides = {}) => ({
	name: name(),
	items: [{ username: "bob", password: "bobs-password-1" }],
	clients: [{ address: "10.1.0.0/16", directive: "allow" }],
	...overrides,
});
const create = async (body = list(), session = admin) => {
	const done = await session.post(BASE, body);
	assert.equal(done.status, 201, done.text);
	return done.body;
};
const addHost = async (lists, session = admin) => {
	hosts += 1;
	const done = await session.post(HOSTS, {
		domain_names: [`acl${hosts}.example.com`],
		forward_scheme: "http",
		forward_host: `10.0.2.${hosts}`,
		forward_port: 8080,
		npmpro_access_list_type: "custom",
		npmpro_access_list_ids: lists,
	});
	assert.equal(done.status, 201, done.text);
	return done.body;
};
const configOf = (host) => api.read(`data/nginx/proxy_host/${host.id}.conf`);

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("creates a list: 201, hashed passwords, a htpasswd file only the owner reads, an audit entry", async () => {
	const body = list({
		satisfy_any: true,
		pass_auth: true,
		clients: [
			{ address: "10.1.0.0/16", directive: "allow" },
			{ address: "all", directive: "deny" },
		],
	});
	const created = await create(body);
	assert.equal(created.name, body.name);
	assert.equal(created.satisfy_any, true);
	assert.equal(created.pass_auth, true);
	assert.equal(created.owner_user_id, 1);
	assert.equal(created.proxy_host_count, 0);
	assert.deepEqual(
		created.clients.map(({ address, directive }) => ({ address, directive })),
		body.clients,
	);
	assert.deepEqual(
		created.items.map((item) => item.username),
		["bob"],
	);
	assert.equal(JSON.stringify(created).includes("bobs-password-1"), false);

	const row = await api.db("access_list_auth").where({ access_list_id: created.id }).first();
	assert.match(row.password, /^\$2[aby]\$/u);
	const file = await api.read(`data/access/${created.id}`);
	assert.equal(file, `bob:${row.password}\n`);
	assert.equal(file.includes("bobs-password-1"), false);
	assert.equal((await stat(path.join(api.root, `data/access/${created.id}`))).mode & 0o077, 0);

	const audit = await api.db("audit_log").where({ object_type: "access-list", object_id: created.id }).first();
	assert.equal(audit.action, "created");
	assert.equal(audit.meta.includes("bobs-password-1"), false);
});

it("defaults satisfy_any and pass_auth to false, and drops rules without an address", async () => {
	const created = await create({
		name: name(),
		clients: [
			{ address: "192.168.0.0/24", directive: "allow" },
			{ address: "", directive: "allow" },
		],
	});
	assert.equal(created.satisfy_any, false);
	assert.equal(created.pass_auth, false);
	assert.equal(created.clients.length, 1);
	assert.deepEqual(created.items, []);
	assert.equal(await api.read(`data/access/${created.id}`), "");
});

it("refuses invalid bodies with 400 and writes nothing", async () => {
	const rows = await countRows(api, "access_list");
	const cases = {
		"no name": { items: list().items },
		"empty name": list({ name: "" }),
		"name above 255 characters": list({ name: "x".repeat(256) }),
		"unknown field": list({ extra: true }),
		"satisfy_any as text": list({ satisfy_any: "yes" }),
		"user without username": list({ items: [{ password: "x" }] }),
		"username with a colon": list({ items: [{ username: "a:b", password: "x" }] }),
		"unknown directive": list({ clients: [{ address: "10.0.0.1", directive: "permit" }] }),
		"client without a directive": list({ clients: [{ address: "10.0.0.1" }] }),
	};
	for (const [label, body] of Object.entries(cases)) {
		const done = await admin.post(BASE, body);
		assert.equal(done.status, 400, `${label}: ${done.text}`);
	}
	assert.equal(await countRows(api, "access_list"), rows);
});

it("refuses users without a password, long passwords, a list without rules, repeated names and a misplaced all rule", async () => {
	const rows = await countRows(api, "access_list");
	const refused = async (body, i18n) => {
		const done = await admin.post(BASE, body);
		assert.equal(done.status, 400, done.text);
		if (i18n) assert.equal(done.body.error.message_i18n, i18n);
		return done.body.error.message;
	};
	assert.match(await refused(list({ items: [{ username: "bob", password: "" }] })), /need a password/u);
	assert.match(await refused(list({ items: [{ username: "bob", password: "x".repeat(73) }] })), /72 bytes/u);
	// 72 bytes is the limit, and it counts bytes, not characters
	assert.match(await refused(list({ items: [{ username: "bob", password: "é".repeat(37) }] })), /72 bytes/u);
	assert.match(
		await refused({ name: name(), items: [], clients: [{ address: "all", directive: "allow" }] }),
		/at least one user/u,
	);
	assert.match(await refused({ name: name() }), /at least one user/u);
	await refused(
		list({
			items: [
				{ username: "bob", password: "a" },
				{ username: "bob", password: "b" },
			],
		}),
		"error.access.duplicate-usernames",
	);
	await refused(
		list({
			clients: [
				{ address: "all", directive: "deny" },
				{ address: "10.0.0.1", directive: "allow" },
			],
		}),
		"error.access.all-rule-last",
	);
	assert.equal(await countRows(api, "access_list"), rows);
	const ok = await admin.post(BASE, list({ items: [{ username: "bob", password: "é".repeat(36) }] }));
	assert.equal(ok.status, 201, ok.text);
});

it("lists, searches and expands lists, sorted by name", async () => {
	const zed = await create(list({ name: "Zed list" }));
	const alpha = await create(list({ name: "Alpha list" }));
	const all = await admin.get(BASE);
	assert.equal(all.status, 200);
	const listed = all.body.map((row) => row.name);
	assert.deepEqual(
		listed,
		[...listed].sort((a, b) => a.localeCompare(b)),
	);
	assert.equal(all.body.find((row) => row.id === alpha.id).items, undefined);
	assert.equal(all.text.includes("bobs-password-1"), false);

	const found = await admin.get(`${BASE}?query=${encodeURIComponent("Alpha")}`);
	assert.deepEqual(
		found.body.map((row) => row.id),
		[alpha.id],
	);
	const expanded = await admin.get(`${BASE}?expand=items,clients,owner&query=Zed`);
	assert.equal(expanded.body[0].id, zed.id);
	assert.equal(expanded.body[0].items[0].username, "bob");
	assert.equal(expanded.body[0].clients.length, 1);
	assert.equal(expanded.body[0].owner.email, "admin@example.com");
	assert.equal((await admin.get(`${BASE}?expand=proxy_hosts`)).status, 400);

	const one = await admin.get(`${BASE}/${zed.id}?expand=items,clients`);
	assert.equal(one.status, 200);
	assert.equal(one.body.name, "Zed list");
	assert.equal(one.body.items.length, 1);
	assert.equal((await admin.get(`${BASE}/${zed.id}`)).body.items, undefined);
	assert.equal((await admin.get(`${BASE}/${zed.id}?expand=owner`)).status, 400);
	assert.equal((await admin.get(`${BASE}/999999`)).status, 404);
});

it("answers a path id that is not a positive integer with 400, on every method", async () => {
	for (const id of ["0", "-1", "abc", "1.5", "1abc", "1e3"]) {
		for (const [method, body] of [["get"], ["put", { name: "x" }], ["delete"]]) {
			const done = await admin[method](`${BASE}/${id}`, body);
			assert.equal(done.status, 400, `${method} ${id}: ${done.text}`);
		}
	}
});

it("updates name and flags, and keeps the users and rules the body leaves out", async () => {
	const created = await create();
	const done = await admin.put(`${BASE}/${created.id}`, { name: "Renamed", satisfy_any: true, pass_auth: true });
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.name, "Renamed");
	assert.equal(done.body.satisfy_any, true);
	assert.equal(done.body.pass_auth, true);
	assert.equal(done.body.items.length, 1);
	assert.equal(done.body.clients.length, 1);
	assert.equal(done.body.proxy_hosts, undefined);
	assert.equal((await api.db("access_list").where({ id: created.id }).first()).name, "Renamed");
	const audit = await api
		.db("audit_log")
		.where({ object_type: "access-list", object_id: created.id, action: "updated" });
	assert.equal(audit.length, 1);
});

it("rewrites the users: a user sent without a password keeps its hash, new users need one, missing users go", async () => {
	const created = await create(
		list({
			items: [
				{ username: "bob", password: "bobs-password-1" },
				{ username: "carol", password: "carols-password-1" },
			],
		}),
	);
	const before_ = await api.db("access_list_auth").where({ access_list_id: created.id });
	const bobHash = before_.find((row) => row.username === "bob").password;

	const newcomer = await admin.put(`${BASE}/${created.id}`, { items: [{ username: "dave", password: "" }] });
	assert.equal(newcomer.status, 400, newcomer.text);
	assert.match(newcomer.body.error.message, /need a password/u);
	const long = await admin.put(`${BASE}/${created.id}`, { items: [{ username: "bob", password: "x".repeat(73) }] });
	assert.equal(long.status, 400);

	const done = await admin.put(`${BASE}/${created.id}`, {
		items: [
			{ username: "bob", password: "" },
			{ username: "dave", password: "daves-password-1" },
		],
	});
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.items.map((item) => item.username).sort(), ["bob", "dave"]);
	const rows = await api.db("access_list_auth").where({ access_list_id: created.id });
	assert.equal(rows.find((row) => row.username === "bob").password, bobHash);
	assert.match(rows.find((row) => row.username === "dave").password, /^\$2[aby]\$/u);
	const file = await api.read(`data/access/${created.id}`);
	assert.match(file, new RegExp(`^bob:${bobHash.replaceAll("$", "\\$")}$`, "mu"));
	assert.match(file, /^dave:/mu);
	assert.doesNotMatch(file, /carol/u);

	const changed = await admin.put(`${BASE}/${created.id}`, {
		items: [{ username: "bob", password: "new-password-2" }],
	});
	assert.equal(changed.status, 200, changed.text);
	assert.notEqual(
		(await api.db("access_list_auth").where({ access_list_id: created.id, username: "bob" }).first()).password,
		bobHash,
	);
});

it("replaces the rules on update, and refuses an update that leaves no user and no rule", async () => {
	const created = await create();
	const done = await admin.put(`${BASE}/${created.id}`, {
		clients: [
			{ address: "172.16.0.0/12", directive: "allow" },
			{ address: "all", directive: "deny" },
		],
	});
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(
		done.body.clients.map(({ address }) => address),
		["172.16.0.0/12", "all"],
	);
	assert.equal((await api.db("access_list_client").where({ access_list_id: created.id })).length, 2);

	const misplaced = await admin.put(`${BASE}/${created.id}`, {
		clients: [
			{ address: "all", directive: "deny" },
			{ address: "10.0.0.1", directive: "allow" },
		],
	});
	assert.equal(misplaced.status, 400);
	assert.equal(misplaced.body.error.message_i18n, "error.access.all-rule-last");
	const duplicate = await admin.put(`${BASE}/${created.id}`, {
		items: [
			{ username: "x", password: "a" },
			{ username: "x", password: "b" },
		],
	});
	assert.equal(duplicate.body.error.message_i18n, "error.access.duplicate-usernames");

	const empty = await admin.put(`${BASE}/${created.id}`, { items: [], clients: [] });
	assert.equal(empty.status, 400, empty.text);
	assert.match(empty.body.error.message, /at least one user/u);
	assert.equal((await api.db("access_list_auth").where({ access_list_id: created.id })).length, 1);
	assert.equal((await admin.put(`${BASE}/${created.id}`, { extra: 1 })).status, 400);
	assert.equal((await admin.put(`${BASE}/999999`, { name: "x" })).status, 404);
});

it("gives a host that uses a list a new config when the list changes, and counts the host", async () => {
	const created = await create();
	const host = await addHost([created.id]);
	assert.equal((await admin.get(`${BASE}/${created.id}`)).body.proxy_host_count, 1);
	const first = await configOf(host);
	assert.match(first, new RegExp(`auth_basic_user_file\\s+/data/access/${created.id};`, "u"));
	assert.match(first, /allow 10\.1\.0\.0\/16;/u);
	assert.doesNotMatch(first, /satisfy any;/u);

	await api.outside.clearCalls();
	const reloadsBefore = reloads(api);
	const done = await admin.put(`${BASE}/${created.id}`, {
		satisfy_any: true,
		clients: [{ address: "192.168.7.0/24", directive: "allow" }],
	});
	assert.equal(done.status, 200, done.text);
	const second = await configOf(host);
	assert.match(second, /satisfy any;/u);
	assert.match(second, /allow 192\.168\.7\.0\/24;/u);
	assert.doesNotMatch(second, /10\.1\.0\.0/u);
	assert.equal(reloads(api), reloadsBefore + 1);
	assert.equal((await api.db("proxy_host").where({ id: host.id }).first()).npmpro_nginx_online, 1);
});

it("deletes a list: files and rows go, hosts that used it become public and get a new config", async () => {
	const keep = await create();
	const doomed = await create();
	const host = await addHost([doomed.id, keep.id]);
	const only = await addHost([doomed.id]);
	assert.match(await configOf(only), /auth_basic_user_file/u);

	const reloadsBefore = reloads(api);
	const done = await admin.delete(`${BASE}/${doomed.id}`);
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.id, doomed.id);
	assert.equal(done.body.proxy_hosts, undefined);
	assert.equal(await fileExists(api, `data/access/${doomed.id}`), false);
	assert.equal(await fileExists(api, `data/access/${keep.id}`), true);
	for (const table of ["access_list", "access_list_auth", "access_list_client"]) {
		const column = table === "access_list" ? "id" : "access_list_id";
		assert.equal((await api.db(table).where({ [column]: doomed.id })).length, 0, table);
	}
	assert.equal((await api.db("npmpro_proxy_host_access_list").where({ access_list_id: doomed.id })).length, 0);
	assert.equal((await admin.get(`${BASE}/${doomed.id}`)).status, 404);

	const publicRow = await api.db("proxy_host").where({ id: only.id }).first();
	assert.equal(publicRow.npmpro_access_list_type, "public");
	assert.doesNotMatch(await configOf(only), /auth_basic_user_file|allow 10\.1/u);
	const stillCustom = await api.db("proxy_host").where({ id: host.id }).first();
	assert.equal(stillCustom.npmpro_access_list_type, "custom");
	assert.match(await configOf(host), /auth_basic_user_file/u);
	assert.equal(reloads(api), reloadsBefore + 1);

	const audit = await api
		.db("audit_log")
		.where({ object_type: "access-list", object_id: doomed.id, action: "deleted" });
	assert.equal(audit.length, 1);
	assert.equal((await admin.delete(`${BASE}/${doomed.id}`)).status, 404);
});

it("resets a custom location to the host's list when its own list is deleted", async () => {
	const own = await create();
	hosts += 1;
	const host = await admin.post(HOSTS, {
		domain_names: [`acl-loc${hosts}.example.com`],
		forward_scheme: "http",
		forward_host: "10.0.3.1",
		forward_port: 8080,
		locations: [
			{
				path: "/private",
				forward_scheme: "http",
				forward_host: "10.0.3.2",
				forward_port: 9000,
				npmpro_access_list_type: "custom",
				npmpro_access_list_ids: [own.id],
			},
		],
	});
	assert.equal(host.status, 201, host.text);
	assert.match(await configOf(host.body), /auth_basic_user_file/u);
	assert.equal((await admin.delete(`${BASE}/${own.id}`)).status, 200);
	const location = await api.db("npmpro_location").where({ proxy_host_id: host.body.id }).first();
	assert.equal(location.npmpro_access_list_type, "global");
	assert.doesNotMatch(await configOf(host.body), /auth_basic_user_file/u);
});

it("answers 401 without a session on every access list route", async () => {
	const none = api.client();
	for (const [method, url, body] of [
		["get", BASE],
		["post", BASE, list()],
		["get", `${BASE}/1`],
		["put", `${BASE}/1`, { name: "x" }],
		["delete", `${BASE}/1`],
	]) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
	}
});

it("refuses a user without the permission: hidden sees nothing, view-only reads but cannot write", async () => {
	const created = await create();
	const hidden = await api.limited({ visibility: "all", access_lists: "hidden" });
	const viewer = await api.limited({ visibility: "all", access_lists: "view" });
	const rows = await countRows(api, "access_list");
	for (const [method, url, body] of [
		["get", BASE],
		["get", `${BASE}/${created.id}`],
		["post", BASE, list()],
		["put", `${BASE}/${created.id}`, { name: "denied" }],
		["delete", `${BASE}/${created.id}`],
	]) {
		assert.equal((await hidden[method](url, body)).status, 403, `hidden ${method} ${url}`);
	}
	assert.equal((await viewer.get(BASE)).status, 200);
	assert.equal((await viewer.get(`${BASE}/${created.id}`)).status, 200);
	for (const [method, url, body] of [
		["post", BASE, list()],
		["put", `${BASE}/${created.id}`, { name: "denied" }],
		["delete", `${BASE}/${created.id}`],
	]) {
		assert.equal((await viewer[method](url, body)).status, 403, `view ${method} ${url}`);
	}
	assert.equal(await countRows(api, "access_list"), rows);
	assert.notEqual((await api.db("access_list").where({ id: created.id }).first()).name, "denied");
	assert.equal(await fileExists(api, `data/access/${created.id}`), true);
});

it("shows a user with the visibility user only their own lists", async () => {
	const own = await api.limited({ visibility: "user", access_lists: "manage" });
	const mine = await create(list(), own);
	assert.equal(mine.owner_user_id, own.user.id);
	const foreign = await create();
	assert.deepEqual(
		(await own.get(BASE)).body.map((row) => row.id),
		[mine.id],
	);
	assert.equal((await own.get(`${BASE}/${foreign.id}`)).status, 404);
	assert.equal((await own.put(`${BASE}/${foreign.id}`, { name: "taken over" })).status, 404);
	assert.equal((await own.delete(`${BASE}/${foreign.id}`)).status, 404);
	assert.notEqual((await api.db("access_list").where({ id: foreign.id }).first()).name, "taken over");
	assert.equal(await fileExists(api, `data/access/${foreign.id}`), true);
	assert.equal((await own.delete(`${BASE}/${mine.id}`)).status, 200);
});
