import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import {
	addCertificate,
	checkFields,
	countRows,
	created,
	fileExists,
	hostTests,
	listDir,
	reloads,
} from "./support/hosts.js";

// /nginx/proxy-hosts (schema/paths/nginx/proxy-hosts). The shared tests of every host type are in support/hosts.js.

const ctx = {};
let counter = 0;
const body = (overrides = {}) => {
	counter += 1;
	return {
		domain_names: [`px${counter}.example.com`],
		forward_scheme: "http",
		forward_host: `10.0.1.${counter}`,
		forward_port: 8000 + counter,
		...overrides,
	};
};
const confOf = (id) => `data/nginx/proxy_host/${id}.conf`;
const URL = "/nginx/proxy-hosts";
const taken = (answer, name) => {
	assert.equal(answer.status, 400, answer.text);
	assert.equal(answer.body.error.message, `${name} is already in use`);
};

before(async () => {
	ctx.api = await startApi();
	ctx.admin = await ctx.api.admin();
});
after(() => ctx.api?.stop());

hostTests(ctx, {
	label: "proxy host",
	path: URL,
	permission: "proxy_hosts",
	dir: "data/nginx/proxy_host",
	table: "proxy_host",
	make: body,
	check: checkFields,
	search: (host) => host.domain_names[0],
	written: (host) =>
		new RegExp(
			`server ${host.forward_host.replaceAll(".", "\\.")}:${host.forward_port} resolve;[\\s\\S]*server_name "${host.domain_names[0].replaceAll(".", "\\.")}";[\\s\\S]*proxy_pass http://upstream_\\d+;`,
			"u",
		),
	edit: () => ({ forward_port: 9191, forward_scheme: "https" }),
	edited: (host) =>
		new RegExp(
			`server ${host.forward_host.replaceAll(".", "\\.")}:9191 resolve;[\\s\\S]*proxy_pass https://upstream_\\d+;`,
			"u",
		),
	invalid: [
		["port above 65535", { forward_port: 70000 }],
		["a negative port", { forward_port: -1 }],
		["a unknown scheme", { forward_scheme: "ftp" }],
		["a semicolon in the host", { forward_host: "10.0.0.1;" }],
		["an unknown property", { bogus: true }],
		["no domain names", { domain_names: [] }],
	],
	adminOnly: { advanced_config: "add_header X-Admin yes;" },
});

it("answers the post without domain names or forward host with the missing property", async () => {
	const { forward_host, ...noHost } = body();
	const answer = await ctx.admin.post(URL, noHost);
	assert.equal(answer.status, 400);
	assert.match(answer.body.error.message, /forward_host/u);
	const { domain_names, ...noDomains } = body();
	assert.match((await ctx.admin.post(URL, noDomains)).body.error.message, /domain_names/u);
});

it("does not let a value break out of its nginx directive", async () => {
	const rows = await countRows(ctx.api, "proxy_host");
	const files = await listDir(ctx.api, "data/nginx/proxy_host");
	for (const forward_host of ["10.0.0.1;\n  return 200", "a b", "x{y}", 'a"b', "a\\b", "a#b"]) {
		const answer = await ctx.admin.post(URL, body({ forward_host }));
		assert.equal(answer.status, 400, JSON.stringify(forward_host));
		assert.match(answer.body.error.message, /forward_host must match pattern/u);
	}
	for (const domain of ["a;b.example.com", "a{b}.example.com", "a b.example.com", 'a"b.example.com']) {
		const answer = await ctx.admin.post(URL, body({ domain_names: [domain] }));
		assert.equal(answer.status, 400, domain);
	}
	assert.equal(await countRows(ctx.api, "proxy_host"), rows);
	assert.deepEqual(await listDir(ctx.api, "data/nginx/proxy_host"), files);
});

it("gives a domain name to one of two requests at once", async () => {
	const race = body({ domain_names: ["race.example.com"] });
	const answers = await Promise.all([ctx.admin.post(URL, race), ctx.admin.post(URL, race)]);
	const rows = await ctx.api.db("proxy_host").where("domain_names", "like", "%race.example.com%");
	assert.deepEqual(answers.map(({ status }) => status).sort(), [201, 400]);
	assert.equal(rows.length, 1);
});

it("refuses a domain name that another host uses, whatever the case or the spelling", async () => {
	const first = await created(await ctx.admin.post(URL, body({ domain_names: ["Used.Example.com"] })), "create");
	const rows = await countRows(ctx.api, "proxy_host");
	taken(await ctx.admin.post(URL, body({ domain_names: ["used.example.COM"] })), "used.example.COM");
	taken(
		await ctx.admin.post(URL, body({ domain_names: ["other.example.com", "used.example.com"] })),
		"used.example.com",
	);
	assert.equal(await countRows(ctx.api, "proxy_host"), rows);
	assert.deepEqual(
		(await ctx.api.db("proxy_host").where({ id: first.id }).first()).domain_names,
		'["Used.Example.com"]',
	);
});

it("treats an international name and its punycode form as one name", async () => {
	const unicode = await created(await ctx.admin.post(URL, body({ domain_names: ["bücher.example.com"] })), "create");
	assert.deepEqual(unicode.domain_names, ["bücher.example.com"]);
	assert.match(await ctx.api.read(confOf(unicode.id)), /server_name "[^"]*";/u);
	taken(
		await ctx.admin.post(URL, body({ domain_names: ["xn--bcher-kva.example.com"] })),
		"xn--bcher-kva.example.com",
	);
	taken(await ctx.admin.post(URL, body({ domain_names: ["BÜCHER.example.com"] })), "BÜCHER.example.com");
});

it("accepts a name of 253 characters and refuses one of 254", async () => {
	const label = (letter, length) => letter.repeat(length);
	const name = `${label("a", 63)}.${label("b", 63)}.${label("c", 63)}.${label("d", 57)}.org`;
	assert.equal(name.length, 253);
	const ok = await ctx.admin.post(URL, body({ domain_names: [name] }));
	assert.equal(ok.status, 201, ok.text);
	assert.match(await ctx.api.read(confOf(ok.body.id)), new RegExp(`server_name "${name}";`, "u"));
	const answer = await ctx.admin.post(URL, body({ domain_names: [`${name}x`] }));
	assert.equal(answer.status, 400);
	assert.match(answer.body.error.message, /domain_names\/0 must NOT have more than 253 characters/u);
});

it("keeps at most 100 domain names, each different", async () => {
	const many = (count) => Array.from({ length: count }, (_, index) => `many${index}.example.com`);
	assert.equal((await ctx.admin.post(URL, body({ domain_names: many(101) }))).status, 400);
	const answer = await ctx.admin.post(URL, body({ domain_names: ["twice.example.com", "twice.example.com"] }));
	assert.equal(answer.status, 400);
	assert.match(answer.body.error.message, /duplicate items/u);
});

it("lets a host keep its own names on edit and refuses the names of another host", async () => {
	const one = await created(await ctx.admin.post(URL, body({ domain_names: ["keep-a.example.com"] })), "create");
	const two = await created(await ctx.admin.post(URL, body({ domain_names: ["keep-b.example.com"] })), "create");
	const keep = await ctx.admin.put(`${URL}/${one.id}`, {
		domain_names: ["keep-a.example.com", "keep-c.example.com"],
	});
	assert.equal(keep.status, 200, keep.text);
	assert.deepEqual(keep.body.domain_names, ["keep-a.example.com", "keep-c.example.com"]);
	assert.match(await ctx.api.read(confOf(one.id)), /server_name "keep-a\.example\.com" "keep-c\.example\.com";/u);
	taken(await ctx.admin.put(`${URL}/${one.id}`, { domain_names: ["keep-b.example.com"] }), "keep-b.example.com");
	assert.deepEqual((await ctx.admin.get(`${URL}/${one.id}`)).body.domain_names, [
		"keep-a.example.com",
		"keep-c.example.com",
	]);
	assert.deepEqual((await ctx.admin.get(`${URL}/${two.id}`)).body.domain_names, ["keep-b.example.com"]);
});

it("does not enable a disabled host whose domain a new host took meanwhile", async () => {
	const first = await created(await ctx.admin.post(URL, body({ domain_names: ["swap.example.com"] })), "create");
	assert.equal((await ctx.admin.post(`${URL}/${first.id}/disable`)).status, 200);
	const second = await created(await ctx.admin.post(URL, body({ domain_names: ["swap.example.com"] })), "create");
	const refused = await ctx.admin.post(`${URL}/${first.id}/enable`);
	assert.equal(refused.status, 400, refused.text);
	assert.equal(refused.body.error.message, "swap.example.com is already in use by an active host");
	assert.equal((await ctx.api.db("proxy_host").where({ id: first.id }).first()).enabled, 0);
	assert.equal(await fileExists(ctx.api, confOf(first.id)), false);
	assert.equal(await fileExists(ctx.api, confOf(second.id)), true);
});

it("refuses a name that a redirection host or a 404 host uses", async () => {
	await created(
		await ctx.admin.post("/nginx/redirection-hosts", {
			domain_names: ["shared-r.example.com"],
			forward_domain_name: "t.example.org",
		}),
		"redirection",
	);
	await created(await ctx.admin.post("/nginx/dead-hosts", { domain_names: ["shared-d.example.com"] }), "dead");
	taken(await ctx.admin.post(URL, body({ domain_names: ["shared-r.example.com"] })), "shared-r.example.com");
	taken(await ctx.admin.post(URL, body({ domain_names: ["shared-d.example.com"] })), "shared-d.example.com");
});

it("stores custom locations and writes an upstream and a location block for each", async () => {
	const answer = await ctx.admin.post(
		URL,
		body({
			locations: [
				{ path: "/api", forward_scheme: "http", forward_host: "10.9.0.1", forward_port: 81 },
				{
					path: "/static/",
					location_type: "^~ ",
					forward_scheme: "https",
					forward_host: "10.9.0.2",
					forward_port: 443,
				},
			],
		}),
	);
	assert.equal(answer.status, 201, answer.text);
	assert.deepEqual(
		answer.body.locations.map(({ path }) => path),
		["/api", "/static/"],
	);
	const rows = await ctx.api.db("npmpro_location").where({ proxy_host_id: answer.body.id }).orderBy("id");
	assert.equal(rows.length, 2);
	assert.equal(rows[1].forward_host, "10.9.0.2");
	const config = await ctx.api.read(confOf(answer.body.id));
	assert.match(config, /upstream upstream_\d+_location_0 \{[^}]*server 10\.9\.0\.1:81 resolve;/u);
	assert.match(config, /upstream upstream_\d+_location_1 \{[^}]*server 10\.9\.0\.2:443 resolve;/u);
	assert.match(config, /location "\/api" \{/u);
	assert.match(config, /location \^~ "\/static\/" \{/u);
	assert.match(config, /proxy_pass https:\/\/upstream_\d+_location_1;/u);
	// an edit replaces the list, a host without locations loses them and their blocks
	const edit = await ctx.admin.put(`${URL}/${answer.body.id}`, { locations: [] });
	assert.equal(edit.status, 200, edit.text);
	assert.equal((await ctx.api.db("npmpro_location").where({ proxy_host_id: answer.body.id })).length, 0);
	assert.doesNotMatch(await ctx.api.read(confOf(answer.body.id)), /location "\/api"/u);
	// a delete takes the locations with it
	const again = await created(
		await ctx.admin.post(URL, body({ locations: [{ path: "/x", forward_host: "10.9.0.3" }] })),
		"create",
	);
	assert.equal((await ctx.admin.delete(`${URL}/${again.id}`)).status, 200);
	assert.equal((await ctx.api.db("npmpro_location").where({ proxy_host_id: again.id })).length, 0);
});

it("refuses two locations with the same path, and a location without a host", async () => {
	const rows = await countRows(ctx.api, "proxy_host");
	const same = await ctx.admin.post(
		URL,
		body({
			locations: [
				{ path: "/a", forward_host: "10.9.0.4" },
				{ path: "/a", forward_host: "10.9.0.5" },
			],
		}),
	);
	assert.equal(same.status, 400);
	assert.match(same.body.error.message, /same path: \/a/u);
	const none = await ctx.admin.post(URL, body({ locations: [{ path: "/b" }] }));
	assert.equal(none.status, 400);
	assert.equal(await countRows(ctx.api, "proxy_host"), rows);
});

it("refuses a certificate that does not exist, has no files or is the wrong kind", async () => {
	const rows = await countRows(ctx.api, "proxy_host");
	const missing = await ctx.admin.post(URL, body({ certificate_id: 9999 }));
	assert.equal(missing.status, 404);
	const noFiles = await ctx.api.db("certificate").insert({
		owner_user_id: 1,
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		provider: "other",
		nice_name: "empty",
		domain_names: "[]",
		expires_on: "2099-01-01 00:00:00",
		meta: "{}",
	});
	const empty = await ctx.admin.post(URL, body({ certificate_id: noFiles[0] }));
	assert.equal(empty.status, 400);
	assert.equal(empty.body.error.message_i18n, "error.certificate.no-files");
	const mtls = await addCertificate(ctx.api, { provider: "mtls" });
	const wrong = await ctx.admin.post(URL, body({ certificate_id: mtls }));
	assert.equal(wrong.status, 400);
	assert.equal(wrong.body.error.message_i18n, "error.certificate.is-mtls");
	assert.equal(await countRows(ctx.api, "proxy_host"), rows);
});

it("writes the certificate into the config, and removes the SSL block when the certificate is taken off", async () => {
	const certificate = await addCertificate(ctx.api);
	const host = await created(
		await ctx.admin.post(URL, body({ certificate_id: certificate, ssl_forced: true })),
		"create",
	);
	assert.equal(host.certificate_id, certificate);
	assert.equal(host.ssl_forced, true);
	assert.match(
		await ctx.api.read(confOf(host.id)),
		new RegExp(`ssl_certificate /data/tls/custom/npm-${certificate}/fullchain\\.pem;`, "u"),
	);
	const off = await ctx.admin.put(`${URL}/${host.id}`, { certificate_id: 0 });
	assert.equal(off.status, 200, off.text);
	assert.equal(off.body.ssl_forced, false);
	assert.doesNotMatch(await ctx.api.read(confOf(host.id)), /ssl_certificate /u);
});

it("lists the reloads of its own writes in the audit log with the host as the meta", async () => {
	const host = await created(await ctx.admin.post(URL, body()), "create");
	const entry = await ctx.api.db("audit_log").where({ object_id: host.id, action: "created" }).first();
	assert.equal(entry.object_type, "proxy-host");
	assert.deepEqual(JSON.parse(entry.meta).domain_names, host.domain_names);
	assert.ok(reloads(ctx.api) > 0);
});
