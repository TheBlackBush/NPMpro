import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { checkFields, countRows, created, hostTests, listDir } from "./support/hosts.js";

// /nginx/dead-hosts, the 404 hosts (schema/paths/nginx/dead-hosts). The shared tests of every host type are in
// support/hosts.js.

const ctx = {};
let counter = 0;
let renamed = 0;
const body = (overrides = {}) => {
	counter += 1;
	return { domain_names: [`dd${counter}.example.com`], ...overrides };
};
const URL = "/nginx/dead-hosts";
const confOf = (id) => `data/nginx/dead_host/${id}.conf`;
const dotted = (text) => text.replaceAll(".", "\\.");

before(async () => {
	ctx.api = await startApi();
	ctx.admin = await ctx.api.admin();
});
after(() => ctx.api?.stop());

hostTests(ctx, {
	label: "404 host",
	path: URL,
	permission: "dead_hosts",
	dir: "data/nginx/dead_host",
	table: "dead_host",
	make: body,
	check: checkFields,
	search: (host) => host.domain_names[0],
	written: (host) =>
		new RegExp(
			`server_name "${dotted(host.domain_names[0])}";[\\s\\S]*location / \\{\\s*return 404;\\s*\\}[\\s\\S]*error_page 404 /dead\\.html;`,
			"u",
		),
	edit: () => {
		renamed += 1;
		return { domain_names: [`dead-renamed${renamed}.example.net`] };
	},
	edited: (_, edit) => new RegExp(`server_name "${dotted(edit.domain_names[0])}";`, "u"),
	invalid: [
		["a semicolon in a name", { domain_names: ["a;b.example.com"] }],
		["a brace in a name", { domain_names: ["a{b.example.com"] }],
		["a space in a name", { domain_names: ["a b.example.com"] }],
		["the same name twice", { domain_names: ["twice.example.com", "twice.example.com"] }],
		["an unknown property", { bogus: true }],
		["no domain names", { domain_names: [] }],
	],
	adminOnly: { advanced_config: "add_header X-Admin yes;" },
});

it("renders the advanced config of an administrator into the server block", async () => {
	const host = await created(
		await ctx.admin.post(URL, body({ advanced_config: "add_header X-Dead yes;" })),
		"create",
	);
	assert.equal(host.advanced_config, "add_header X-Dead yes;");
	assert.match(
		await ctx.api.read(confOf(host.id)),
		/error_page 404[\s\S]*add_header X-Dead yes;[\s\S]*include \/data\/custom_nginx\/server_dead\.conf;/u,
	);
});

it("refuses a domain name that any host type uses, and lets a host keep its own on edit", async () => {
	const first = await created(await ctx.admin.post(URL, body({ domain_names: ["dead-used.example.com"] })), "create");
	await created(
		await ctx.admin.post("/nginx/proxy-hosts", {
			domain_names: ["dead-proxy.example.com"],
			forward_host: "10.0.0.1",
		}),
		"proxy",
	);
	await created(
		await ctx.admin.post("/nginx/redirection-hosts", {
			domain_names: ["dead-redir.example.com"],
			forward_domain_name: "t.example.org",
		}),
		"redirection",
	);
	const rows = await countRows(ctx.api, "dead_host");
	const files = await listDir(ctx.api, "data/nginx/dead_host");
	for (const name of [
		"dead-used.example.com",
		"Dead-Used.example.com",
		"dead-proxy.example.com",
		"dead-redir.example.com",
	]) {
		const answer = await ctx.admin.post(URL, body({ domain_names: [name] }));
		assert.equal(answer.status, 400, name);
		assert.equal(answer.body.error.message, `${name} is already in use`);
	}
	assert.equal(await countRows(ctx.api, "dead_host"), rows);
	assert.deepEqual(await listDir(ctx.api, "data/nginx/dead_host"), files);
	const same = await ctx.admin.put(`${URL}/${first.id}`, {
		domain_names: ["dead-used.example.com", "dead-more.example.com"],
	});
	assert.equal(same.status, 200, same.text);
	const clash = await ctx.admin.put(`${URL}/${first.id}`, { domain_names: ["dead-redir.example.com"] });
	assert.equal(clash.status, 400);
	assert.equal(clash.body.error.message, "dead-redir.example.com is already in use");
});

it("gives a domain name to one of two requests at once", async () => {
	const race = body({ domain_names: ["dead-race.example.com"] });
	const answers = await Promise.all([ctx.admin.post(URL, race), ctx.admin.post(URL, race)]);
	assert.deepEqual(answers.map(({ status }) => status).sort(), [201, 400]);
	assert.equal((await ctx.api.db("dead_host").where("domain_names", "like", "%dead-race.example.com%")).length, 1);
});
