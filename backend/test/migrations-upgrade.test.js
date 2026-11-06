import "./support/secret-key-env.js";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, it } from "node:test";
import knexFactory from "knex";
import { knexConfigOf } from "../lib/database/knex-config.js";
import { fillRow, tempSqlite } from "./support/database.js";
import { migrateRest, migrateThrough, migrationNames, schemaSnapshot } from "./support/migrations.js";

// the key folder made by secret-key-env.js
after(() => rm(path.dirname(process.env.NPMPRO_SECRET_KEY_FILE), { recursive: true, force: true }));

const SCHEME = /\$scheme/u;
const AUTO = /auto/u;
const UNIQUE = /UNIQUE/u;
const SNAPSHOT = new URL("./fixtures/schema-snapshot.json", import.meta.url);

// Builds a database up to the migration before `stem` and hands the test two steps: `step` runs only that migration
// (the rows are then exactly what it left), `rest` runs everything after the old state to the newest migration.
const atMigration = async (stem, test) => {
	const names = await migrationNames();
	const index = names.indexOf(`${stem}.js`);
	if (index === -1) throw new Error(`no migration ${stem}`);
	const db = await tempSqlite();
	const knex = knexFactory(knexConfigOf(db.connection));
	try {
		if (index > 0) await migrateThrough(knex, db, names[index - 1]);
		await test(knex, {
			step: () => migrateThrough(knex, db, `${stem}.js`),
			rest: () => migrateRest(knex, db),
			db,
		});
	} finally {
		await knex.destroy();
		await db.cleanup();
	}
};

// inserts a row with every NOT NULL column filled; returns its id
const put = async (knex, table, overrides = {}) => {
	const [id] = await knex(table).insert(fillRow(await knex(table).columnInfo(), overrides));
	return typeof id === "object" ? id.id : id;
};

const json = (value) => JSON.stringify(value);
const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value);

it("20251111090000_redirect_auto_scheme turns $scheme into auto and keeps explicit schemes", async () => {
	await atMigration("20251111090000_redirect_auto_scheme", async (knex, { step }) => {
		const info = await knex("redirection_host").columnInfo();
		assert.match(info.forward_scheme.defaultValue, SCHEME);
		const same = await put(knex, "redirection_host", { forward_scheme: "$scheme" });
		const https = await put(knex, "redirection_host", { forward_scheme: "https" });
		await step();
		assert.equal((await knex("redirection_host").where("id", same).first()).forward_scheme, "auto");
		assert.equal((await knex("redirection_host").where("id", https).first()).forward_scheme, "https");
		assert.match((await knex("redirection_host").columnInfo()).forward_scheme.defaultValue, AUTO);
	});
});

it("20260404150850_revert_redirect_auto_scheme turns auto back into $scheme", async () => {
	await atMigration("20260404150850_revert_redirect_auto_scheme", async (knex, { step }) => {
		const auto = await put(knex, "redirection_host", { forward_scheme: "auto" });
		const http = await put(knex, "redirection_host", { forward_scheme: "http" });
		await step();
		assert.equal((await knex("redirection_host").where("id", auto).first()).forward_scheme, "$scheme");
		assert.equal((await knex("redirection_host").where("id", http).first()).forward_scheme, "http");
		assert.match((await knex("redirection_host").columnInfo()).forward_scheme.defaultValue, SCHEME);
	});
});

it("20260161994605_reset_button_values switches the three old buttons off and leaves the rest", async () => {
	await atMigration("20260161994605_reset_button_values", async (knex, { step }) => {
		const id = await put(knex, "proxy_host", {
			caching_enabled: 1,
			block_exploits: 1,
			allow_websocket_upgrade: 1,
			ssl_forced: 1,
			domain_names: json(["a.example"]),
		});
		await step();
		const row = await knex("proxy_host").where("id", id).first();
		assert.deepEqual([row.caching_enabled, row.block_exploits, row.allow_websocket_upgrade], [0, 0, 0]);
		assert.equal(row.ssl_forced, 1);
		assert.deepEqual(parse(row.domain_names), ["a.example"]);
	});
});

it("20260331194500_multiple_access_lists moves access_list_id to the id list, locations and relation rows", async () => {
	await atMigration("20260331194500_multiple_access_lists", async (knex, { step }) => {
		const list1 = await put(knex, "access_list");
		const list2 = await put(knex, "access_list");
		const custom = await put(knex, "proxy_host", {
			access_list_id: list1,
			locations: json([{ path: "/a", npmplus_access_list_ids: [list2] }, { path: "/b" }]),
		});
		const open = await put(knex, "proxy_host", { access_list_id: 0, locations: json([]) });
		await step();

		const host = await knex("proxy_host").where("id", custom).first();
		assert.deepEqual(parse(host.npmplus_access_list_ids), [list1]);
		assert.equal(host.npmplus_access_list_type, "custom");
		assert.deepEqual(parse(host.locations), [
			{ path: "/a", npmplus_access_list_ids: [list2], npmplus_access_list_type: "global", id: 0 },
			{ path: "/b", npmplus_access_list_ids: [], npmplus_access_list_type: "global", id: 1 },
		]);
		const publicHost = await knex("proxy_host").where("id", open).first();
		assert.deepEqual(parse(publicHost.npmplus_access_list_ids), []);
		assert.equal(publicHost.npmplus_access_list_type, "public");
		const relations = await knex("npmplus_proxy_host_access_list").orderBy("access_list_id");
		assert.deepEqual(
			relations.map((row) => [row.proxy_host_id, row.access_list_id]),
			[
				[custom, list1],
				[custom, list2],
			],
		);
	});
});

it("20260724213114_restore_proxy_host_access_list rebuilds the relation rows of live hosts and lists", async () => {
	await atMigration("20260724213114_restore_proxy_host_access_list", async (knex, { step }) => {
		const live = await put(knex, "access_list");
		const gone = await put(knex, "access_list", { is_deleted: 1 });
		const host = await put(knex, "proxy_host", {
			npmplus_access_list_type: "custom",
			npmplus_access_list_ids: json([live, gone]),
			locations: json([{ npmplus_access_list_type: "custom", npmplus_access_list_ids: [live] }]),
		});
		const deletedHost = await put(knex, "proxy_host", {
			is_deleted: 1,
			npmplus_access_list_type: "custom",
			npmplus_access_list_ids: json([live]),
		});
		const publicHost = await put(knex, "proxy_host", {
			npmplus_access_list_type: "public",
			npmplus_access_list_ids: json([live]),
		});
		await step();
		const relations = await knex("npmplus_proxy_host_access_list").select("proxy_host_id", "access_list_id");
		assert.deepEqual(relations, [{ proxy_host_id: host, access_list_id: live }]);
		assert.ok(![deletedHost, publicHost].includes(relations[0].proxy_host_id));
	});
});

it("20260725143120_not_null_optional_columns fills NULLs so the columns can become NOT NULL", async () => {
	await atMigration("20260725143120_not_null_optional_columns", async (knex, { step }) => {
		const host = await put(knex, "proxy_host", { locations: null, npmplus_access_list_ids: null });
		const stream = await put(knex, "stream", { forwarding_port: null, npmplus_description: null });
		const kept = await put(knex, "stream", { forwarding_port: "8080", npmplus_description: "keep" });
		await step();
		const hostRow = await knex("proxy_host").where("id", host).first();
		assert.deepEqual(parse(hostRow.locations), []);
		assert.deepEqual(parse(hostRow.npmplus_access_list_ids), []);
		const streamRow = await knex("stream").where("id", stream).first();
		assert.deepEqual([streamRow.forwarding_port, streamRow.npmplus_description], ["", ""]);
		const keptRow = await knex("stream").where("id", kept).first();
		assert.deepEqual([keptRow.forwarding_port, keptRow.npmplus_description], ["8080", "keep"]);
		assert.equal((await knex("proxy_host").columnInfo()).locations.nullable, false);
		assert.equal((await knex("stream").columnInfo()).forwarding_port.nullable, false);
	});
});

it("20260802121623_unique_constraints keeps the oldest auth row per user and type", async () => {
	await atMigration("20260802121623_unique_constraints", async (knex, { step }) => {
		const first = await put(knex, "auth", { user_id: 1, type: "password", secret: "first" });
		await put(knex, "auth", { user_id: 1, type: "password", secret: "second" });
		await put(knex, "auth", { user_id: 1, type: "password", secret: "third" });
		const other = await put(knex, "auth", { user_id: 2, type: "password", secret: "other" });
		await step();
		const rows = await knex("auth").orderBy("id");
		assert.deepEqual(
			rows.map((row) => [row.id, row.secret]),
			[
				[first, "first"],
				[other, "other"],
			],
		);
		await assert.rejects(put(knex, "auth", { user_id: 1, type: "password" }), UNIQUE);
	});
});

it("20260913183434_lowercase_emails lowercases and trims stored addresses", async () => {
	await atMigration("20260913183434_lowercase_emails", async (knex, { step }) => {
		const mixed = await put(knex, "user", { email: " Mixed.Case@Example.COM", roles: "[]" });
		const clean = await put(knex, "user", { email: "clean@example.com", roles: "[]" });
		await step();
		assert.equal((await knex("user").where("id", mixed).first()).email, "mixed.case@example.com");
		assert.equal((await knex("user").where("id", clean).first()).email, "clean@example.com");
	});
});

it("20260913183435_recache_gravatars fetches again for users without an own avatar", async () => {
	await atMigration("20260913183435_recache_gravatars", async (knex, { step, db }) => {
		await mkdir(`${db.dir}/gravatar`, { recursive: true });
		await writeFile(`${db.dir}/gravatar/old.jpg`, "x");
		const plain = await put(knex, "user", { avatar: "/data/gravatar/old.jpg", roles: "[]" });
		const own = await put(knex, "user", { avatar: "/images/avatar/7.jpg", roles: "[]" });
		const gone = await put(knex, "user", { avatar: "/data/gravatar/old.jpg", is_deleted: 1, roles: "[]" });
		await step();
		assert.equal((await knex("user").where("id", plain).first()).avatar, "/images/default-avatar.jpg");
		assert.equal((await knex("user").where("id", own).first()).avatar, "/images/avatar/7.jpg");
		assert.equal((await knex("user").where("id", gone).first()).avatar, "/data/gravatar/old.jpg");
		await assert.rejects(readFile(`${db.dir}/gravatar/old.jpg`), { code: "ENOENT" });
	});
});

it("20260913183435_recache_gravatars leaves the disk alone on a database without users", async () => {
	await atMigration("20260913183435_recache_gravatars", async (_knex, { step, db }) => {
		await mkdir(`${db.dir}/gravatar`, { recursive: true });
		await writeFile(`${db.dir}/gravatar/old.jpg`, "x");
		await step();
		assert.equal(await readFile(`${db.dir}/gravatar/old.jpg`, "utf8"), "x");
	});
});

it("20260919230355_auth_factor_rows moves totp and backup codes out of the password row", async () => {
	await atMigration("20260919230355_auth_factor_rows", async (knex, { step }) => {
		const withTotp = await put(knex, "auth", {
			user_id: 1,
			type: "password",
			secret: "hash1",
			meta: json({ totp_enabled: true, totp_secret: "TOTPSECRET", backup_codes: ["c1", "c2"] }),
		});
		await put(knex, "auth", {
			user_id: 2,
			type: "password",
			secret: "hash2",
			meta: json({ totp_enabled: false, totp_secret: "UNFINISHED" }),
		});
		await step();
		const rows = await knex("auth").orderBy("id");
		const password = rows.filter((row) => row.type === "password");
		assert.deepEqual(
			password.map((row) => [row.user_id, row.secret, row.meta]),
			[
				[1, "hash1", "{}"],
				[2, "hash2", "{}"],
			],
		);
		assert.equal(password[0].id, withTotp);
		const factors = rows.filter((row) => row.type !== "password");
		assert.deepEqual(
			factors.map((row) => [row.user_id, row.type, row.secret]),
			[
				[1, "totp", "TOTPSECRET"],
				[1, "backup_code", "c1"],
				[1, "backup_code", "c2"],
			],
		);
		// the unique constraint is gone, a user may have several rows of one type
		await put(knex, "auth", { user_id: 1, type: "backup_code", secret: "c3" });
	});
});

it("20260924163000_upstream_location_access_list moves a location's access_list_id into the id list", async () => {
	await atMigration("20260924163000_upstream_location_access_list", async (knex, { step }) => {
		const live = await put(knex, "access_list");
		const gone = await put(knex, "access_list", { is_deleted: 1 });
		const host = await put(knex, "proxy_host", {
			locations: json([
				{ path: "/a", access_list_id: live },
				{ path: "/b", access_list_id: gone },
				{ path: "/c" },
			]),
		});
		const plain = await put(knex, "proxy_host", { locations: json([{ path: "/x" }]) });
		await step();
		assert.deepEqual(parse((await knex("proxy_host").where("id", host).first()).locations), [
			{ path: "/a", npmplus_access_list_type: "custom", npmplus_access_list_ids: [live] },
			// a deleted list is not applied, the old key is dropped
			{ path: "/b" },
			{ path: "/c" },
		]);
		assert.deepEqual(parse((await knex("proxy_host").where("id", plain).first()).locations), [{ path: "/x" }]);
		const relations = await knex("npmplus_proxy_host_access_list").select("proxy_host_id", "access_list_id");
		assert.deepEqual(relations, [{ proxy_host_id: host, access_list_id: live }]);
	});
});

it("20260925221019_remove_certificate_meta_files drops the PEM keys and keeps the other meta", async () => {
	await atMigration("20260925221019_remove_certificate_meta_files", async (knex, { step }) => {
		const id = await put(knex, "certificate", {
			meta: json({
				certificate: "PEM",
				certificate_key: "KEY",
				intermediate_certificate: "CHAIN",
				dns_challenge: true,
				propagation_seconds: 30,
			}),
		});
		const empty = await put(knex, "certificate", { meta: "{}" });
		await step();
		assert.deepEqual(parse((await knex("certificate").where("id", id).first()).meta), {
			dns_challenge: true,
			propagation_seconds: 30,
		});
		assert.deepEqual(parse((await knex("certificate").where("id", empty).first()).meta), {});
	});
});

it("20260925224722_remove_location_button_values removes the per-location button fields only", async () => {
	await atMigration("20260925224722_remove_location_button_values", async (knex, { step }) => {
		const host = await put(knex, "proxy_host", {
			locations: json([
				{
					path: "/a",
					forward_host: "app",
					caching_enabled: true,
					block_exploits: false,
					allow_websocket_upgrade: true,
					npmplus_fancyindex_upstream_compression: true,
					npmplus_disable_uri_sanitisation: false,
					npmplus_spoof_host_header: true,
					npmplus_noindex: true,
				},
			]),
		});
		const deleted = await put(knex, "proxy_host", {
			is_deleted: 1,
			locations: json([{ path: "/d", caching_enabled: true }]),
		});
		await step();
		assert.deepEqual(parse((await knex("proxy_host").where("id", host).first()).locations), [
			{ path: "/a", forward_host: "app", npmplus_noindex: true },
		]);
		// deleted hosts are not touched
		assert.deepEqual(parse((await knex("proxy_host").where("id", deleted).first()).locations), [
			{ path: "/d", caching_enabled: true },
		]);
	});
});

it("20260926003840_clean_audit_log_meta strips secrets and writes local dates as ISO", async () => {
	await atMigration("20260926003840_clean_audit_log_meta", async (knex, { step }) => {
		const dirty = await put(knex, "audit_log", {
			meta: json({
				password: "secret",
				hint: "my pet",
				certificate: "PEM",
				name: "keep",
				created_on: "2026-10-29 10:00:00",
				nested: { certificate_key: "KEY", npmplus_dns_provider_credentials: "tok", n: 1 },
			}),
		});
		const clean = await put(knex, "audit_log", { meta: json({ name: "x", created_on: "already iso" }) });
		await step();
		assert.deepEqual(parse((await knex("audit_log").where("id", dirty).first()).meta), {
			password: "",
			name: "keep",
			created_on: new Date("2026-10-29T10:00:00").toISOString(),
			nested: { n: 1 },
		});
		assert.deepEqual(parse((await knex("audit_log").where("id", clean).first()).meta), {
			name: "x",
			created_on: "already iso",
		});
	});
});

it("20260926003840_clean_audit_log_meta reaches every row beyond the first batch of 100", async () => {
	await atMigration("20260926003840_clean_audit_log_meta", async (knex, { step }) => {
		for (let n = 0; n < 230; n++) await put(knex, "audit_log", { meta: json({ n, password: "p" }) });
		await step();
		const rows = await knex("audit_log").orderBy("id");
		assert.equal(rows.length, 230);
		assert.ok(rows.every((row) => parse(row.meta).password === ""));
	});
});

it("20260926160524_meta_to_columns moves the meta keys of hosts and certificates into columns", async () => {
	await atMigration("20260926160524_meta_to_columns", async (knex, { step }) => {
		const meta = {
			nginx_online: true,
			nginx_err: "bad",
			directory: "  dir  ",
			npmplus_mtls_certificate_id: "5",
			npmplus_mtls_verify_client_optional: true,
		};
		const ids = {};
		for (const table of ["proxy_host", "redirection_host", "dead_host", "stream"]) {
			ids[table] = await put(knex, table, { meta: json(meta) });
		}
		const cert = await put(knex, "certificate", {
			meta: json({
				reuse_key: true,
				dns_challenge: true,
				dns_provider: "cloudflare",
				dns_provider_credentials: "token=1",
				propagation_seconds: "45",
				other: "gone",
			}),
		});
		const list = await put(knex, "access_list", { meta: json({ x: 1 }) });
		const listAuth = await put(knex, "access_list_auth", { meta: json({ x: 1 }) });
		const listClient = await put(knex, "access_list_client", { meta: json({ x: 1 }) });
		const auth = await put(knex, "auth", { meta: json({ x: 1 }) });
		await step();

		for (const [table, id] of Object.entries(ids)) {
			const row = await knex(table).where("id", id).first();
			assert.deepEqual(
				[
					row.npmplus_nginx_online,
					row.npmplus_nginx_err,
					row.npmplus_directory,
					row.npmplus_mtls_certificate_id,
					row.npmplus_mtls_verify_client_optional,
					row.meta,
				],
				[1, "bad", "dir", 5, 1, "{}"],
				table,
			);
		}
		const certRow = await knex("certificate").where("id", cert).first();
		assert.deepEqual(
			[
				certRow.npmplus_reuse_key,
				certRow.npmplus_dns_challenge,
				certRow.npmplus_dns_provider,
				certRow.npmplus_dns_provider_credentials,
				certRow.npmplus_propagation_seconds,
				certRow.meta,
			],
			[1, 1, "cloudflare", "token=1", 45, "{}"],
		);
		for (const [table, id] of [
			["access_list", list],
			["access_list_auth", listAuth],
			["access_list_client", listClient],
			["auth", auth],
		]) {
			assert.equal((await knex(table).where("id", id).first()).meta, "{}", table);
		}
	});
});

it("20260926160524_meta_to_columns takes defaults from a meta of null, {} or other types", async () => {
	await atMigration("20260926160524_meta_to_columns", async (knex, { step }) => {
		const empty = await put(knex, "proxy_host", { meta: "{}" });
		const odd = await put(knex, "proxy_host", {
			meta: json({ nginx_online: false, nginx_err: 5, directory: 7, npmplus_mtls_certificate_id: "x" }),
		});
		const nothing = await put(knex, "dead_host", { meta: "null" });
		await step();
		for (const row of [
			await knex("proxy_host").where("id", empty).first(),
			await knex("proxy_host").where("id", odd).first(),
		]) {
			assert.deepEqual(
				[
					row.npmplus_nginx_online,
					row.npmplus_nginx_err,
					row.npmplus_directory,
					row.npmplus_mtls_certificate_id,
				],
				[0, "", "", 0],
			);
		}
		const dead = await knex("dead_host").where("id", nothing).first();
		assert.deepEqual([dead.npmplus_nginx_online, dead.meta], [0, "{}"]);
	});
});

it("20261010135653_hard_delete removes soft-deleted rows with their relation rows and clears unused columns", async () => {
	await atMigration("20261010135653_hard_delete", async (knex, { step }) => {
		const live = await put(knex, "access_list");
		const goneList = await put(knex, "access_list", { is_deleted: 1 });
		const host = await put(knex, "proxy_host", { access_list_id: live, locations: json([]) });
		const goneHost = await put(knex, "proxy_host", { is_deleted: 1, locations: json([]) });
		const keptRedirect = await put(knex, "redirection_host");
		const goneRedirect = await put(knex, "redirection_host", { is_deleted: 1 });
		await put(knex, "dead_host", { is_deleted: 1 });
		await put(knex, "stream", { is_deleted: 1 });
		await put(knex, "certificate", { is_deleted: 1 });
		await knex("npmplus_proxy_host_access_list").insert([
			{ proxy_host_id: host, access_list_id: live },
			{ proxy_host_id: goneHost, access_list_id: live },
			{ proxy_host_id: host, access_list_id: goneList },
		]);
		await put(knex, "access_list_auth", { access_list_id: live });
		await put(knex, "access_list_auth", { access_list_id: goneList });
		await put(knex, "access_list_client", { access_list_id: goneList });
		const user = await put(knex, "user", { nickname: "nick", roles: "[]" });
		await put(knex, "auth", { user_id: user, is_deleted: 1 });
		await step();

		assert.deepEqual(await knex("proxy_host").pluck("id"), [host]);
		assert.deepEqual(await knex("redirection_host").pluck("id"), [keptRedirect]);
		assert.ok(!(await knex("redirection_host").pluck("id")).includes(goneRedirect));
		for (const table of ["dead_host", "stream", "certificate", "auth"]) {
			assert.deepEqual(await knex(table).select(), [], table);
		}
		assert.deepEqual(await knex("access_list").pluck("id"), [live]);
		assert.deepEqual(await knex("npmplus_proxy_host_access_list").select("proxy_host_id", "access_list_id"), [
			{ proxy_host_id: host, access_list_id: live },
		]);
		assert.equal((await knex("access_list_auth").select()).length, 1);
		assert.equal((await knex("access_list_client").select()).length, 0);
		assert.equal((await knex("user").where("id", user).first()).nickname, "");
		assert.equal((await knex("proxy_host").where("id", host).first()).access_list_id, 0);
	});
});

it("20261010135653_hard_delete leaves no location or relation of a deleted host or list after the whole chain", async () => {
	await atMigration("20261010135653_hard_delete", async (knex, { rest }) => {
		const live = await put(knex, "access_list");
		const goneList = await put(knex, "access_list", { is_deleted: 1 });
		const location = (path, ids) => ({ path, npmplus_access_list_type: "custom", npmplus_access_list_ids: ids });
		const host = await put(knex, "proxy_host", {
			locations: json([location("/live", [live, goneList])]),
			npmplus_access_list_type: "custom",
			npmplus_access_list_ids: json([live, goneList]),
		});
		const goneHost = await put(knex, "proxy_host", {
			is_deleted: 1,
			locations: json([location("/gone", [live])]),
			npmplus_access_list_type: "custom",
			npmplus_access_list_ids: json([live]),
		});
		await knex("npmplus_proxy_host_access_list").insert([
			{ proxy_host_id: host, access_list_id: live },
			{ proxy_host_id: goneHost, access_list_id: live },
		]);
		const goneUser = await put(knex, "user", { is_deleted: 1, roles: "[]" });
		await rest();
		assert.ok(!(await knex("user").pluck("id")).includes(goneUser));

		assert.deepEqual(await knex("proxy_host").pluck("id"), [host]);
		const locations = await knex("npmpro_location").select("proxy_host_id", "path");
		assert.deepEqual(locations, [{ proxy_host_id: host, path: "/live" }]);
		const relations = await knex("npmpro_proxy_host_access_list").select(
			"proxy_host_id",
			"location_id",
			"access_list_id",
		);
		// the host and its location keep the live list, the deleted list is gone from both
		assert.deepEqual(relations, [
			{ proxy_host_id: host, location_id: 0, access_list_id: live },
			{ proxy_host_id: host, location_id: (await knex("npmpro_location").first()).id, access_list_id: live },
		]);
	});
});

it("20261010135653_hard_delete removes deleted users with their auth and permission rows and avatar files", async () => {
	await atMigration("20261010135653_hard_delete", async (knex, { step, db }) => {
		const gone = await put(knex, "user", { is_deleted: 1, nickname: "n", roles: "[]" });
		const live = await put(knex, "user", { nickname: "n", roles: "[]" });
		await put(knex, "auth", { user_id: gone, type: "password" });
		await put(knex, "auth", { user_id: live, type: "password" });
		await put(knex, "user_permission", { user_id: gone });
		await put(knex, "user_permission", { user_id: live });
		await step();
		assert.deepEqual(await knex("user").pluck("id"), [live]);
		assert.deepEqual(await knex("auth").pluck("user_id"), [live]);
		assert.deepEqual(await knex("user_permission").pluck("user_id"), [live]);
		assert.deepEqual(db.deletedAvatars, [gone]);
		assert.equal((await knex("user").where("id", live).first()).nickname, "");
	});
});

it("20261010135653_hard_delete: rows pointing at a parent that is missing do not survive the chain", async () => {
	await atMigration("20261010135653_hard_delete", async (knex, { rest }) => {
		const live = await put(knex, "access_list");
		const host = await put(knex, "proxy_host", {
			npmplus_access_list_type: "custom",
			npmplus_access_list_ids: json([live, 9002]),
			locations: json([
				{ path: "/a", npmplus_access_list_type: "custom", npmplus_access_list_ids: [9002, live] },
			]),
		});
		// relation rows of a host and of a list that are absent (not soft-deleted)
		await knex("npmplus_proxy_host_access_list").insert([
			{ proxy_host_id: host, access_list_id: live },
			{ proxy_host_id: 9001, access_list_id: live },
			{ proxy_host_id: host, access_list_id: 9002 },
		]);
		await rest();
		// the relation table is rebuilt from the hosts and locations that exist, with the lists that exist
		const location = await knex("npmpro_location").first();
		const relations = await knex("npmpro_proxy_host_access_list")
			.orderBy(["location_id", "position"])
			.select("proxy_host_id", "location_id", "access_list_id");
		assert.deepEqual(relations, [
			{ proxy_host_id: host, location_id: 0, access_list_id: live },
			{ proxy_host_id: host, location_id: location.id, access_list_id: live },
		]);
	});
});

it("20261012163730_npmplus_location moves locations into rows and their lists into relation rows", async () => {
	await atMigration("20261012163730_npmplus_location", async (knex, { step }) => {
		const listA = await put(knex, "access_list");
		const listB = await put(knex, "access_list");
		const host = await put(knex, "proxy_host", {
			forward_port: null,
			npmplus_access_list_type: "custom",
			npmplus_access_list_ids: json([listB, listA, listB, 999]),
			locations: json([
				{
					path: "/a",
					location_type: "proxy",
					forward_scheme: "https",
					forward_host: "app",
					forward_port: "8443",
					npmplus_enabled: false,
					npmplus_noindex: true,
					npmplus_x_frame_options: "DENY",
					advanced_config: "# x",
					npmplus_access_list_type: "custom",
					npmplus_access_list_ids: [listA],
				},
				{ path: "/b" },
			]),
		});
		const empty = await put(knex, "proxy_host", { forward_port: 80, locations: json([]) });
		await step();

		const rows = await knex("npmplus_location").orderBy("id");
		assert.equal(rows.length, 2);
		assert.deepEqual(
			{ ...rows[0], id: undefined },
			{
				id: undefined,
				proxy_host_id: host,
				npmplus_enabled: 0,
				path: "/a",
				location_type: "proxy",
				forward_scheme: "https",
				forward_host: "app",
				forward_port: 8443,
				npmplus_noindex: 1,
				npmplus_crowdsec_appsec: 0,
				npmplus_proxy_request_buffering: 0,
				npmplus_proxy_response_buffering: 0,
				npmplus_upstream_compression: 0,
				npmplus_fancyindex: 0,
				npmplus_x_frame_options: "DENY",
				npmplus_auth_request: "none",
				npmplus_auth_request_upstream: "",
				advanced_config: "# x",
				npmplus_access_list_type: "custom",
			},
		);
		assert.deepEqual(
			[rows[1].path, rows[1].npmplus_enabled, rows[1].forward_scheme, rows[1].npmplus_access_list_type],
			["/b", 1, "http", "global"],
		);
		// the host list keeps its order without the duplicate and the unknown list; location_id 0 means the host
		const relations = await knex("npmplus_proxy_host_access_list").orderBy(["location_id", "position"]);
		assert.deepEqual(
			relations.map((row) => [row.proxy_host_id, row.location_id, row.access_list_id, row.position]),
			[
				[host, 0, listB, 0],
				[host, 0, listA, 1],
				[host, rows[0].id, listA, 0],
			],
		);
		const hostRow = await knex("proxy_host").where("id", host).first();
		assert.deepEqual([parse(hostRow.locations), hostRow.forward_port], [[], 0]);
		assert.equal(Object.hasOwn(hostRow, "npmplus_access_list_ids"), false);
		assert.equal((await knex("proxy_host").where("id", empty).first()).forward_port, 80);
	});
});

it("20261021225038_mtls_force_https forces https where a client certificate is required", async () => {
	await atMigration("20261021225038_mtls_force_https", async (knex, { step }) => {
		const ids = {};
		for (const table of ["proxy_host", "redirection_host", "dead_host"]) {
			const required = await put(knex, table, {
				npmplus_mtls_certificate_id: 3,
				npmplus_mtls_verify_client_optional: 0,
				ssl_forced: 0,
			});
			const optional = await put(knex, table, {
				npmplus_mtls_certificate_id: 3,
				npmplus_mtls_verify_client_optional: 1,
				ssl_forced: 0,
			});
			const none = await put(knex, table, {
				npmplus_mtls_certificate_id: 0,
				npmplus_mtls_verify_client_optional: 0,
				ssl_forced: 0,
			});
			ids[table] = [required, optional, none];
		}
		await step();
		for (const [table, [required, optional, none]] of Object.entries(ids)) {
			const forced = async (id) => (await knex(table).where("id", id).first()).ssl_forced;
			assert.deepEqual([await forced(required), await forced(optional), await forced(none)], [1, 0, 0], table);
		}
	});
});

it("20261023120000_dns_credentials groups certificates into credentials and drops the plain text column", async () => {
	await atMigration("20261023120000_dns_credentials", async (knex, { step }) => {
		const certificate = (owner, provider, ini, challenge = 1) =>
			put(knex, "certificate", {
				owner_user_id: owner,
				npmplus_dns_challenge: challenge,
				npmplus_dns_provider: provider,
				npmplus_dns_provider_credentials: ini,
			});
		const one = await certificate(1, "cloudflare", "token=a");
		const same = await certificate(1, "cloudflare", "token=a");
		const other = await certificate(1, "cloudflare", "token=b");
		const otherOwner = await certificate(2, "cloudflare", "token=a");
		const http = await certificate(1, "", "", 0);
		await step();

		const credentials = await knex("npmplus_dns_credential").orderBy("id");
		assert.equal(credentials.length, 3);
		const linked = async (id) => (await knex("certificate").where("id", id).first()).npmplus_dns_credential_id;
		assert.equal(await linked(one), await linked(same));
		assert.notEqual(await linked(one), await linked(other));
		assert.notEqual(await linked(one), await linked(otherOwner));
		assert.equal(await linked(http), null);
		// names are unique per owner
		assert.equal(new Set(credentials.filter((row) => row.owner_user_id === 1).map((row) => row.name)).size, 2);
		assert.ok(credentials.every((row) => row.provider === "cloudflare" && row.values.startsWith("v1:")));
		assert.equal(Object.hasOwn(await knex("certificate").columnInfo(), "npmplus_dns_provider_credentials"), false);
	});
});

it("an install from 2026-02 (new_proxy_buttons) upgrades with every row and the schema of a new install", async () => {
	await atMigration("20260208140601_new_proxy_buttons", async (knex, { rest }) => {
		const list = await put(knex, "access_list", { name: "L" });
		const user = await put(knex, "user", { email: "Admin@Example.com", name: "Admin", roles: json(["admin"]) });
		const cert = await put(knex, "certificate", {
			owner_user_id: user,
			nice_name: "cert",
			domain_names: json(["a.example"]),
		});
		const proxy = await put(knex, "proxy_host", {
			owner_user_id: user,
			domain_names: json(["p.example"]),
			forward_host: "app",
			forward_port: 8080,
			access_list_id: list,
			certificate_id: cert,
			locations: json([{ path: "/x", forward_host: "x", forward_port: 81 }]),
		});
		const redirect = await put(knex, "redirection_host", {
			owner_user_id: user,
			domain_names: json(["r.example"]),
		});
		const dead = await put(knex, "dead_host", { owner_user_id: user, domain_names: json(["d.example"]) });
		const stream = await put(knex, "stream", { owner_user_id: user, incoming_port: "5353" });
		await rest();

		const one = async (table, id) => knex(table).where("id", id).first();
		assert.equal((await one("user", user)).email, "admin@example.com");
		assert.equal((await one("certificate", cert)).nice_name, "cert");
		assert.equal((await one("access_list", list)).name, "L");
		assert.deepEqual(parse((await one("proxy_host", proxy)).domain_names), ["p.example"]);
		assert.deepEqual(parse((await one("redirection_host", redirect)).domain_names), ["r.example"]);
		assert.deepEqual(parse((await one("dead_host", dead)).domain_names), ["d.example"]);
		assert.equal(String((await one("stream", stream)).incoming_port), "5353");
		assert.deepEqual(
			await knex("npmpro_location").select("proxy_host_id", "path", "forward_host", "forward_port"),
			[{ proxy_host_id: proxy, path: "/x", forward_host: "x", forward_port: 81 }],
		);
		const expected = JSON.parse(await readFile(SNAPSHOT, "utf8"));
		assert.deepEqual(await schemaSnapshot(knex), expected);
	});
});

it("20260926160524_meta_to_columns reads an empty-string meta like an empty object", { todo: "BUG-13" }, async () => {
	await atMigration("20260926160524_meta_to_columns", async (knex, { step }) => {
		const host = await put(knex, "proxy_host", { meta: "" });
		await step();
		const row = await knex("proxy_host").where("id", host).first();
		assert.deepEqual([row.npmplus_nginx_online, row.npmplus_directory, row.meta], [0, "", "{}"]);
	});
});

it("a user stored twice in different case keeps both rows through the upgrade", async () => {
	await atMigration("20260913183434_lowercase_emails", async (knex, { step }) => {
		const upper = await put(knex, "user", { email: "A@x.example", roles: "[]" });
		const lower = await put(knex, "user", { email: "a@x.example", roles: "[]" });
		const error = await step().then(
			() => null,
			(err) => err,
		);
		// finished, or stopped with an error that names the problem; either way both rows are still there
		if (error) assert.match(String(error), /UNIQUE|unique|constraint|email/u);
		assert.deepEqual(await knex("user").orderBy("id").pluck("id"), [upper, lower]);
	});
});

it("a user stored twice in different case does not end as two users with one address", { todo: "BUG-12" }, async () => {
	await atMigration("20260913183434_lowercase_emails", async (knex, { step }) => {
		await put(knex, "user", { email: "A@x.example", roles: "[]" });
		await put(knex, "user", { email: "a@x.example", roles: "[]" });
		// the app refuses a second user with a taken address (internal/user.js isEmailAvailable), so the upgrade must
		// either stop with an error or keep the addresses distinct
		const failed = await step().then(
			() => false,
			() => true,
		);
		const emails = await knex("user").pluck("email");
		assert.ok(failed || new Set(emails).size === emails.length, `two users share an address: ${emails}`);
	});
});
