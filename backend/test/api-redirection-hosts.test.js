import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { checkFields, countRows, created, hostTests, listDir } from "./support/hosts.js";

// /nginx/redirection-hosts (schema/paths/nginx/redirection-hosts). The shared tests of every host type are in
// support/hosts.js.

const ctx = {};
let counter = 0;
const body = (overrides = {}) => {
	counter += 1;
	return {
		domain_names: [`rd${counter}.example.com`],
		forward_domain_name: `target${counter}.example.org`,
		forward_scheme: "https",
		forward_http_code: 301,
		...overrides,
	};
};
const URL = "/nginx/redirection-hosts";
const confOf = (id) => `data/nginx/redirection_host/${id}.conf`;
const dotted = (text) => text.replaceAll(".", "\\.");

before(async () => {
	ctx.api = await startApi();
	ctx.admin = await ctx.api.admin();
});
after(() => ctx.api?.stop());

hostTests(ctx, {
	label: "redirection host",
	path: URL,
	permission: "redirection_hosts",
	dir: "data/nginx/redirection_host",
	table: "redirection_host",
	make: body,
	check: checkFields,
	search: (host) => host.domain_names[0],
	written: (host) =>
		new RegExp(
			`server_name "${dotted(host.domain_names[0])}";[\\s\\S]*location / \\{ return ${host.forward_http_code} https://${dotted(host.forward_domain_name)}; \\}`,
			"u",
		),
	edit: () => ({ forward_http_code: 307, forward_scheme: "http" }),
	edited: (host) => new RegExp(`location / \\{ return 307 http://${dotted(host.forward_domain_name)}; \\}`, "u"),
	invalid: [
		["a status code that is no redirect", { forward_http_code: 200 }],
		["a unknown scheme", { forward_scheme: "ftp" }],
		["a semicolon in the target", { forward_domain_name: "a;b" }],
		["a brace in the target", { forward_domain_name: "a{b" }],
		["an unknown property", { bogus: true }],
		["no domain names", { domain_names: [] }],
	],
	adminOnly: { advanced_config: "add_header X-Admin yes;" },
});

it("answers the post without the target with the missing property", async () => {
	const { forward_domain_name, ...noTarget } = body();
	const answer = await ctx.admin.post(URL, noTarget);
	assert.equal(answer.status, 400);
	assert.match(answer.body.error.message, /forward_domain_name/u);
	const { domain_names, ...noDomains } = body();
	assert.match((await ctx.admin.post(URL, noDomains)).body.error.message, /domain_names/u);
});

it("keeps the path of the request when preserve_path is set, and the scheme of the request by default", async () => {
	const keep = await created(
		await ctx.admin.post(URL, body({ preserve_path: true, forward_scheme: "$scheme" })),
		"create",
	);
	assert.equal(keep.preserve_path, true);
	assert.match(
		await ctx.api.read(confOf(keep.id)),
		new RegExp(`return 301 \\$scheme://${dotted(keep.forward_domain_name)}\\$request_uri;`, "u"),
	);
	const defaults = await created(
		await ctx.admin.post(URL, { domain_names: ["defaults.example.com"], forward_domain_name: "d.example.org" }),
		"create",
	);
	assert.equal(defaults.forward_http_code, 302);
	assert.equal(defaults.forward_scheme, "$scheme");
	assert.equal(defaults.preserve_path, false);
	assert.match(
		await ctx.api.read(confOf(defaults.id)),
		/location \/ \{ return 302 \$scheme:\/\/d\.example\.org; \}/u,
	);
});

it("refuses a domain name that any host type uses, and lets a host keep its own on edit", async () => {
	const first = await created(
		await ctx.admin.post(URL, body({ domain_names: ["redir-used.example.com"] })),
		"create",
	);
	await created(
		await ctx.admin.post("/nginx/proxy-hosts", {
			domain_names: ["redir-proxy.example.com"],
			forward_host: "10.0.0.1",
		}),
		"proxy",
	);
	await created(await ctx.admin.post("/nginx/dead-hosts", { domain_names: ["redir-dead.example.com"] }), "dead");
	const rows = await countRows(ctx.api, "redirection_host");
	const files = await listDir(ctx.api, "data/nginx/redirection_host");
	for (const name of [
		"redir-used.example.com",
		"REDIR-USED.example.com",
		"redir-proxy.example.com",
		"redir-dead.example.com",
	]) {
		const answer = await ctx.admin.post(URL, body({ domain_names: [name] }));
		assert.equal(answer.status, 400, name);
		assert.equal(answer.body.error.message, `${name} is already in use`);
	}
	assert.equal(await countRows(ctx.api, "redirection_host"), rows);
	assert.deepEqual(await listDir(ctx.api, "data/nginx/redirection_host"), files);
	const same = await ctx.admin.put(`${URL}/${first.id}`, {
		domain_names: ["redir-used.example.com", "redir-more.example.com"],
	});
	assert.equal(same.status, 200, same.text);
	assert.match(
		await ctx.api.read(confOf(first.id)),
		/server_name "redir-used\.example\.com" "redir-more\.example\.com";/u,
	);
	const clash = await ctx.admin.put(`${URL}/${first.id}`, { domain_names: ["redir-proxy.example.com"] });
	assert.equal(clash.status, 400);
	assert.equal(clash.body.error.message, "redir-proxy.example.com is already in use");
});

it("gives a domain name to one of two requests at once", async () => {
	const race = body({ domain_names: ["redir-race.example.com"] });
	const answers = await Promise.all([ctx.admin.post(URL, race), ctx.admin.post(URL, race)]);
	assert.deepEqual(answers.map(({ status }) => status).sort(), [201, 400]);
	assert.equal(
		(await ctx.api.db("redirection_host").where("domain_names", "like", "%redir-race.example.com%")).length,
		1,
	);
});
