import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const OLD_COLUMNS = {
	is_deleted: 0,
	meta: "{}",
	http2_support: 1,
	block_exploits: 1,
	access_list_id: 3,
	caching_enabled: 1,
	allow_websocket_upgrade: 1,
	trust_forwarded_proto: 0,
	locations: "[]",
};
const KEPT = {
	dead: [
		"block_exploits",
		"access_list_id",
		"caching_enabled",
		"allow_websocket_upgrade",
		"trust_forwarded_proto",
		"locations",
	],
	redirection: ["access_list_id", "caching_enabled", "allow_websocket_upgrade", "trust_forwarded_proto", "locations"],
	stream: [
		"http2_support",
		"block_exploits",
		"access_list_id",
		"caching_enabled",
		"allow_websocket_upgrade",
		"trust_forwarded_proto",
		"locations",
	],
	proxy: [],
};
const DEFAULTS = {
	dead: { domain_names: [], meta: {}, advanced_config: "", npmpro_nginx_err: "" },
	redirection: { domain_names: [], meta: {}, advanced_config: "", npmpro_nginx_err: "" },
	stream: { meta: {}, npmpro_advanced_config: "", npmpro_nginx_err: "" },
	proxy: {
		domain_names: [],
		meta: {},
		advanced_config: "",
		npmpro_location_config: "",
		npmpro_nginx_err: "",
		npmpro_access_list_type: "public",
	},
};
const TABLES = { dead: "dead_host", redirection: "redirection_host", stream: "stream", proxy: "proxy_host" };
const FILES = { dead: "dead_host", redirection: "redirection_host", stream: "stream", proxy: "proxy_host" };
let api;
const models = {};

before(async () => {
	api = await startApi();
	for (const [name, file] of Object.entries(FILES)) models[name] = (await import(`../models/${file}.js`)).default;
});
after(() => api?.stop());

for (const name of Object.keys(FILES)) {
	it(`${name}: reads a row without the old columns, with booleans`, () => {
		const row = models[name].fromDatabaseJson({ id: 7, enabled: 1, npmpro_nginx_online: 0, ...OLD_COLUMNS });
		assert.equal(row.id, 7);
		assert.equal(row.enabled, true);
		assert.equal(row.npmpro_nginx_online, false);
		const present = Object.keys(OLD_COLUMNS).filter((key) => key in row);
		assert.deepEqual(present.sort(), [...KEPT[name]].sort());
	});

	it(`${name}: writes booleans as numbers, without certificate request fields`, () => {
		const written = new models[name]().$formatDatabaseJson({
			enabled: true,
			npmpro_nginx_online: false,
			npmpro_dns_challenge: true,
			npmpro_reuse_key: true,
			domain_names: ["a.example.com"],
			npmpro_access_list_ids: [1],
		});
		assert.equal(written.enabled, 1);
		assert.equal(written.npmpro_nginx_online, 0);
		assert.equal("npmpro_dns_challenge" in written, false);
		assert.equal("npmpro_reuse_key" in written, false);
		assert.equal("domain_names" in written, name !== "stream");
		assert.equal("npmpro_access_list_ids" in written, name !== "proxy");
	});

	it(`${name}: fills the defaults on insert and the dates, and keeps a given value`, () => {
		const row = new models[name]();
		row.$beforeInsert();
		const { created_on, modified_on, ...rest } = row;
		assert.ok(created_on);
		assert.ok(modified_on);
		assert.deepEqual({ ...rest }, DEFAULTS[name]);
		const other = new models[name]();
		other.$beforeInsert();
		assert.notEqual(row.meta, other.meta, "each row has its own object");
		const given = new models[name]();
		given.npmpro_nginx_err = "kept";
		given.$beforeInsert();
		assert.equal(given.npmpro_nginx_err, "kept");
	});

	it(`${name}: sets modified_on on update and keeps its table`, () => {
		const row = new models[name]();
		row.$beforeUpdate();
		assert.ok(row.modified_on);
		assert.equal(models[name].tableName, TABLES[name]);
	});
}

it("keeps the relations of each model", () => {
	for (const name of ["dead", "redirection", "stream"]) {
		assert.deepEqual(Object.keys(models[name].relationMappings).sort(), ["certificate", "owner"]);
	}
	assert.deepEqual(Object.keys(models.proxy.relationMappings).sort(), [
		"access_lists",
		"certificate",
		"locations",
		"owner",
	]);
});
