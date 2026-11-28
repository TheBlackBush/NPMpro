import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { checkAdminOnly, checkItemValues, checkPageImport } from "../lib/backup/import-checks.js";
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
		await check(
			knex,
			[item("access_lists", 1)],
			list({
				access_list_client: [{ id: 2, access_list_id: 1, address: "10.0.0.0/8", npmpro_comment: "Office" }],
				npmpro_access_list_country: [{ id: 1, access_list_id: 1, country: "DE", npmpro_comment: "Berlin" }],
			}),
		);
		await assert.rejects(
			check(
				knex,
				[item("access_lists", 1)],
				list({ npmpro_access_list_country: [{ id: 1, access_list_id: 1, country: "de" }] }),
			),
			refuses("npmpro_access_list_country.country"),
		);
		await assert.rejects(
			check(
				knex,
				[item("access_lists", 1)],
				list({
					npmpro_access_list_country: [
						{ id: 1, access_list_id: 1, country: "DE", npmpro_comment: "x".repeat(256) },
					],
				}),
			),
			refuses("npmpro_access_list_country.npmpro_comment"),
		);
		await assert.rejects(
			check(
				knex,
				[item("access_lists", 1)],
				list({
					access_list_client: [
						{ id: 2, access_list_id: 1, address: "10.0.0.0/8", npmpro_comment: "x".repeat(256) },
					],
				}),
			),
			refuses("access_list_client.npmpro_comment"),
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

it("refuses values whose type is not the API schema's, raw config above all", async () => {
	const knex = await database();
	try {
		const host = { id: 1, domain_names: '["a.example.com"]', forward_host: "app", forward_port: 80 };
		const hostWith = (values, location) => ({
			proxy_hosts: {
				proxy_host: [{ ...host, ...values }],
				npmpro_location: location
					? [{ id: 5, proxy_host_id: 1, path: "/x/", forward_host: "app", ...location }]
					: [],
			},
		});
		const probes = [
			[hostWith({ advanced_config: { a: "x;}" } }), "advanced_config"],
			[hostWith({ npmpro_location_config: 5 }), "npmpro_location_config"],
			[hostWith({}, { advanced_config: { a: "x;}" } }), "locations[0].advanced_config"],
			[hostWith({ forward_port: [80] }), "forward_port"],
			[hostWith({ forward_host: ["127.0.0.1"] }), "forward_host"],
			[hostWith({ enabled: "yes" }), "enabled"],
			[hostWith({ domain_names: { a: 1 } }), "domain_names"],
			[hostWith({ npmpro_x_frame_options: null }), "npmpro_x_frame_options"],
			[{ streams: { stream: [{ id: 1, npmpro_advanced_config: ["x"] }] } }, "npmpro_advanced_config", "streams"],
		];
		for (const [data, field, type = "proxy_hosts"] of probes) {
			await assert.rejects(check(knex, [item(type, 1)], data), refuses(field), field);
		}
		// what a database export holds passes: integers for booleans, JSON text, null where the schema allows it
		await check(knex, [item("proxy_hosts", 1)], hostWith({ enabled: 1, advanced_config: null }));
		await check(knex, [item("certificates", 1)], {
			certificates: {
				certificate: [
					{ id: 1, provider: "letsencrypt", domain_names: ["a.com"], npmpro_dns_credential_id: null },
				],
			},
		});
	} finally {
		await knex.destroy();
	}
});

it("checks the values of every merge apart from the admin-only fields", async () => {
	const knex = await database();
	try {
		const host = { id: 1, domain_names: '["a.example.com"]', forward_host: "app", forward_port: 80 };
		const hosts = (values, locations = []) => ({
			proxy_hosts: { proxy_host: [{ ...host, ...values }], npmpro_location: locations },
		});
		const items = [item("proxy_hosts", 1)];
		const adminOnly = hosts({ advanced_config: "return 200;", forward_scheme: "path", forward_host: "/srv/site" }, [
			{ id: 5, proxy_host_id: 1, path: "/x/", forward_host: "app", advanced_config: "return 204;" },
		]);
		// what only an administrator may set passes the value checks and fails the admin-only ones
		await checkItemValues({ plan: { items }, data: adminOnly });
		await assert.rejects(checkAdminOnly({ knex, plan: { items }, data: adminOnly }), refuses("advanced_config"));
		await assert.rejects(checkPageImport({ knex, plan: { items }, data: adminOnly }), refuses("advanced_config"));
		// a value the API refuses everyone fails the value checks, not the admin-only ones
		for (const [data, field] of [
			[hosts({ forward_port: [80] }), "forward_port"],
			[hosts({ domain_names: '["lim7c.example.com;"]' }), "domain_names"],
			[hosts({ advanced_config: ["return 200;"] }), "advanced_config"],
			[
				hosts({}, [
					{ id: 5, proxy_host_id: 1, path: "/x/", forward_host: "app" },
					{ id: 6, proxy_host_id: 1, path: "/x/", forward_host: "app" },
				]),
				"locations",
			],
		]) {
			await assert.rejects(checkItemValues({ plan: { items }, data }), refuses(field));
			await checkAdminOnly({ knex, plan: { items }, data });
		}
		await assert.rejects(
			checkItemValues({
				plan: { items: [item("certificates", 1)] },
				data: {
					certificates: { certificate: [{ id: 1, provider: "other", domain_names: '["a.example.com;"]' }] },
				},
			}),
			refuses("domain_names"),
		);
	} finally {
		await knex.destroy();
	}
});

it("refuses host tags outside the API rule: a bad tag or more than 10, and passes a valid list", async () => {
	const host = { id: 1, domain_names: '["a.example.com"]', forward_host: "app", forward_port: 80 };
	const run = (tags) =>
		checkItemValues({
			plan: { items: [item("proxy_hosts", 1)] },
			data: { proxy_hosts: { proxy_host: [{ ...host, npmpro_tags: tags }], npmpro_location: [] } },
		});
	await run(["Lab", "café"]);
	await run(JSON.stringify(["Lab"]));
	for (const tags of [["a/b"], [" lead"], Array.from({ length: 11 }, (_, n) => `t${n}`)]) {
		await assert.rejects(run(tags), refuses("npmpro_tags"));
	}
});

it("refuses unix: targets, request variables and regex domains on the hosts of a non-admin import", async () => {
	const knex = await database();
	try {
		const proxy = (values) => ({
			proxy_hosts: {
				proxy_host: [
					{ id: 1, domain_names: '["a.example.com"]', forward_host: "app", forward_port: 80, ...values },
				],
			},
		});
		const stream = (values) => ({
			streams: {
				stream: [{ id: 1, incoming_port: "8443", forwarding_host: "db", tcp_forwarding: 1, ...values }],
			},
		});
		const redirection = (values) => ({
			redirection_hosts: {
				redirection_host: [
					{ id: 1, domain_names: '["a.example.com"]', forward_domain_name: "b.com", ...values },
				],
			},
		});
		for (const [type, data, field] of [
			["proxy_hosts", proxy({ forward_host: "unix:/run/nginx-control.sock" }), "forward_host"],
			["proxy_hosts", proxy({ forward_host: "UNIX:/run/npmpro.sock" }), "forward_host"],
			["proxy_hosts", proxy({ forward_host: "$http_x" }), "forward_host"],
			["proxy_hosts", proxy({ domain_names: '["~^.*$"]' }), "domain_names"],
			["streams", stream({ forwarding_host: "unix:/run/npmpro.sock" }), "forwarding_host"],
			["streams", stream({ forwarding_host: "$remote_addr" }), "forwarding_host"],
			["redirection_hosts", redirection({ forward_domain_name: "unix:/x" }), "forward_domain_name"],
			["redirection_hosts", redirection({ domain_names: '["~x"]' }), "domain_names"],
		]) {
			await assert.rejects(check(knex, [item(type, 1)], data), refuses(field), `${type} ${field}`);
			// an administrator's merge may set them
			await checkItemValues({ plan: { items: [item(type, 1)] }, data });
		}
		// a location's unix: target is named by its field
		await assert.rejects(
			check(knex, [item("proxy_hosts", 1)], {
				proxy_hosts: {
					...proxy({}).proxy_hosts,
					npmpro_location: [{ id: 5, proxy_host_id: 1, path: "/x/", forward_host: "unix:/run/x.sock" }],
				},
			}),
			refuses("locations[0].forward_host"),
		);
		// a replace keeps the stored values
		await knex("proxy_host").insert({
			id: 9,
			domain_names: '["~^x$"]',
			forward_host: "unix:/run/app.sock",
		});
		const replace = item("proxy_hosts", 1, "replace", { type: "proxy_hosts", id: 9 });
		await check(knex, [replace], proxy({ domain_names: '["~^x$"]', forward_host: "unix:/run/app.sock" }));
		await assert.rejects(
			check(knex, [replace], proxy({ forward_host: "unix:/run/other.sock" })),
			refuses("forward_host"),
		);
	} finally {
		await knex.destroy();
	}
});

it("refuses an imported stream on a port NPMpro listens on or with a range wider than 1000 ports, for everyone", async () => {
	const knex = await database();
	try {
		const stream = (overrides) => ({
			streams: {
				stream: [
					{
						id: 1,
						incoming_port: "8443",
						forwarding_host: "db",
						tcp_forwarding: 1,
						enabled: 1,
						...overrides,
					},
				],
			},
		});
		const values = (data) => checkItemValues({ plan: { items: [item("streams", 1)] }, data });
		await values(stream({}));
		for (const port of ["443", "80", "81", "440-450", "1-65535", "2000-3000"]) {
			await assert.rejects(values(stream({ incoming_port: port })), refuses("incoming_port"), port);
			await assert.rejects(
				check(knex, [item("streams", 1)], stream({ incoming_port: port })),
				refuses("incoming_port"),
			);
		}
		// UDP on the HTTP and admin ports stays possible, a disabled stream listens nowhere, 1000 ports pass
		await values(stream({ incoming_port: "80", tcp_forwarding: 0, udp_forwarding: 1 }));
		await values(stream({ incoming_port: "443", enabled: 0 }));
		await values(stream({ incoming_port: "2000-2999" }));
		// the range cap holds for a disabled stream too, it is refused on save as well
		await assert.rejects(values(stream({ incoming_port: "1-65535", enabled: 0 })), refuses("incoming_port"));
	} finally {
		await knex.destroy();
	}
});
