import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { checkPageImport } from "../lib/backup/import-checks.js";
import { createSchema } from "./support/backup-schema.js";

const database = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await createSchema(knex);
	return knex;
};

const item = (type, id, action = "add", target = null) => ({
	key: `${type}:${id}`,
	type,
	id,
	label: `item ${id}`,
	action,
	target,
});

const refuses = (field) => (error) =>
	error.code === "invalid-item" && error.message.includes(field) && error.message.includes("item 1");

const check = (knex, items, data) => checkPageImport({ knex, plan: { items }, data });

it("refuses raw config and file serving in locations, streams and redirection hosts", async () => {
	const knex = await database();
	try {
		const host = { id: 1, domain_names: '["a.example.com"]', forward_host: "app", forward_port: 80 };
		const withLocation = (location) => ({
			proxy_hosts: {
				proxy_host: [host],
				npmpro_location: [{ id: 5, proxy_host_id: 1, path: "/x/", forward_host: "app", ...location }],
			},
		});
		await check(knex, [item("proxy_hosts", 1)], withLocation({}));
		await assert.rejects(
			check(knex, [item("proxy_hosts", 1)], withLocation({ advanced_config: "return 200;" })),
			refuses("locations[0].advanced_config"),
		);
		await assert.rejects(
			check(knex, [item("proxy_hosts", 1)], withLocation({ forward_scheme: "path", forward_host: "/etc/" })),
			refuses("locations[0].forward_host"),
		);
		await assert.rejects(
			check(knex, [item("proxy_hosts", 1)], withLocation({ path: "/a b" })),
			refuses("locations[0].path"),
		);
		await assert.rejects(
			check(knex, [item("proxy_hosts", 1)], {
				proxy_hosts: { proxy_host: [{ ...host, npmpro_location_config: "x" }] },
			}),
			refuses("npmpro_location_config"),
		);
		await assert.rejects(
			check(knex, [item("streams", 1)], { streams: { stream: [{ id: 1, npmpro_advanced_config: "x" }] } }),
			refuses("npmpro_advanced_config"),
		);
		await assert.rejects(
			check(knex, [item("streams", 1)], { streams: { stream: [{ id: 1, forwarding_host: "db;x" }] } }),
			refuses("forwarding_host"),
		);
		await assert.rejects(
			check(knex, [item("redirection_hosts", 1)], {
				redirection_hosts: { redirection_host: [{ id: 1, forward_domain_name: "x.com\n}" }] },
			}),
			refuses("forward_domain_name"),
		);
		// a skipped item is not written, so not checked
		await check(knex, [item("streams", 1, "skip")], {
			streams: { stream: [{ id: 1, npmpro_advanced_config: "x" }] },
		});
	} finally {
		await knex.destroy();
	}
});

it("refuses access list addresses and user names and certificate domains with nginx syntax", async () => {
	const knex = await database();
	try {
		const list = (children) => ({ access_lists: { access_list: [{ id: 1, name: "L" }], ...children } });
		await check(
			knex,
			[item("access_lists", 1)],
			list({ access_list_client: [{ id: 2, access_list_id: 1, address: "10.0.0.0/8", directive: "allow" }] }),
		);
		await assert.rejects(
			check(
				knex,
				[item("access_lists", 1)],
				list({ access_list_client: [{ id: 2, access_list_id: 1, address: "all; return 200" }] }),
			),
			refuses("access_list_client.address"),
		);
		await assert.rejects(
			check(
				knex,
				[item("access_lists", 1)],
				list({ access_list_auth: [{ id: 2, access_list_id: 1, username: "a:b" }] }),
			),
			refuses("access_list_auth.username"),
		);
		await assert.rejects(
			check(knex, [item("certificates", 1)], {
				certificates: { certificate: [{ id: 1, provider: "letsencrypt", domain_names: '["a.com;x"]' }] },
			}),
			refuses("domain_names"),
		);
	} finally {
		await knex.destroy();
	}
});

it("lets a replace keep the stored raw config but not change it", async () => {
	const knex = await database();
	try {
		await knex("proxy_host").insert({ id: 9, domain_names: '["a.example.com"]', advanced_config: "set $x 1;" });
		const replace = item("proxy_hosts", 1, "replace", { type: "proxy_hosts", id: 9 });
		const data = (advanced) => ({
			proxy_hosts: { proxy_host: [{ id: 1, domain_names: '["a.example.com"]', advanced_config: advanced }] },
		});
		await check(knex, [replace], data("set $x 1;"));
		await assert.rejects(check(knex, [replace], data("set $x 2;")), refuses("advanced_config"));
		await assert.rejects(check(knex, [item("proxy_hosts", 1)], data("set $x 1;")), refuses("advanced_config"));
	} finally {
		await knex.destroy();
	}
});
