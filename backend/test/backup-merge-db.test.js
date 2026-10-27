import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { createSchema } from "./support/backup-schema.js";

const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };
const NOW = 1_800_000_000;
const UNKNOWN_TYPE = /widgets/u;
const UNIQUE_FAILED = /UNIQUE constraint failed: npmpro_proxy_host_access_list/u;
const SCOPE = {
	adminUserId: 1,
	importerId: 1,
	page: false,
	canView: () => true,
	canManage: () => true,
	canEdit: () => true,
	visibleOwnerId: null,
};

const open = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await createSchema(knex);
	return knex;
};

// plans the merge against the database as it is, then applies it
const merge = async (knex, { data, types, items, choices, secrets = true, importerId = 1, page = false }) => {
	const instance = { ...(await readInstanceRows(knex)), files: {} };
	const scope = { ...SCOPE, importerId, page };
	const plan = planMerge({ data, instance, stageFiles: {}, types, items, choices, scope, secrets });
	const result = await mergeTypes({ knex, data, plan, adminUserId: 1, importerId, page, box, secrets, now: NOW });
	return { plan, result };
};

const proxyHosts = (hosts, locations = [], links = []) => ({
	proxy_host: hosts,
	npmpro_location: locations,
	npmpro_proxy_host_access_list: links,
});

const host = (id, domain, extra = {}) => ({
	id,
	owner_user_id: 1,
	domain_names: [domain],
	enabled: 1,
	certificate_id: 0,
	npmpro_mtls_certificate_id: 0,
	access_list_id: 0,
	meta: {},
	...extra,
});

const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);

it("adds a proxy host with new ids for it, its locations and links, linked to an existing access list", async () => {
	const knex = await open();
	try {
		await knex("proxy_host").insert([
			{ id: 1, domain_names: '["one.example.com"]' },
			{ id: 2, domain_names: '["two.example.com"]' },
		]);
		await knex("npmpro_location").insert({ id: 1, proxy_host_id: 1, path: "/kept" });
		await knex("access_list").insert({ id: 9, name: "Office" });
		const data = {
			proxy_hosts: proxyHosts(
				[host(1, "new.example.com", { access_list_id: 3 })],
				[{ id: 1, proxy_host_id: 1, path: "/api" }],
				[
					{ proxy_host_id: 1, location_id: 0, access_list_id: 3 },
					{ proxy_host_id: 1, location_id: 1, access_list_id: 3 },
					{ proxy_host_id: 1, location_id: 1, access_list_id: 4 },
				],
			),
			access_lists: {
				access_list: [
					{ id: 3, name: "office" },
					{ id: 4, name: "Gone" },
				],
				access_list_auth: [],
				access_list_client: [],
			},
		};
		const { plan, result } = await merge(knex, {
			data,
			types: ["proxy_hosts"],
			choices: { "access_lists:4": "unticked" },
		});
		assert.equal(plan.items.find((item) => item.key === "access_lists:3").action, "existing");
		const newId = result.maps.proxy_host.get("1");
		assert.equal(newId, 3);
		assert.equal(result.maps.access_list.get("3"), 9);
		assert.equal(result.maps.access_list.has("4"), false);
		const added = await knex("proxy_host").where({ id: newId }).first();
		assert.deepEqual(json(added.domain_names), ["new.example.com"]);
		assert.equal(added.access_list_id, 9);
		assert.equal(added.npmpro_nginx_online, 1);
		const locations = await knex("npmpro_location").orderBy("id");
		assert.deepEqual(locations, [
			{ id: 1, proxy_host_id: 1, path: "/kept" },
			{ id: 2, proxy_host_id: newId, path: "/api" },
		]);
		assert.equal(result.maps.npmpro_location.get("1"), 2);
		assert.deepEqual(await knex("npmpro_proxy_host_access_list").orderBy("location_id"), [
			{ proxy_host_id: newId, location_id: 0, access_list_id: 9 },
			{ proxy_host_id: newId, location_id: 2, access_list_id: 9 },
		]);
		assert.equal(result.cleared, 1);
		assert.deepEqual(result.counts, { proxy_hosts: 1 });
		assert.deepEqual(
			(await knex("proxy_host").whereIn("id", [1, 2]).orderBy("id")).map((row) => json(row.domain_names)),
			[["one.example.com"], ["two.example.com"]],
		);
		assert.equal((await knex("access_list").count({ count: "*" }).first()).count, 1);
	} finally {
		await knex.destroy();
	}
});

it("links two hosts sharing one added certificate to the same new certificate", async () => {
	const knex = await open();
	try {
		await knex("certificate").insert({ id: 5, provider: "letsencrypt", domain_names: '["other.example.com"]' });
		const data = {
			proxy_hosts: proxyHosts([
				host(1, "one.example.com", { certificate_id: 4 }),
				host(2, "two.example.com", { certificate_id: 4, npmpro_mtls_certificate_id: 8 }),
			]),
			certificates: {
				certificate: [
					{ id: 4, provider: "letsencrypt", domain_names: ["one.example.com", "two.example.com"], meta: {} },
				],
			},
		};
		const { result } = await merge(knex, { data, types: ["proxy_hosts"] });
		const certificateId = result.maps.certificate.get("4");
		assert.equal(certificateId, 6);
		assert.deepEqual(result.certificateMoves, [{ from: 4, to: 6 }]);
		assert.equal((await knex("certificate").count({ count: "*" }).first()).count, 2);
		const hosts = await knex("proxy_host").orderBy("id");
		assert.deepEqual(
			hosts.map((row) => [row.certificate_id, row.npmpro_mtls_certificate_id]),
			[
				[6, 0],
				[6, 0],
			],
		);
		assert.equal(result.cleared, 1);
		assert.deepEqual(result.counts, { certificates: 1, proxy_hosts: 2 });
	} finally {
		await knex.destroy();
	}
});

it("replaces a host in place: the instance id stays, its locations and links are the backup's", async () => {
	const knex = await open();
	try {
		await knex("proxy_host").insert({
			id: 7,
			domain_names: '["app.example.com"]',
			created_on: "2020-01-01 00:00:00",
			modified_on: "2020-01-01 00:00:00",
			npmpro_nginx_online: 0,
			npmpro_nginx_err: "broken",
		});
		await knex("npmpro_location").insert([
			{ id: 1, proxy_host_id: 7, path: "/old" },
			{ id: 2, proxy_host_id: 7, path: "/old2" },
		]);
		await knex("access_list").insert({ id: 2, name: "Office" });
		await knex("npmpro_proxy_host_access_list").insert({ proxy_host_id: 7, location_id: 1, access_list_id: 2 });
		const data = {
			proxy_hosts: proxyHosts(
				[
					host(3, "app.example.com", {
						enabled: 0,
						owner_user_id: 99,
						created_on: "2026-01-01T00:00:00.000Z",
						modified_on: "2026-01-01T00:00:00.000Z",
					}),
				],
				[{ id: 8, proxy_host_id: 3, path: "/new" }],
				[{ proxy_host_id: 3, location_id: 8, access_list_id: 5 }],
			),
			access_lists: { access_list: [{ id: 5, name: "Office" }], access_list_auth: [], access_list_client: [] },
		};
		const { result } = await merge(knex, { data, types: ["proxy_hosts"], choices: { "proxy_hosts:3": "replace" } });
		assert.equal(result.maps.proxy_host.get("3"), 7);
		const rows = await knex("proxy_host");
		assert.equal(rows.length, 1);
		assert.equal(rows[0].id, 7);
		assert.equal(rows[0].enabled, 0);
		assert.equal(rows[0].owner_user_id, 1);
		assert.equal(rows[0].npmpro_nginx_online, 1);
		assert.equal(rows[0].npmpro_nginx_err, "");
		assert.equal(rows[0].created_on, "2020-01-01 00:00:00");
		assert.notEqual(rows[0].modified_on, "2020-01-01 00:00:00");
		assert.notEqual(rows[0].modified_on, "2026-01-01 00:00:00");
		const locations = await knex("npmpro_location");
		assert.deepEqual(
			locations.map(({ proxy_host_id, path }) => [proxy_host_id, path]),
			[[7, "/new"]],
		);
		assert.deepEqual(await knex("npmpro_proxy_host_access_list"), [
			{ proxy_host_id: 7, location_id: locations[0].id, access_list_id: 2 },
		]);
		assert.deepEqual(result.counts, { proxy_hosts: 1 });
	} finally {
		await knex.destroy();
	}
});

it("changes nothing for a skipped host", async () => {
	const knex = await open();
	try {
		await knex("proxy_host").insert({ id: 7, domain_names: '["app.example.com"]', enabled: 1 });
		await knex("npmpro_location").insert({ id: 1, proxy_host_id: 7, path: "/old" });
		const before = { hosts: await knex("proxy_host"), locations: await knex("npmpro_location") };
		const data = {
			proxy_hosts: proxyHosts(
				[host(3, "app.example.com", { enabled: 0, certificate_id: 4 })],
				[{ id: 8, proxy_host_id: 3, path: "/new" }],
			),
			certificates: { certificate: [{ id: 4, provider: "letsencrypt", domain_names: ["app.example.com"] }] },
		};
		const { plan, result } = await merge(knex, { data, types: ["proxy_hosts"] });
		assert.equal(plan.items.find((item) => item.key === "proxy_hosts:3").action, "skip");
		assert.deepEqual(await knex("proxy_host"), before.hosts);
		assert.deepEqual(await knex("npmpro_location"), before.locations);
		assert.equal((await knex("certificate").count({ count: "*" }).first()).count, 0);
		assert.deepEqual(result.counts, {});
		assert.equal(result.maps.proxy_host.size, 0);
	} finally {
		await knex.destroy();
	}
});

it("adds a DNS credential named like one of the importer's own under a free name with sealed values", async () => {
	const knex = await open();
	try {
		await knex("npmpro_dns_credential").insert([
			{ id: 1, owner_user_id: 1, name: "Cloudflare", values: "v1:{}" },
			{ id: 2, owner_user_id: 1, name: "cloudflare (2)", values: "v1:{}" },
		]);
		const data = {
			certificates: {
				certificate: [
					{ id: 4, provider: "letsencrypt", domain_names: ["a.example.com"], npmpro_dns_credential_id: 3 },
				],
			},
			dns_credentials: {
				npmpro_dns_credential: [{ id: 3, owner_user_id: 1, name: "CLOUDFLARE", values: { token: "abc" } }],
			},
		};
		const { result } = await merge(knex, {
			data,
			types: ["certificates", "dns_credentials"],
			choices: { "dns_credentials:3": "add" },
		});
		const credentialId = result.maps.npmpro_dns_credential.get("3");
		const added = await knex("npmpro_dns_credential").where({ id: credentialId }).first();
		assert.equal(added.name, "CLOUDFLARE (3)");
		assert.equal(added.values, box.encrypt({ token: "abc" }));
		const certificate = await knex("certificate")
			.where({ id: result.maps.certificate.get("4") })
			.first();
		assert.equal(certificate.npmpro_dns_credential_id, credentialId);
		assert.deepEqual(result.counts, { dns_credentials: 1, certificates: 1 });

		const blank = await merge(knex, {
			data: {
				dns_credentials: { npmpro_dns_credential: [{ id: 8, owner_user_id: 1, name: "Route53", values: {} }] },
			},
			types: ["dns_credentials"],
			secrets: false,
		});
		const route53 = await knex("npmpro_dns_credential")
			.where({ id: blank.result.maps.npmpro_dns_credential.get("8") })
			.first();
		assert.equal(route53.name, "Route53");
		assert.equal(route53.values, box.encrypt({}));
	} finally {
		await knex.destroy();
	}
});

it("adds a user with a new id, sealed auth rows and a fresh token time; owners follow the user map", async () => {
	const knex = await open();
	try {
		await knex("user").insert({ id: 2, email: "bob@example.com", name: "Bob", roles: "[]" });
		const data = {
			users: {
				user: [
					{ id: 1, email: "carol@example.com", name: "Carol", roles: [], npmpro_token_valid_after: 5 },
					{ id: 6, email: "Bob@Example.com", name: "Bob", roles: [] },
					{ id: 7, email: "dave@example.com", name: "Dave", roles: [] },
				],
				auth: [
					{ id: 1, user_id: 1, type: "password", secret: "hash", meta: {} },
					{ id: 2, user_id: 1, type: "totp", secret: "BASE32", meta: {} },
				],
				user_permission: [{ id: 1, user_id: 1, visibility: "user" }],
			},
			redirection_hosts: {
				redirection_host: [
					{ id: 1, owner_user_id: 1, domain_names: ["r1.example.com"], meta: {} },
					{ id: 2, owner_user_id: 6, domain_names: ["r2.example.com"], meta: {} },
					{ id: 3, owner_user_id: 7, domain_names: ["r3.example.com"], meta: {} },
				],
			},
		};
		const { result } = await merge(knex, {
			data,
			types: ["users", "redirection_hosts"],
			items: { users: [1] },
		});
		const carolId = result.maps.user.get("1");
		assert.equal(carolId, 3);
		const carol = await knex("user").where({ id: carolId }).first();
		assert.equal(carol.email, "carol@example.com");
		assert.equal(carol.npmpro_token_valid_after, NOW);
		const auth = await knex("auth").where({ user_id: carolId }).orderBy("id");
		assert.deepEqual(
			auth.map(({ type, secret }) => [type, secret]),
			[
				["password", "hash"],
				["totp", box.encrypt({ totp: "BASE32" })],
			],
		);
		assert.equal(
			auth.every((row) => row.id > 1),
			true,
		);
		assert.deepEqual(
			(await knex("user_permission").where({ user_id: carolId })).map((row) => row.visibility),
			["user"],
		);
		assert.deepEqual(await knex("auth").where({ user_id: 1 }), [
			{ id: 1, user_id: 1, type: "password", secret: "admin-hash", meta: "{}" },
		]);
		const owners = (await knex("redirection_host").orderBy("id")).map((row) => row.owner_user_id);
		// carol by the user map, bob (not merged) by his email, dave is not on the instance: the importer
		assert.deepEqual(owners, [carolId, 2, 1]);
		assert.deepEqual(result.counts, { users: 1, redirection_hosts: 3 });
	} finally {
		await knex.destroy();
	}
});

it("gives every added row the importer as owner on a page import", async () => {
	const knex = await open();
	try {
		await knex("user").insert({ id: 2, email: "bob@example.com", name: "Bob", roles: "[]" });
		const data = {
			users: { user: [{ id: 1, email: "admin@example.com", name: "Admin", roles: [] }] },
			proxy_hosts: proxyHosts([host(1, "p.example.com", { owner_user_id: 1, access_list_id: 2 })]),
			access_lists: {
				access_list: [{ id: 2, owner_user_id: 1, name: "List" }],
				access_list_auth: [{ id: 1, access_list_id: 2, username: "u", password: "hash" }],
				access_list_client: [{ id: 1, access_list_id: 2, value: "10.0.0.0/8" }],
			},
		};
		const { result } = await merge(knex, { data, types: ["proxy_hosts"], importerId: 2, page: true });
		const listId = result.maps.access_list.get("2");
		assert.equal((await knex("access_list").where({ id: listId }).first()).owner_user_id, 2);
		assert.equal((await knex("proxy_host").first()).owner_user_id, 2);
		assert.deepEqual(
			(await knex("access_list_auth")).map(({ access_list_id, username, password }) => [
				access_list_id,
				username,
				password,
			]),
			[[listId, "u", "hash"]],
		);
		assert.deepEqual(
			(await knex("access_list_client")).map(({ access_list_id, value }) => [access_list_id, value]),
			[[listId, "10.0.0.0/8"]],
		);
	} finally {
		await knex.destroy();
	}
});

it("moves an added user's avatar to the new id and keeps an external one", async () => {
	const knex = await open();
	try {
		await knex("user").insert({
			id: 2,
			email: "bob@example.com",
			name: "Bob",
			roles: "[]",
			avatar: "/images/avatar/2.png",
		});
		const external = "https://www.gravatar.com/avatar/abc?default=mm";
		const data = {
			users: {
				user: [
					{ id: 2, email: "carol@example.com", name: "Carol", roles: [], avatar: "/images/avatar/2.png" },
					{ id: 4, email: "dave@example.com", name: "Dave", roles: [], avatar: external },
				],
				auth: [],
				user_permission: [],
			},
		};
		const { result } = await merge(knex, { data, types: ["users"] });
		const carolId = result.maps.user.get("2");
		const daveId = result.maps.user.get("4");
		assert.equal(carolId, 3);
		assert.equal((await knex("user").where({ id: carolId }).first()).avatar, `/images/avatar/${carolId}.png`);
		assert.equal((await knex("user").where({ id: daveId }).first()).avatar, external);
		assert.equal((await knex("user").where({ id: 2 }).first()).avatar, "/images/avatar/2.png");
		assert.deepEqual(result.avatarMoves, [
			{ from: 2, to: carolId },
			{ from: 4, to: daveId },
		]);
	} finally {
		await knex.destroy();
	}
});

it("replaces a user in place with the backup's auth rows and a fresh token time; never the admin", async () => {
	const knex = await open();
	try {
		await knex("user").insert({ id: 2, email: "bob@example.com", name: "Old Bob", roles: "[]" });
		await knex("auth").insert({ id: 2, user_id: 2, type: "password", secret: "old", meta: "{}" });
		await knex("user_permission").insert({ id: 2, user_id: 2, visibility: "all" });
		const data = {
			users: {
				user: [
					{ id: 1, email: "admin@example.com", name: "Other Admin", roles: [] },
					{
						id: 5,
						email: "bob@example.com",
						name: "New Bob",
						roles: ["admin"],
						avatar: "/images/avatar/5.png",
					},
				],
				auth: [
					{ id: 1, user_id: 1, type: "password", secret: "backup-admin", meta: {} },
					{ id: 9, user_id: 5, type: "password", secret: "new", meta: {} },
				],
				user_permission: [
					{ id: 1, user_id: 1, visibility: "user" },
					{ id: 4, user_id: 5, visibility: "user" },
				],
			},
		};
		const { result } = await merge(knex, { data, types: ["users"], choices: { "users:5": "replace" } });
		assert.equal(result.maps.user.get("5"), 2);
		assert.equal(result.maps.user.get("1"), 1);
		assert.deepEqual(result.replacedUserIds, [2]);
		const bob = await knex("user").where({ id: 2 }).first();
		assert.equal(bob.name, "New Bob");
		assert.deepEqual(json(bob.roles), ["admin"]);
		assert.equal(bob.npmpro_token_valid_after, NOW);
		assert.equal(bob.avatar, "/images/avatar/2.png");
		assert.deepEqual(result.avatarMoves, [{ from: 5, to: 2 }]);
		assert.deepEqual(
			(await knex("auth").where({ user_id: 2 })).map((row) => row.secret),
			["new"],
		);
		assert.deepEqual(
			(await knex("user_permission").where({ user_id: 2 })).map((row) => row.visibility),
			["user"],
		);
		const admin = await knex("user").where({ id: 1 }).first();
		assert.equal(admin.name, "Admin");
		assert.equal(admin.npmpro_token_valid_after, 0);
		assert.deepEqual(
			(await knex("auth").where({ user_id: 1 })).map((row) => row.secret),
			["admin-hash"],
		);
		assert.equal((await knex("user").count({ count: "*" }).first()).count, 2);
		assert.deepEqual(result.counts, { users: 1 });
	} finally {
		await knex.destroy();
	}
});

it("takes an oidc setting without secrets and keeps the instance client secret", async () => {
	const knex = await open();
	await knex("setting").insert({
		id: "oidc",
		name: "OIDC",
		meta: JSON.stringify({ enabled: false, client_id: "old", client_secret: box.encrypt("kept") }),
	});
	try {
		const data = {
			settings_oidc: { setting: [{ id: "oidc", name: "OIDC", meta: { enabled: true, client_id: "new" } }] },
			settings_monitoring: {
				setting: [{ id: "geoip", name: "GeoIP", meta: { edition: "x" } }],
			},
		};
		const { result } = await merge(knex, {
			data,
			types: ["settings_oidc", "settings_monitoring"],
			choices: { "setting:oidc": "take", "setting:geoip": "take" },
			secrets: false,
		});
		const oidc = await knex("setting").where({ id: "oidc" }).first();
		assert.deepEqual(json(oidc.meta), { enabled: true, client_id: "new", client_secret: box.encrypt("kept") });
		const geoip = await knex("setting").where({ id: "geoip" }).first();
		assert.equal(geoip.name, "GeoIP");
		assert.deepEqual(json(geoip.meta), { edition: "x" });
		assert.deepEqual(result.counts, { settings_oidc: 1, settings_monitoring: 1 });

		await merge(knex, {
			data: { settings_oidc: { setting: [{ id: "oidc", meta: { client_secret: "fresh" } }] } },
			types: ["settings_oidc"],
			choices: { "setting:oidc": "take" },
		});
		assert.deepEqual(json((await knex("setting").where({ id: "oidc" }).first()).meta), {
			client_secret: box.encrypt("fresh"),
		});
	} finally {
		await knex.destroy();
	}
});

it("rolls everything back when an insert fails", async () => {
	const knex = await open();
	try {
		await knex("access_list").insert({ id: 2, name: "Office" });
		// an orphan link row with the id the added host gets: its link insert hits the primary key
		await knex("npmpro_proxy_host_access_list").insert({ proxy_host_id: 1, location_id: 0, access_list_id: 2 });
		const data = {
			users: {
				user: [{ id: 4, email: "carol@example.com", name: "Carol", roles: [] }],
				auth: [],
				user_permission: [],
			},
			dns_credentials: { npmpro_dns_credential: [{ id: 1, owner_user_id: 4, name: "CF", values: {} }] },
			proxy_hosts: proxyHosts(
				[host(1, "p.example.com")],
				[{ id: 1, proxy_host_id: 1, path: "/x" }],
				[{ proxy_host_id: 1, location_id: 0, access_list_id: 3 }],
			),
			access_lists: { access_list: [{ id: 3, name: "office" }], access_list_auth: [], access_list_client: [] },
		};
		await assert.rejects(merge(knex, { data, types: ["users", "dns_credentials", "proxy_hosts"] }), UNIQUE_FAILED);
		assert.equal((await knex("user").count({ count: "*" }).first()).count, 1);
		assert.equal((await knex("npmpro_dns_credential").count({ count: "*" }).first()).count, 0);
		assert.equal((await knex("proxy_host").count({ count: "*" }).first()).count, 0);
		assert.equal((await knex("npmpro_location").count({ count: "*" }).first()).count, 0);
		assert.equal((await knex("npmpro_proxy_host_access_list").count({ count: "*" }).first()).count, 1);
	} finally {
		await knex.destroy();
	}
});

it("refuses an item of an unknown type", async () => {
	const knex = await open();
	try {
		const plan = { items: [{ key: "widgets:1", type: "widgets", id: 1, action: "add", target: null }] };
		await assert.rejects(
			mergeTypes({ knex, data: {}, plan, adminUserId: 1, importerId: 1, box, secrets: true, now: NOW }),
			UNKNOWN_TYPE,
		);
	} finally {
		await knex.destroy();
	}
});
