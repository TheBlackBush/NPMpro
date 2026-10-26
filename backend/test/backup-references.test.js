import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { applyReferences, planReferences } from "../lib/backup/references.js";

const host = (id, extra = {}) => ({
	id,
	domain_names: [`h${id}.example.com`],
	certificate_id: 0,
	npmpro_mtls_certificate_id: 0,
	owner_user_id: 1,
	...extra,
});

const base = () => ({
	user: [{ id: 1 }],
	certificate: [],
	access_list: [],
	npmpro_dns_credential: [],
	npmpro_proxy_host_access_list: [],
});

it("clears a restored host's certificate the instance does not have, keeps one it has", () => {
	const finalRows = {
		...base(),
		certificate: [{ id: 2, nice_name: "kept", owner_user_id: 1, npmpro_dns_credential_id: null }],
		proxy_host: [host(1, { certificate_id: 9, domain_names: ["app.example.com"] }), host(2, { certificate_id: 2 })],
	};
	const changes = planReferences({ finalRows, adminUserId: 1 });
	assert.deepEqual(changes, [
		{
			table: "proxy_host",
			id: 1,
			column: "certificate_id",
			from: 9,
			to: 0,
			label: "proxy_host app.example.com: certificate #9 not found",
		},
	]);
});

it("clears kept hosts that reference a certificate the backup lacks, including mTLS", () => {
	const finalRows = {
		...base(),
		stream: [
			{ id: 4, certificate_id: 5, npmpro_mtls_certificate_id: 6, owner_user_id: 1, domain_names: undefined },
		],
	};
	const changes = planReferences({ finalRows, adminUserId: 1 });
	assert.deepEqual(
		changes.map((c) => [c.table, c.id, c.column, c.to, c.label]),
		[
			["stream", 4, "certificate_id", 0, "stream #4: certificate #5 not found"],
			["stream", 4, "npmpro_mtls_certificate_id", 0, "stream #4: client certificate #6 not found"],
		],
	);
});

it("removes an access list link to a missing list", () => {
	const finalRows = {
		...base(),
		access_list: [{ id: 1, name: "ok", owner_user_id: 1 }],
		proxy_host: [host(1)],
		npmpro_proxy_host_access_list: [
			{ proxy_host_id: 1, location_id: 0, access_list_id: 1, position: 0 },
			{ proxy_host_id: 1, location_id: 3, access_list_id: 7, position: 1 },
		],
	};
	assert.deepEqual(planReferences({ finalRows, adminUserId: 1 }), [
		{
			table: "npmpro_proxy_host_access_list",
			proxy_host_id: 1,
			location_id: 3,
			access_list_id: 7,
			column: "*",
			from: 7,
			to: null,
			label: "proxy_host h1.example.com: access list #7 not found",
		},
	]);
});

it("clears a certificate's missing DNS credential", () => {
	const finalRows = {
		...base(),
		npmpro_dns_credential: [{ id: 1, name: "cf", owner_user_id: 1 }],
		certificate: [
			{ id: 1, nice_name: "a", owner_user_id: 1, npmpro_dns_credential_id: 1 },
			{ id: 2, nice_name: "b", owner_user_id: 1, npmpro_dns_credential_id: 8 },
		],
	};
	assert.deepEqual(planReferences({ finalRows, adminUserId: 1 }), [
		{
			table: "certificate",
			id: 2,
			column: "npmpro_dns_credential_id",
			from: 8,
			to: null,
			label: "certificate b: DNS credential #8 not found",
		},
	]);
});

it("reassigns rows whose owner is missing to the admin", () => {
	const finalRows = {
		...base(),
		user: [{ id: 1 }],
		access_list: [{ id: 3, name: "list", owner_user_id: 5 }],
		npmpro_dns_credential: [{ id: 2, name: "cred", owner_user_id: 5 }],
		redirection_host: [host(1, { owner_user_id: 6 })],
	};
	const changes = planReferences({ finalRows, adminUserId: 1 });
	assert.deepEqual(
		changes.map((c) => [c.table, c.id, c.column, c.from, c.to, c.label]),
		[
			["redirection_host", 1, "owner_user_id", 6, 1, "redirection_host h1.example.com: owner #6 not found"],
			["access_list", 3, "owner_user_id", 5, 1, "access_list list: owner #5 not found"],
			["npmpro_dns_credential", 2, "owner_user_id", 5, 1, "npmpro_dns_credential cred: owner #5 not found"],
		],
	);
});

it("returns an empty list when every reference resolves", () => {
	const finalRows = {
		...base(),
		certificate: [{ id: 1, nice_name: "c", owner_user_id: 1, npmpro_dns_credential_id: null }],
		proxy_host: [host(1, { certificate_id: 1 })],
	};
	assert.deepEqual(planReferences({ finalRows, adminUserId: 1 }), []);
});

it("applyReferences writes updates and removes link rows", async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	try {
		await knex.schema.createTable("proxy_host", (t) => {
			t.increments("id");
			t.integer("certificate_id");
			t.integer("owner_user_id");
		});
		await knex.schema.createTable("certificate", (t) => {
			t.increments("id");
			t.integer("npmpro_dns_credential_id").nullable();
		});
		await knex.schema.createTable("npmpro_proxy_host_access_list", (t) => {
			t.integer("proxy_host_id");
			t.integer("location_id");
			t.integer("access_list_id");
			t.integer("position");
		});
		await knex("proxy_host").insert([
			{ certificate_id: 9, owner_user_id: 5 },
			{ certificate_id: 9, owner_user_id: 5 },
		]);
		await knex("certificate").insert({ npmpro_dns_credential_id: 8 });
		await knex("npmpro_proxy_host_access_list").insert([
			{ proxy_host_id: 1, location_id: 0, access_list_id: 7, position: 0 },
			{ proxy_host_id: 1, location_id: 0, access_list_id: 1, position: 1 },
		]);
		await knex.transaction((trx) =>
			applyReferences(trx, [
				{ table: "proxy_host", id: 1, column: "certificate_id", from: 9, to: 0, label: "" },
				{ table: "proxy_host", id: 1, column: "owner_user_id", from: 5, to: 1, label: "" },
				{ table: "certificate", id: 1, column: "npmpro_dns_credential_id", from: 8, to: null, label: "" },
				{
					table: "npmpro_proxy_host_access_list",
					proxy_host_id: 1,
					location_id: 0,
					access_list_id: 7,
					column: "*",
					from: 7,
					to: null,
					label: "",
				},
			]),
		);
		assert.deepEqual(await knex("proxy_host").orderBy("id"), [
			{ id: 1, certificate_id: 0, owner_user_id: 1 },
			{ id: 2, certificate_id: 9, owner_user_id: 5 },
		]);
		assert.equal((await knex("certificate").first()).npmpro_dns_credential_id, null);
		assert.deepEqual(await knex("npmpro_proxy_host_access_list"), [
			{ proxy_host_id: 1, location_id: 0, access_list_id: 1, position: 1 },
		]);
	} finally {
		await knex.destroy();
	}
});
