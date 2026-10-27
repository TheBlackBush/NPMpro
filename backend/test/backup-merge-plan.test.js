import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { planHash, planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { createSchema } from "./support/backup-schema.js";

const SCOPE = {
	adminUserId: 1,
	importerId: 1,
	page: false,
	canView: () => true,
	canManage: () => true,
	canEdit: () => true,
	visibleOwnerId: null,
};

const plan = (options) =>
	planMerge({
		data: {},
		instance: {},
		stageFiles: {},
		types: [],
		secrets: true,
		...options,
		scope: { ...SCOPE, ...options.scope },
	});

const find = (result, key) => result.items.find((item) => item.key === key);

// two proxy hosts that both use certificate 4
const hostsWithCertificate = (certificate) => ({
	proxy_hosts: {
		proxy_host: [
			{ id: 1, domain_names: ["one.example.com"], certificate_id: 4 },
			{ id: 2, domain_names: ["two.example.com"], certificate_id: 4 },
		],
		npmpro_location: [],
		npmpro_proxy_host_access_list: [],
	},
	certificates: { certificate: certificate ? [certificate] : [] },
});

it("adds a host without a clash and offers skip or replace for a domain in use", () => {
	const data = {
		proxy_hosts: {
			proxy_host: [
				{ id: 2, domain_names: ["new.example.com"] },
				{ id: 3, domain_names: ["App.Example.com"] },
			],
		},
	};
	const instance = { redirection_host: [{ id: 12, domain_names: ["app.example.com"] }] };
	const result = plan({ data, instance, types: ["proxy_hosts"] });
	const fresh = find(result, "proxy_hosts:2");
	assert.equal(fresh.action, "add");
	assert.equal(fresh.reason, null);
	assert.deepEqual(fresh.choices, []);
	assert.equal(fresh.target, null);
	const clash = find(result, "proxy_hosts:3");
	assert.equal(clash.action, "skip");
	assert.equal(clash.reason, "domain-in-use");
	assert.deepEqual(clash.target, { type: "redirection_hosts", id: 12, label: "app.example.com" });
	assert.deepEqual(clash.choices, ["skip", "replace"]);
	assert.equal(clash.default, "skip");
	assert.equal(clash.linked, false);
	assert.equal(clash.unticked, false);
	const replaced = plan({ data, instance, types: ["proxy_hosts"], choices: { "proxy_hosts:3": "replace" } });
	assert.equal(find(replaced, "proxy_hosts:3").action, "replace");
	assert.deepEqual(replaced.counts, { add: 1, replace: 1, skip: 0, existing: 0, take: 0, keep: 0 });
});

it("only skips a host that matches several instance hosts", () => {
	const data = { dead_hosts: { dead_host: [{ id: 1, domain_names: ["a.example.com", "b.example.com"] }] } };
	const instance = {
		proxy_host: [{ id: 7, domain_names: ["b.example.com"] }],
		dead_host: [{ id: 4, domain_names: ["a.example.com"] }],
	};
	const result = plan({ data, instance, types: ["dead_hosts"], choices: { "dead_hosts:1": "replace" } });
	const item = find(result, "dead_hosts:1");
	assert.equal(item.reason, "domain-in-use-several");
	assert.deepEqual(item.choices, ["skip"]);
	assert.equal(item.action, "skip");
	assert.deepEqual(item.target, { type: "proxy_hosts", id: 7, label: "b.example.com" });
});

it("clashes a stream on the same port only with an overlapping protocol", () => {
	const data = { streams: { stream: [{ id: 1, incoming_port: 2222, tcp_forwarding: 1, udp_forwarding: 0 }] } };
	const both = plan({
		data,
		instance: { stream: [{ id: 5, incoming_port: "2222", tcp_forwarding: 1, udp_forwarding: 1 }] },
		types: ["streams"],
	});
	assert.equal(find(both, "streams:1").reason, "port-in-use");
	assert.equal(find(both, "streams:1").action, "skip");
	assert.equal(find(both, "streams:1").target.id, 5);
	const udp = plan({
		data,
		instance: { stream: [{ id: 5, incoming_port: 2222, tcp_forwarding: 0, udp_forwarding: 1 }] },
		types: ["streams"],
	});
	assert.equal(find(udp, "streams:1").action, "add");
});

it("matches a linked certificate by its domains or by provider and name", () => {
	const data = hostsWithCertificate({
		id: 4,
		provider: "letsencrypt",
		domain_names: ["b.example.com", "a.example.com"],
	});
	const instance = {
		certificate: [{ id: 9, provider: "letsencrypt", domain_names: ["A.example.com", "b.example.com"] }],
	};
	const result = plan({ data, instance, types: ["proxy_hosts"] });
	const certificate = find(result, "certificates:4");
	assert.equal(certificate.action, "existing");
	assert.equal(certificate.reason, "same-certificate");
	assert.equal(certificate.linked, true);
	assert.deepEqual(certificate.needed_by, ["proxy_hosts:1", "proxy_hosts:2"]);
	assert.deepEqual(certificate.choices, ["existing", "add"]);
	assert.equal(certificate.target.id, 9);
	assert.deepEqual(result.cleared_links, []);
	const added = plan({ data, instance, types: ["proxy_hosts"], choices: { "certificates:4": "add" } });
	assert.equal(find(added, "certificates:4").action, "add");

	const named = plan({
		data: hostsWithCertificate({ id: 4, provider: "other", nice_name: "Client CA", domain_names: [] }),
		instance: { certificate: [{ id: 7, provider: "other", nice_name: "client ca", domain_names: [] }] },
		types: ["proxy_hosts"],
	});
	assert.equal(find(named, "certificates:4").action, "existing");
	assert.equal(find(named, "certificates:4").target.id, 7);
});

it("drops an unticked linked certificate without a match and clears its links", () => {
	const data = hostsWithCertificate({ id: 4, provider: "letsencrypt", domain_names: ["c.example.com"] });
	const result = plan({ data, types: ["proxy_hosts"], choices: { "certificates:4": "unticked" } });
	const certificate = find(result, "certificates:4");
	assert.equal(certificate.action, "skip");
	assert.equal(certificate.unticked, true);
	assert.deepEqual(result.cleared_links, [
		{ key: "proxy_hosts:1", column: "certificate_id", from: 4, label: "c.example.com" },
		{ key: "proxy_hosts:2", column: "certificate_id", from: 4, label: "c.example.com" },
	]);
	const matched = plan({
		data,
		instance: { certificate: [{ id: 8, provider: "letsencrypt", domain_names: ["c.example.com"] }] },
		types: ["proxy_hosts"],
		choices: { "certificates:4": "unticked" },
	});
	assert.equal(find(matched, "certificates:4").action, "existing");
	assert.equal(find(matched, "certificates:4").unticked, true);
	assert.deepEqual(matched.cleared_links, []);
});

it("clears a link to a row the file does not hold", () => {
	const result = plan({ data: hostsWithCertificate(null), types: ["proxy_hosts"] });
	assert.equal(find(result, "certificates:4"), undefined);
	assert.deepEqual(
		result.cleared_links.map(({ key, label }) => [key, label]),
		[
			["proxy_hosts:1", "#4"],
			["proxy_hosts:2", "#4"],
		],
	);
});

it("plans a selected certificate also needed by a host as one item", () => {
	const data = hostsWithCertificate({ id: 4, provider: "letsencrypt", domain_names: ["c.example.com"] });
	const result = plan({ data, types: ["proxy_hosts", "certificates"] });
	const certificates = result.items.filter((item) => item.type === "certificates");
	assert.equal(certificates.length, 1);
	assert.equal(certificates[0].linked, false);
	assert.deepEqual(certificates[0].needed_by, ["proxy_hosts:1", "proxy_hosts:2"]);
	assert.deepEqual(
		result.items.map((item) => item.key),
		["certificates:4", "proxy_hosts:1", "proxy_hosts:2"],
	);
});

it("plans the DNS credential an added certificate needs", () => {
	const data = {
		...hostsWithCertificate({
			id: 4,
			provider: "letsencrypt",
			domain_names: ["c.example.com"],
			npmpro_dns_credential_id: 6,
		}),
		dns_credentials: { npmpro_dns_credential: [{ id: 6, name: "Cloudflare", values: {} }] },
	};
	const result = plan({ data, types: ["proxy_hosts"] });
	const credential = find(result, "dns_credentials:6");
	assert.equal(credential.action, "add");
	assert.deepEqual(credential.needed_by, ["certificates:4"]);
	const page = plan({
		data,
		instance: { npmpro_dns_credential: [{ id: 2, name: "cloudflare", owner_user_id: 5 }] },
		types: ["proxy_hosts"],
		scope: { page: true },
	});
	assert.equal(find(page, "dns_credentials:6").action, "add");
	const own = plan({
		data,
		instance: { npmpro_dns_credential: [{ id: 2, name: "cloudflare", owner_user_id: 1 }] },
		types: ["proxy_hosts"],
		scope: { page: true },
	});
	assert.equal(find(own, "dns_credentials:6").action, "existing");
	assert.equal(find(own, "dns_credentials:6").reason, "same-name");
});

it("plans only the chosen items and their linked items", () => {
	const data = hostsWithCertificate({ id: 4, provider: "letsencrypt", domain_names: ["c.example.com"] });
	data.proxy_hosts.proxy_host[0].certificate_id = 0;
	const result = plan({ data, types: ["proxy_hosts"], items: { proxy_hosts: [2] } });
	assert.deepEqual(
		result.items.map((item) => item.key),
		["certificates:4", "proxy_hosts:2"],
	);
	assert.deepEqual(find(result, "certificates:4").needed_by, ["proxy_hosts:2"]);
});

it("never adds a linked item of a type the page user cannot manage", () => {
	const data = hostsWithCertificate({ id: 4, provider: "letsencrypt", domain_names: ["c.example.com"] });
	const scope = { page: true, canManage: (typeId) => typeId === "proxy_hosts" };
	const result = plan({ data, types: ["proxy_hosts"], scope, choices: { "certificates:4": "add" } });
	assert.notEqual(find(result, "certificates:4").action, "add");
	assert.equal(find(result, "certificates:4").action, "skip");
	assert.equal(result.cleared_links.length, 2);
	const matched = plan({
		data,
		instance: { certificate: [{ id: 8, provider: "letsencrypt", domain_names: ["c.example.com"] }] },
		types: ["proxy_hosts"],
		scope,
		choices: { "certificates:4": "add" },
	});
	assert.equal(find(matched, "certificates:4").action, "existing");
	assert.deepEqual(find(matched, "certificates:4").choices, ["existing"]);
	assert.deepEqual(matched.cleared_links, []);
});

it("offers only skip for a clashing host the page user cannot edit", () => {
	const data = { proxy_hosts: { proxy_host: [{ id: 3, domain_names: ["app.example.com"] }] } };
	const instance = { proxy_host: [{ id: 12, domain_names: ["app.example.com"], owner_user_id: 2 }] };
	const result = plan({
		data,
		instance,
		types: ["proxy_hosts"],
		scope: { page: true, canEdit: () => false },
		choices: { "proxy_hosts:3": "replace" },
	});
	assert.deepEqual(find(result, "proxy_hosts:3").choices, ["skip"]);
	assert.equal(find(result, "proxy_hosts:3").action, "skip");
});

it("matches access lists only among the visible owner's", () => {
	const data = {
		proxy_hosts: { proxy_host: [{ id: 1, domain_names: ["a.example.com"], access_list_id: 5 }] },
		access_lists: { access_list: [{ id: 5, name: "Office" }], access_list_auth: [], access_list_client: [] },
	};
	const instance = { access_list: [{ id: 3, name: "office", owner_user_id: 1 }] };
	const hidden = plan({ data, instance, types: ["proxy_hosts"], scope: { visibleOwnerId: 2 } });
	assert.equal(find(hidden, "access_lists:5").action, "add");
	const visible = plan({ data, instance, types: ["proxy_hosts"], scope: { visibleOwnerId: 1 } });
	assert.equal(find(visible, "access_lists:5").action, "existing");
	assert.equal(find(visible, "access_lists:5").reason, "same-name");
});

it("keeps the admin's user and lets another matching user be replaced", () => {
	const data = {
		users: {
			user: [
				{ id: 1, name: "Admin", email: "Admin@example.com" },
				{ id: 2, name: "Bob", email: "bob@example.com" },
			],
		},
	};
	const instance = {
		user: [
			{ id: 1, email: "admin@example.com" },
			{ id: 5, email: "BOB@example.com" },
		],
	};
	const choices = { "users:1": "replace", "users:2": "replace" };
	const result = plan({ data, instance, types: ["users"], choices });
	assert.deepEqual(find(result, "users:1").choices, ["existing"]);
	assert.equal(find(result, "users:1").action, "existing");
	assert.equal(find(result, "users:1").reason, "same-email");
	assert.deepEqual(find(result, "users:2").choices, ["existing", "replace"]);
	assert.equal(find(result, "users:2").action, "replace");
	assert.equal(find(result, "users:2").target.id, 5);
});

it("lists a setting only when it differs outside its secrets", () => {
	const instance = {
		setting: [{ id: "oidc", name: "OIDC", meta: { issuer: "x", enabled: true, client_secret: "b" } }],
	};
	const same = plan({
		data: {
			settings_oidc: {
				setting: [{ id: "oidc", name: "OIDC", meta: { enabled: true, client_secret: "a", issuer: "x" } }],
			},
		},
		instance,
		types: ["settings_oidc"],
	});
	assert.deepEqual(same.items, []);
	const data = { settings_oidc: { setting: [{ id: "oidc", name: "OIDC", meta: { enabled: false, issuer: "x" } }] } };
	const differs = plan({ data, instance, types: ["settings_oidc"] });
	const item = find(differs, "setting:oidc");
	assert.equal(item.action, "keep");
	assert.equal(item.reason, "differs");
	assert.deepEqual(item.choices, ["keep", "take"]);
	const taken = plan({ data, instance, types: ["settings_oidc"], choices: { "setting:oidc": "take" } });
	assert.equal(find(taken, "setting:oidc").action, "take");
});

it("lists a staged file only when the instance's differs", () => {
	const result = plan({
		instance: { files: { "custom_nginx/http.conf": "bbb", "custom_nginx/stream.conf": "ccc" } },
		stageFiles: { "custom_nginx/http.conf": "aaa", "custom_nginx/stream.conf": "ccc", "crowdsec/ban.html": "ddd" },
		types: ["custom_nginx"],
	});
	assert.deepEqual(
		result.items.map((item) => [item.key, item.action]),
		[["file:custom_nginx/http.conf", "keep"]],
	);
});

it("lists the added certificate under needs_secrets without secrets", () => {
	const data = hostsWithCertificate({ id: 4, provider: "letsencrypt", domain_names: ["c.example.com"] });
	const result = plan({ data, types: ["proxy_hosts"], secrets: false });
	assert.deepEqual(result.needs_secrets, ["certificates:4"]);
	assert.deepEqual(plan({ data, types: ["proxy_hosts"], secrets: true }).needs_secrets, []);
});

it("hashes the plan regardless of item order and changes with a choice", () => {
	const data = hostsWithCertificate({ id: 4, provider: "letsencrypt", domain_names: ["c.example.com"] });
	const first = plan({ data, types: ["proxy_hosts"] });
	assert.equal(planHash({ ...first, items: [...first.items].reverse() }), first.hash);
	assert.equal(planHash(first), first.hash);
	const changed = plan({ data, types: ["proxy_hosts"], choices: { "certificates:4": "unticked" } });
	assert.notEqual(changed.hash, first.hash);
});

it("reads the instance rows with only the columns the planner needs", async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	try {
		await createSchema(knex);
		await knex("proxy_host").insert({ id: 3, domain_names: '["a.example.com"]', owner_user_id: 1 });
		await knex("setting").insert({ id: "oidc", name: "OIDC", meta: '{"enabled":true}' });
		const rows = await readInstanceRows(knex);
		assert.deepEqual(rows.proxy_host, [{ id: 3, owner_user_id: 1, domain_names: ["a.example.com"] }]);
		assert.deepEqual(rows.user, [{ id: 1, email: "admin@example.com", name: "Admin" }]);
		assert.deepEqual(rows.setting, [{ id: "oidc", name: "OIDC", meta: { enabled: true } }]);
		assert.deepEqual(rows.stream, []);
		assert.deepEqual(
			Object.keys(rows).sort((a, b) => a.localeCompare(b)),
			[
				"access_list",
				"certificate",
				"dead_host",
				"npmpro_dns_credential",
				"proxy_host",
				"redirection_host",
				"setting",
				"stream",
				"user",
			],
		);
	} finally {
		await knex.destroy();
	}
});

it("plans no linked item for a host that is skipped", () => {
	const data = hostsWithCertificate({ id: 4, provider: "letsencrypt", domain_names: ["c.example.com"] });
	data.proxy_hosts.proxy_host[1].certificate_id = 0;
	const instance = { proxy_host: [{ id: 9, domain_names: ["one.example.com"] }] };
	const skipped = plan({ data, instance, types: ["proxy_hosts"] });
	assert.equal(find(skipped, "certificates:4"), undefined);
	assert.deepEqual(skipped.cleared_links, []);
	const replaced = plan({ data, instance, types: ["proxy_hosts"], choices: { "proxy_hosts:1": "replace" } });
	assert.equal(find(replaced, "certificates:4").action, "add");
});
