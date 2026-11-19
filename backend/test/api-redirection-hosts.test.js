import assert from "node:assert/strict";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate } from "./support/certbot.js";
import { checkFields, created, hostTests } from "./support/hosts.js";

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
	ctx.api.outside.dns.set("acme-v02.api.letsencrypt.org", "192.0.2.30");
	acmeDirectory(ctx.api, "https://acme-v02.api.letsencrypt.org/directory");
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
	advanced:
		/location \/ \{ return [\s\S]*add_header X-Admin yes;[\s\S]*include \/data\/custom_nginx\/server_redirect\.conf;/u,
	domains: true,
});

it("answers the post without the target with the missing property", async () => {
	const { forward_domain_name, ...noTarget } = body();
	const answer = await ctx.admin.post(URL, noTarget);
	assert.equal(answer.status, 400);
	assert.match(answer.body.error.message, /forward_domain_name/u);
	const { domain_names, ...noDomains } = body();
	assert.match((await ctx.admin.post(URL, noDomains)).body.error.message, /domain_names/u);
});

it("keeps the path of the request when preserve_path is set, and the scheme of the request (or a trusted proxy's) by default", async () => {
	const keep = await created(
		await ctx.admin.post(URL, body({ preserve_path: true, forward_scheme: "$scheme" })),
		"create",
	);
	assert.equal(keep.preserve_path, true);
	assert.match(
		await ctx.api.read(confOf(keep.id)),
		new RegExp(`return 301 \\$npmpro_forwarded_proto://${dotted(keep.forward_domain_name)}\\$request_uri;`, "u"),
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
		/location \/ \{ return 302 \$npmpro_forwarded_proto:\/\/d\.example\.org; \}/u,
	);
});

it("creates a redirection host with a new certificate, and stores the certificate on the host", async () => {
	const pair = await makeCertificate(path.join(ctx.api.root, "fake"), "redir-cert.example.com");
	await certbotSucceeds(ctx.api, pair);
	const before = (await ctx.api.db("certificate").select("id")).map((row) => row.id);
	const host = await created(
		await ctx.admin.post(URL, body({ domain_names: ["redir-cert.example.com"], certificate_id: "new" })),
		"create",
	);
	const added = (await ctx.api.db("certificate").select("id"))
		.map((row) => row.id)
		.filter((id) => !before.includes(id));
	assert.equal(added.length, 1);
	assert.equal(host.certificate_id, added[0]);
});
