import { after, before } from "node:test";
import { startApi } from "./support/api.js";
import { checkFields, hostTests } from "./support/hosts.js";

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
			`server_name "${dotted(host.domain_names[0])}";[\\s\\S]*error_page 404 /\\.npmpro-page/not-found;\\s*location / \\{\\s*return 404;\\s*\\}`,
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
	advanced: /error_page 404[\s\S]*add_header X-Admin yes;[\s\S]*include \/data\/custom_nginx\/server_dead\.conf;/u,
	domains: true,
});
