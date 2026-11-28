import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { countRows, fileExists, reloads } from "./support/hosts.js";
import { withDatabaseType } from "./support/mmdb.js";

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

it("never returns a user's password hash: create, update, get and list", async () => {
	const created = await create();
	const hash = (await api.db("access_list_auth").where({ access_list_id: created.id }).first()).password;
	assert.equal(hash.startsWith("$2"), true);
	const updated = await admin.put(`${BASE}/${created.id}`, {
		items: [
			{ username: "bob", password: "" },
			{ username: "erin", password: "erins-password-1" },
		],
	});
	assert.equal(updated.status, 200, updated.text);
	const answers = [
		created,
		updated.body,
		(await admin.get(`${BASE}/${created.id}?expand=items,clients`)).body,
		(await admin.get(`${BASE}?expand=items,clients`)).body.find((row) => row.id === created.id),
	];
	for (const answer of answers) {
		assert.notEqual(answer.items.length, 0);
		for (const item of answer.items) {
			assert.equal(typeof item.username, "string");
			assert.equal(Object.hasOwn(item, "password"), false);
		}
		assert.equal(JSON.stringify(answer).includes("$2"), false);
	}
	// the stored hash and the htpasswd file are untouched
	assert.equal(
		(await api.db("access_list_auth").where({ access_list_id: created.id, username: "bob" }).first()).password,
		hash,
	);
	assert.equal((await api.read(`data/access/${created.id}`)).split("\n").includes(`bob:${hash}`), true);
});

// country rules and rule comments
const GEOIP = "data/goaccess/geoip/dbip-country-lite.mmdb";
const countryList = (overrides = {}) => ({
	name: name(),
	npmpro_geo_mode: "allow",
	npmpro_countries: [
		{ country: "FR", npmpro_comment: "France office" },
		{ country: "DE", npmpro_comment: "" },
	],
	...overrides,
});
const giveDatabase = async () => {
	const fixture = await readFile(path.join(import.meta.dirname, "fixtures", "GeoLite2-Country-Test.mmdb"));
	await writeFile(path.join(api.root, GEOIP), withDatabaseType(fixture, "DBIP-Country-Lite"));
};
const takeDatabase = () => rm(path.join(api.root, GEOIP), { force: true });
const countryRowsOf = async (id) =>
	Number((await api.db("npmpro_access_list_country").where({ access_list_id: id }).count({ n: "*" }).first()).n);
const countryCodes = (row) => row.npmpro_countries.map(({ country }) => country);
const errorKey = (done) => done.body.error?.message_i18n;
const NOW = () => new Date().toISOString();
const storedList = async (mode, ...codes) => {
	const [id] = await api.db("access_list").insert({
		name: name(),
		owner_user_id: 1,
		npmpro_geo_mode: mode,
		created_on: new Date().toISOString(),
		modified_on: new Date().toISOString(),
		meta: "{}",
	});
	await api.db("access_list_client").insert({
		access_list_id: id,
		address: "10.0.0.0/8",
		directive: "allow",
		created_on: NOW(),
		modified_on: NOW(),
		meta: "{}",
	});
	for (const country of codes) {
		await api.db("npmpro_access_list_country").insert({
			access_list_id: id,
			country,
			npmpro_comment: "",
			created_on: NOW(),
			modified_on: NOW(),
		});
	}
	return id;
};

it("country rules: a round trip with comments, sorted countries, kept and replaced by a PUT", async () => {
	await giveDatabase();
	const created = await create(
		countryList({ clients: [{ address: "10.1.0.0/16", directive: "allow", npmpro_comment: "VPN" }] }),
	);
	assert.equal(created.npmpro_geo_mode, "allow");
	assert.deepEqual(countryCodes(created), ["DE", "FR"]);
	const read = (await admin.get(`${BASE}/${created.id}?expand=clients,npmpro_countries`)).body;
	assert.deepEqual(
		read.npmpro_countries.map(({ country, npmpro_comment }) => [country, npmpro_comment]),
		[
			["DE", ""],
			["FR", "France office"],
		],
	);
	assert.equal(read.clients[0].npmpro_comment, "VPN");
	assert.equal(read.npmpro_geo_unknown, "auto");
	assert.equal(read.npmpro_geo_drop, false);

	const renamed = await admin.put(`${BASE}/${created.id}`, { name: "renamed countries", npmpro_geo_drop: true });
	assert.equal(renamed.status, 200, renamed.text);
	assert.deepEqual(countryCodes(renamed.body), ["DE", "FR"]);
	assert.equal(renamed.body.npmpro_geo_drop, true);

	const replaced = await admin.put(`${BASE}/${created.id}`, { npmpro_countries: [{ country: "DE" }] });
	assert.equal(replaced.status, 200, replaced.text);
	assert.deepEqual(countryCodes(replaced.body), ["DE"]);
	assert.equal(await countryRowsOf(created.id), 1);
	const listed = (await admin.get(`${BASE}?expand=npmpro_countries`)).body.find((row) => row.id === created.id);
	assert.deepEqual(countryCodes(listed), ["DE"]);
});

it("country rules: the schema and the checks refuse bad codes, empty modes and too many countries", async () => {
	await giveDatabase();
	const lower = await admin.post(BASE, countryList({ npmpro_countries: [{ country: "de" }] }));
	assert.equal(lower.status, 400);
	const unknown = await admin.post(BASE, countryList({ npmpro_countries: [{ country: "QQ" }] }));
	assert.equal(unknown.status, 400);
	assert.equal(errorKey(unknown), "error.access.country-unknown");
	assert.deepEqual(unknown.body.error.message_values, { code: "QQ" });
	const twice = await admin.post(BASE, countryList({ npmpro_countries: [{ country: "DE" }, { country: "DE" }] }));
	assert.equal(twice.status, 400);
	assert.equal(errorKey(twice), "error.access.country-duplicate");
	const many = await admin.post(
		BASE,
		countryList({ npmpro_countries: Array.from({ length: 251 }, () => ({ country: "DE" })) }),
	);
	assert.equal(many.status, 400);
	const empty = await admin.post(BASE, countryList({ npmpro_countries: [] }));
	assert.equal(empty.status, 400);
	assert.equal(errorKey(empty), "error.access.country-mode-empty");
	const onlyCountries = await admin.post(BASE, countryList());
	assert.equal(onlyCountries.status, 201, onlyCountries.text);
});

it("country rules without a usable database: keeping and removing pass, turning on or adding does not (rule 6)", async () => {
	await takeDatabase();
	const refused = await admin.post(BASE, countryList());
	assert.equal(refused.status, 400);
	assert.equal(errorKey(refused), "error.access.country-no-database");

	const id = await storedList("deny", "US", "ZZ");
	const url = `${BASE}/${id}`;
	const renamed = await admin.put(url, { name: "kept countries" });
	assert.equal(renamed.status, 200, renamed.text);
	assert.deepEqual(countryCodes(renamed.body), ["US", "ZZ"]);
	const dropped = await admin.put(url, { npmpro_geo_drop: true });
	assert.equal(dropped.status, 200, dropped.text);
	const sentBack = await admin.put(url, { npmpro_countries: [{ country: "US" }, { country: "ZZ" }] });
	assert.equal(sentBack.status, 200, sentBack.text);
	assert.deepEqual(countryCodes(sentBack.body), ["US", "ZZ"]);

	const switched = await admin.put(url, { npmpro_geo_mode: "allow" });
	assert.equal(switched.status, 400);
	assert.equal(errorKey(switched), "error.access.country-no-database");
	const added = await admin.put(url, { npmpro_countries: [{ country: "US" }, { country: "CA" }] });
	assert.equal(added.status, 400);
	assert.equal(errorKey(added), "error.access.country-no-database");

	const removed = await admin.put(url, { npmpro_countries: [{ country: "ZZ" }], npmpro_geo_mode: "off" });
	assert.equal(removed.status, 200, removed.text);
	assert.equal(removed.body.npmpro_geo_mode, "off");
	assert.deepEqual(countryCodes(removed.body), ["ZZ"]);
});

it("GET /nginx/access-lists/geoip: availability, custom directive and the lists with a mode", async () => {
	await takeDatabase();
	const custom = path.join(api.root, "data/custom_nginx/http_top.conf");
	await rm(custom, { force: true });
	const without = (await admin.get(`${BASE}/geoip`)).body;
	assert.equal(without.available, false);
	assert.equal(without.fails_open, true);
	assert.equal(without.custom_directive, false);
	assert.equal(without.provider, "dbip");
	await giveDatabase();
	// geoip.conf as a sync leaves it: the database line, or the off variant after nginx refused that line
	const geoipConf = path.join(api.root, "data/npmpro/nginx/geoip.conf");
	const confBefore = await readFile(geoipConf, "utf8");
	await writeFile(
		geoipConf,
		"geoip_country /data/goaccess/geoip/dbip-country-lite.mmdb;\ngeo $npmpro_geo_db {\n  default 1;\n}\n",
	);
	const withFile = (await admin.get(`${BASE}/geoip`)).body;
	assert.equal(withFile.available, true);
	assert.equal(withFile.fails_open, false);
	await writeFile(
		geoipConf,
		"# no usable GeoIP country database: country rules of access lists let every visitor pass (Settings, GeoIP)\ngeo $npmpro_geo_db {\n  default 0;\n}\n",
	);
	const refused = (await admin.get(`${BASE}/geoip`)).body;
	assert.deepEqual([refused.available, refused.fails_open], [true, true]);
	await writeFile(geoipConf, confBefore);
	assert.equal(
		withFile.lists_with_rules,
		Number((await api.db("access_list").whereNot("npmpro_geo_mode", "off").count({ n: "*" }).first()).n),
	);
	await takeDatabase();
	await mkdir(path.dirname(custom), { recursive: true });
	await writeFile(custom, "geoip_country /x/y.mmdb { $geoip2_country_code country iso_code; }\n");
	const withDirective = (await admin.get(`${BASE}/geoip`)).body;
	assert.equal(withDirective.available, true);
	assert.equal(withDirective.custom_directive, true);
	await rm(custom, { force: true });

	const hidden = await api.limited({ visibility: "all", access_lists: "hidden" });
	assert.equal((await hidden.get(`${BASE}/geoip`)).status, 403);
	const viewer = await api.limited({ visibility: "all", access_lists: "view" });
	assert.equal((await viewer.get(`${BASE}/geoip`)).status, 200);
});

it("deleting a list removes its country rows without the database cascade", async () => {
	await giveDatabase();
	const created = await create(countryList());
	assert.equal(await countryRowsOf(created.id), 2);
	assert.equal((await admin.delete(`${BASE}/${created.id}`)).status, 200);
	assert.equal(await countryRowsOf(created.id), 0);
});

it("a list with only countries and no usable database cannot lose its last rule, but saves with one IP rule", async () => {
	await giveDatabase();
	const created = await create(countryList());
	await takeDatabase();
	const url = `${BASE}/${created.id}`;
	const off = await admin.put(url, { npmpro_geo_mode: "off" });
	assert.equal(off.status, 400);
	assert.equal(off.body.error.message, "Access list needs at least one user or one rule that is not all");
	const emptied = await admin.put(url, { npmpro_countries: [] });
	assert.equal(emptied.status, 400);
	assert.equal(errorKey(emptied), "error.access.country-mode-empty");
	assert.deepEqual(countryCodes((await admin.get(`${url}?expand=npmpro_countries`)).body), ["DE", "FR"]);
	const saved = await admin.put(url, {
		npmpro_geo_mode: "off",
		clients: [{ address: "10.2.0.0/16", directive: "allow" }],
	});
	assert.equal(saved.status, 200, saved.text);
	assert.equal(saved.body.npmpro_geo_mode, "off");
});

it("lists_with_rules counts only the lists a user with the visibility user owns", async () => {
	await giveDatabase();
	const own = await api.limited({ visibility: "user", access_lists: "manage" });
	const mine = await create(countryList(), own);
	await create(countryList());
	const seen = await own.get(`${BASE}/geoip`);
	assert.equal(seen.status, 200);
	assert.equal(seen.body.lists_with_rules, 1);
	const all = (await admin.get(`${BASE}/geoip`)).body.lists_with_rules;
	assert.ok(all >= 2);
	assert.equal((await own.delete(`${BASE}/${mine.id}`)).status, 200);
	assert.equal((await own.get(`${BASE}/geoip`)).body.lists_with_rules, 0);
});

it("trims the comment of a rule and of a country on save", async () => {
	await giveDatabase();
	const created = await create(
		countryList({
			npmpro_countries: [{ country: "FR", npmpro_comment: "  Paris  " }],
			clients: [{ address: "10.3.0.0/16", directive: "allow", npmpro_comment: "  VPN  " }],
		}),
	);
	const read = (await admin.get(`${BASE}/${created.id}?expand=clients,npmpro_countries`)).body;
	assert.equal(read.npmpro_countries[0].npmpro_comment, "Paris");
	assert.equal(read.clients[0].npmpro_comment, "VPN");
});
