import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import knexFactory from "knex";
import { loadStageData, previewReplace, replaceTypes, sequenceResetQuery } from "../lib/backup/restore-db.js";

process.env.TZ = "UTC";

const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };
const NOW = 1_800_000_000;
const CONSTRAINT = /UNIQUE|PRIMARY/u;
const INVALID_ID = /invalid id/u;

const sqlite = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await knex.schema.createTable("user", (t) => {
		t.increments("id");
		t.dateTime("created_on");
		t.string("email").notNull();
		t.string("name").notNull();
		t.json("roles").notNull();
		t.integer("is_disabled").notNull().defaultTo(0);
		t.string("avatar").notNull().defaultTo("");
		t.integer("npmpro_token_valid_after").notNull().defaultTo(0);
	});
	await knex.schema.createTable("auth", (t) => {
		t.increments("id");
		t.integer("user_id").notNull();
		t.string("type").notNull();
		t.string("secret").notNull();
		t.json("meta").notNull();
	});
	await knex.schema.createTable("user_permission", (t) => {
		t.increments("id");
		t.integer("user_id").notNull();
		t.string("visibility").notNull();
		t.unique("user_id");
	});
	await knex.schema.createTable("proxy_host", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull();
		t.json("domain_names").notNull();
		t.integer("certificate_id").notNull().defaultTo(0);
		t.integer("npmpro_mtls_certificate_id").notNull().defaultTo(0);
		t.json("meta").notNull();
	});
	await knex.schema.createTable("npmpro_location", (t) => {
		t.increments("id");
		t.integer("proxy_host_id").notNull();
		t.text("path").notNull();
	});
	await knex.schema.createTable("npmpro_proxy_host_access_list", (t) => {
		t.integer("proxy_host_id").notNull();
		t.integer("location_id").notNull().defaultTo(0);
		t.integer("access_list_id").notNull();
		t.integer("position").notNull().defaultTo(0);
		t.primary(["proxy_host_id", "location_id", "access_list_id"]);
	});
	await knex.schema.createTable("certificate", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull();
		t.string("nice_name").notNull();
		t.json("domain_names").notNull();
		t.json("meta").notNull();
		t.integer("npmpro_dns_credential_id").nullable();
	});
	await knex.schema.createTable("npmpro_dns_credential", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull();
		t.string("name").notNull();
		t.text("values").notNull();
		t.unique(["owner_user_id", "name"]);
	});
	await knex.schema.createTable("setting", (t) => {
		t.string("id").primary();
		t.string("name").notNull();
		t.json("meta").notNull();
	});
	await knex("user").insert([
		{ id: 1, email: "admin@example.com", name: "Admin", roles: '["admin"]', npmpro_token_valid_after: 5 },
		{ id: 2, email: "old@example.com", name: "Old", roles: "[]", npmpro_token_valid_after: 0 },
	]);
	await knex("auth").insert([
		{ id: 1, user_id: 1, type: "password", secret: "admin-hash", meta: "{}" },
		{ id: 2, user_id: 2, type: "password", secret: "old-hash", meta: "{}" },
	]);
	await knex("user_permission").insert([
		{ id: 1, user_id: 1, visibility: "all" },
		{ id: 2, user_id: 2, visibility: "user" },
	]);
	await knex("certificate").insert({ id: 3, owner_user_id: 1, nice_name: "kept", domain_names: "[]", meta: "{}" });
	await knex("proxy_host").insert([
		{ id: 1, owner_user_id: 1, domain_names: '["one.example.com"]', meta: "{}" },
		{ id: 2, owner_user_id: 2, domain_names: '["two.example.com"]', meta: "{}" },
	]);
	await knex("setting").insert([
		{ id: "oidc", name: "OIDC", meta: '{"enabled":false}' },
		{ id: "default-site", name: "Default", meta: '{"page":"congratulations"}' },
	]);
	return knex;
};

const host = (id, extra = {}) => ({
	id,
	owner_user_id: 1,
	domain_names: [`h${id}.example.com`],
	certificate_id: 0,
	npmpro_mtls_certificate_id: 0,
	meta: {},
	...extra,
});

const hostsData = (hosts, extra = {}) => ({
	proxy_hosts: { proxy_host: hosts, npmpro_location: [], npmpro_proxy_host_access_list: [], ...extra },
});

it("replaces proxy hosts with their ids and clears a certificate that does not exist", async () => {
	const knex = await sqlite();
	const data = hostsData([host(5, { certificate_id: 3 }), host(7, { certificate_id: 9 })]);
	const result = await replaceTypes({ knex, data, types: ["proxy_hosts"], adminUserId: 1, box, now: NOW });
	const rows = await knex("proxy_host").orderBy("id");
	assert.deepEqual(
		rows.map((row) => [row.id, row.certificate_id, JSON.parse(row.domain_names)[0]]),
		[
			[5, 3, "h5.example.com"],
			[7, 0, "h7.example.com"],
		],
	);
	assert.deepEqual(
		result.references.map((change) => [change.table, change.id, change.column, change.to]),
		[["proxy_host", 7, "certificate_id", 0]],
	);
	assert.deepEqual(result.counts, { proxy_hosts: 2 });
	await knex.destroy();
});

it("replaces the locations and access list links with the proxy hosts and drops links to missing lists", async () => {
	const knex = await sqlite();
	await knex("npmpro_location").insert({ id: 4, proxy_host_id: 1, path: "/old" });
	await knex("npmpro_proxy_host_access_list").insert({ proxy_host_id: 1, location_id: 0, access_list_id: 1 });
	const data = hostsData([host(5)], {
		npmpro_location: [{ id: 6, proxy_host_id: 5, path: "/new" }],
		npmpro_proxy_host_access_list: [{ proxy_host_id: 5, location_id: 0, access_list_id: 8, position: 0 }],
	});
	await replaceTypes({ knex, data, types: ["proxy_hosts"], adminUserId: 1, box, now: NOW });
	assert.deepEqual(
		(await knex("npmpro_location")).map((row) => [row.id, row.path]),
		[[6, "/new"]],
	);
	assert.equal((await knex("npmpro_proxy_host_access_list")).length, 0);
	await knex.destroy();
});

const usersData = () => ({
	users: {
		user: [
			{
				id: 1,
				email: "someone@example.com",
				name: "Backup One",
				roles: [],
				avatar: "/images/avatar/1.png?v=7",
				npmpro_token_valid_after: 0,
			},
			{ id: 4, email: "ADMIN@example.com", name: "Backup Admin", roles: ["admin"], npmpro_token_valid_after: 0 },
			{ id: 6, email: "six@example.com", name: "Six", roles: [], npmpro_token_valid_after: 0 },
		],
		auth: [
			{ id: 1, user_id: 1, type: "password", secret: "one-hash", meta: {} },
			{ id: 3, user_id: 4, type: "password", secret: "backup-admin-hash", meta: {} },
			{ id: 4, user_id: 6, type: "totp", secret: "BASE32", meta: {} },
			{ id: 5, user_id: 9, type: "password", secret: "orphan", meta: {} },
		],
		user_permission: [
			{ id: 1, user_id: 1, visibility: "user" },
			{ id: 3, user_id: 4, visibility: "all" },
			{ id: 4, user_id: 6, visibility: "user" },
		],
	},
});

it("replaces users but keeps the restoring admin, skips the admin's email and moves a colliding id", async () => {
	const knex = await sqlite();
	const data = { ...usersData(), ...hostsData([host(5, { owner_user_id: 1 }), host(6, { owner_user_id: 4 })]) };
	const result = await replaceTypes({
		knex,
		data,
		types: ["proxy_hosts", "users"],
		adminUserId: 1,
		box,
		now: NOW,
	});
	const users = await knex("user").orderBy("id");
	const admin = users.find((row) => row.id === 1);
	assert.equal(admin.email, "admin@example.com");
	assert.equal(admin.npmpro_token_valid_after, 5);
	const moved = users.find((row) => row.email === "someone@example.com");
	assert.ok(moved.id > 6, "the backup user with the admin's id gets a new id");
	assert.equal(moved.avatar, `/images/avatar/${moved.id}.png?v=7`);
	assert.deepEqual(result.users, { ids: [6, moved.id], moved: { from: 1, to: moved.id }, skippedIds: [4] });
	assert.deepEqual(
		users.map((row) => row.email),
		["admin@example.com", "six@example.com", "someone@example.com"],
	);
	for (const row of users.filter((user) => user.id !== 1)) assert.equal(row.npmpro_token_valid_after, NOW);
	assert.deepEqual(result.skippedUsers, [{ id: 4, email: "ADMIN@example.com", name: "Backup Admin" }]);

	const auth = await knex("auth").orderBy("id");
	assert.deepEqual(
		auth.map((row) => [row.user_id, row.type, row.secret]),
		[
			[1, "password", "admin-hash"],
			[6, "totp", 'v1:{"totp":"BASE32"}'],
			[moved.id, "password", "one-hash"],
		],
	);
	const permissions = await knex("user_permission").orderBy("id");
	assert.deepEqual(
		permissions.map((row) => [row.user_id, row.visibility]),
		[
			[1, "all"],
			[6, "user"],
			[moved.id, "user"],
		],
	);
	const hosts = await knex("proxy_host").orderBy("id");
	assert.deepEqual(
		hosts.map((row) => [row.id, row.owner_user_id]),
		[
			[5, moved.id],
			[6, 1],
		],
	);
	// the instance's certificate was owned by the admin, who stays
	assert.equal((await knex("certificate").first()).owner_user_id, 1);
	assert.deepEqual(result.counts, { users: 2, proxy_hosts: 2 });
	await knex.destroy();
});

it("keeps the users' own session cut-off when now is null (the rollback to the automatic backup)", async () => {
	const knex = await sqlite();
	try {
		const data = usersData();
		data.users.user[2].npmpro_token_valid_after = 1234;
		await replaceTypes({ knex, data, types: ["users"], adminUserId: 1, box, now: null });
		const users = await knex("user").orderBy("id");
		assert.equal(users.find((row) => row.email === "six@example.com").npmpro_token_valid_after, 1234);
		assert.equal(users.find((row) => row.email === "someone@example.com").npmpro_token_valid_after, 0);
		assert.equal(users.find((row) => row.id === 1).npmpro_token_valid_after, 5);
	} finally {
		await knex.destroy();
	}
});

it("hands the instance's rows of a removed user to the admin", async () => {
	const knex = await sqlite();
	const result = await replaceTypes({
		knex,
		data: { users: { user: [], auth: [], user_permission: [] } },
		types: ["users"],
		adminUserId: 1,
		box,
		now: NOW,
	});
	assert.deepEqual(
		(await knex("proxy_host").orderBy("id")).map((row) => row.owner_user_id),
		[1, 1],
	);
	assert.deepEqual(
		result.references.map((change) => [change.table, change.id, change.column, change.to]),
		[["proxy_host", 2, "owner_user_id", 1]],
	);
	assert.deepEqual(
		(await knex("user")).map((row) => row.id),
		[1],
	);
	await knex.destroy();
});

it("renames DNS credentials of missing owners that collide by name once handed to the admin", async () => {
	const knex = await sqlite();
	try {
		await knex("user").where({ id: 2 }).del();
		const data = {
			dns_credentials: {
				npmpro_dns_credential: [
					{ id: 1, owner_user_id: 5, name: "cloudflare", values: {} },
					{ id: 2, owner_user_id: 6, name: "cloudflare", values: {} },
				],
			},
		};
		const preview = await previewReplace({ knex, data, types: ["dns_credentials"], adminUserId: 1 });
		const result = await replaceTypes({ knex, data, types: ["dns_credentials"], adminUserId: 1, box, now: NOW });
		for (const references of [preview.references, result.references]) {
			assert.deepEqual(
				references.filter((change) => change.column === "name").map((change) => [change.id, change.to]),
				[[2, "cloudflare (2)"]],
			);
		}
		assert.deepEqual(
			(await knex("npmpro_dns_credential").orderBy("id")).map((row) => [row.id, row.owner_user_id, row.name]),
			[
				[1, 1, "cloudflare"],
				[2, 1, "cloudflare (2)"],
			],
		);
	} finally {
		await knex.destroy();
	}
});

it("rolls back every type when an insert fails", async () => {
	const knex = await sqlite();
	const data = { ...usersData(), ...hostsData([host(5), host(5)]) };
	await assert.rejects(
		replaceTypes({ knex, data, types: ["users", "proxy_hosts"], adminUserId: 1, box, now: NOW }),
		CONSTRAINT,
	);
	assert.deepEqual(
		(await knex("proxy_host").orderBy("id")).map((row) => row.id),
		[1, 2],
	);
	assert.deepEqual(
		(await knex("user").orderBy("id")).map((row) => row.email),
		["admin@example.com", "old@example.com"],
	);
	assert.equal((await knex("auth")).length, 2);
	await knex.destroy();
});

it("seals DNS credential values with the box, also stripped ones", async () => {
	const knex = await sqlite();
	const data = {
		dns_credentials: {
			npmpro_dns_credential: [
				{ id: 2, owner_user_id: 1, name: "cf", values: { token: "secret" } },
				{ id: 3, owner_user_id: 1, name: "stripped", values: {} },
			],
		},
	};
	await replaceTypes({ knex, data, types: ["dns_credentials"], adminUserId: 1, box, now: NOW });
	assert.deepEqual(
		(await knex("npmpro_dns_credential").orderBy("id")).map((row) => row.values),
		['v1:{"token":"secret"}', "v1:{}"],
	);
	await knex.destroy();
});

it("replaces only the setting rows of the chosen type", async () => {
	const knex = await sqlite();
	const data = { settings_oidc: { setting: [{ id: "oidc", name: "OIDC", meta: { enabled: true } }] } };
	await replaceTypes({ knex, data, types: ["settings_oidc"], adminUserId: 1, box, now: NOW });
	assert.deepEqual(
		(await knex("setting").orderBy("id")).map((row) => [row.id, JSON.parse(row.meta)]),
		[
			["default-site", { page: "congratulations" }],
			["oidc", { enabled: true }],
		],
	);
	await knex.destroy();
});

it("refuses setting rows of another type and changes nothing", async () => {
	const knex = await sqlite();
	const data = { settings_oidc: { setting: [{ id: "traffic-state", name: "x", meta: {} }] } };
	await assert.rejects(
		replaceTypes({ knex, data, types: ["settings_oidc"], adminUserId: 1, box, now: NOW }),
		(error) => error.code === "invalid-archive",
	);
	assert.deepEqual(
		(await knex("setting").orderBy("id")).map((row) => row.id),
		["default-site", "oidc"],
	);
	await knex.destroy();
});

it("previews the references, the skipped users and the types without secrets", async () => {
	const knex = await sqlite();
	const data = {
		...usersData(),
		...hostsData([host(5, { certificate_id: 3, owner_user_id: 1 }), host(7, { certificate_id: 9 })]),
	};
	const preview = await previewReplace({
		knex,
		data,
		types: ["users", "proxy_hosts"],
		adminUserId: 1,
		secrets: false,
	});
	assert.deepEqual(
		preview.references.map((change) => [change.table, change.id, change.column, change.to]),
		[["proxy_host", 7, "certificate_id", 0]],
	);
	assert.deepEqual(preview.skippedUsers, [{ id: 4, email: "ADMIN@example.com", name: "Backup Admin" }]);
	assert.deepEqual(preview.missingSecrets, ["users"]);
	// nothing was written
	assert.deepEqual(
		(await knex("proxy_host").orderBy("id")).map((row) => row.id),
		[1, 2],
	);
	await knex.destroy();
});

it("previews the instance's kept hosts against the restored certificates", async () => {
	const knex = await sqlite();
	await knex("proxy_host").where({ id: 1 }).update({ certificate_id: 3 });
	const preview = await previewReplace({
		knex,
		data: { certificates: { certificate: [] } },
		types: ["certificates"],
		adminUserId: 1,
	});
	assert.deepEqual(
		preview.references.map((change) => [change.table, change.id, change.column, change.label]),
		[["proxy_host", 1, "certificate_id", "proxy_host one.example.com: certificate #3 not found"]],
	);
	assert.deepEqual(preview.missingSecrets, []);
	await knex.destroy();
});

it("resets Postgres id sequences, and only there", () => {
	const pg = knexFactory({ client: "pg" });
	assert.equal(
		sequenceResetQuery(pg, "proxy_host").toString(),
		`select setval(pg_get_serial_sequence('"proxy_host"', 'id'), coalesce((select max(id) from "proxy_host"), 0) + 1, false)`,
	);
	assert.equal(sequenceResetQuery(knexFactory({ client: "postgresql" }), "user") === null, false);
	assert.equal(sequenceResetQuery(pg, "setting"), null);
	assert.equal(sequenceResetQuery(pg, "npmpro_proxy_host_access_list"), null);
	assert.equal(sequenceResetQuery(knexFactory({ client: "better-sqlite3", useNullAsDefault: true }), "user"), null);
	assert.equal(sequenceResetQuery(knexFactory({ client: "mysql2" }), "user"), null);
});

it("loads the stage data of the chosen types and refuses tables of another type", async () => {
	const stageDir = await mkdtemp(path.join(os.tmpdir(), "npmpro-restore-db-"));
	await mkdir(path.join(stageDir, "data"));
	await writeFile(path.join(stageDir, "data", "streams.json"), JSON.stringify({ stream: [{ id: 1 }] }));
	await writeFile(path.join(stageDir, "data", "dead_hosts.json"), JSON.stringify({ user: [{ id: 1 }] }));
	assert.deepEqual(await loadStageData(stageDir, ["streams", "custom_nginx"]), { streams: { stream: [{ id: 1 }] } });
	await assert.rejects(loadStageData(stageDir, ["dead_hosts"]), (error) => error.code === "invalid-archive");
	await assert.rejects(loadStageData(stageDir, ["redirection_hosts"]), (error) => error.code === "invalid-archive");
	await rm(stageDir, { recursive: true });
});

it("refuses a backup whose item rows have ids that are not positive integers", async () => {
	const stageDir = await mkdtemp(path.join(os.tmpdir(), "npmpro-restore-db-"));
	await mkdir(path.join(stageDir, "data"));
	const write = (typeId, rows) => writeFile(path.join(stageDir, "data", `${typeId}.json`), JSON.stringify(rows));
	await write("certificates", { certificate: [{ id: "1/../../../../x", provider: "letsencrypt" }] });
	await write("streams", { stream: [{ id: 0 }] });
	await write("dead_hosts", { dead_host: [{ id: "01" }] });
	await write("access_lists", { access_list: [{ id: 3 }], access_list_client: [{ id: 1, access_list_id: 3 }] });
	await write("redirection_hosts", { redirection_host: [{ id: "12" }] });
	for (const typeId of ["certificates", "streams", "dead_hosts"]) {
		await assert.rejects(loadStageData(stageDir, [typeId]), (error) => {
			assert.equal(error.code, "invalid-archive");
			assert.match(error.message, INVALID_ID);
			return true;
		});
	}
	assert.equal((await loadStageData(stageDir, ["access_lists"])).access_lists.access_list[0].id, 3);
	assert.equal((await loadStageData(stageDir, ["redirection_hosts"])).redirection_hosts.redirection_host[0].id, "12");
	await rm(stageDir, { recursive: true });
});
