import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { countRows, created } from "./support/hosts.js";

// Non-admins cannot set a unix: upstream or a regular expression domain name; stored values keep saving.

const ctx = {};
const PERMISSIONS = {
	visibility: "all",
	proxy_hosts: "manage",
	redirection_hosts: "manage",
	dead_hosts: "manage",
	streams: "manage",
	access_lists: "view",
	certificates: "view",
};
const UNIX = "error.unix-upstream-admin-only";
const REGEX = "error.regex-domain-admin-only";
const REGEX_NAME = "~^re\\d\\.example\\.com$";

const proxy = (name, extra = {}) => ({
	domain_names: [`${name}.example.com`],
	forward_scheme: "http",
	forward_host: "10.0.6.1",
	forward_port: 8080,
	...extra,
});

const refused = async (user, table, url, body, key) => {
	const before = await countRows(ctx.api, table);
	const answer = await user.post(url, body);
	assert.equal(answer.status, 400, answer.text);
	assert.equal(answer.body.error.message_i18n, key);
	assert.equal(await countRows(ctx.api, table), before);
};

before(async () => {
	ctx.api = await startApi();
	ctx.admin = await ctx.api.admin();
	ctx.user = await ctx.api.limited(PERMISSIONS);
});
after(() => ctx.api?.stop());

it("refuses a unix: upstream from a non-admin on every host type, and adds no row", async () => {
	const { user } = ctx;
	await refused(
		user,
		"proxy_host",
		"/nginx/proxy-hosts",
		proxy("u1", { forward_host: "unix:/run/npmpro.sock" }),
		UNIX,
	);
	await refused(
		user,
		"proxy_host",
		"/nginx/proxy-hosts",
		proxy("u2", { locations: [{ path: "/p", forward_host: "UNIX:/run/x.sock" }] }),
		UNIX,
	);
	await refused(
		user,
		"stream",
		"/nginx/streams",
		{ incoming_port: "9710", forwarding_host: "unix:/run/x.sock", tcp_forwarding: true },
		UNIX,
	);
	await refused(
		user,
		"redirection_host",
		"/nginx/redirection-hosts",
		{
			domain_names: ["u4.example.com"],
			forward_scheme: "http",
			forward_domain_name: "unix:/x",
			forward_http_code: 301,
		},
		UNIX,
	);
});

it("refuses a regular expression domain from a non-admin on proxy, redirection and dead hosts", async () => {
	const { user } = ctx;
	await refused(user, "proxy_host", "/nginx/proxy-hosts", proxy("r1", { domain_names: [REGEX_NAME] }), REGEX);
	await refused(
		user,
		"redirection_host",
		"/nginx/redirection-hosts",
		{
			domain_names: [REGEX_NAME],
			forward_scheme: "http",
			forward_domain_name: "t.example.org",
			forward_http_code: 301,
		},
		REGEX,
	);
	await refused(user, "dead_host", "/nginx/dead-hosts", { domain_names: [REGEX_NAME] }, REGEX);
});

it("lets an administrator save both", async () => {
	const host = await ctx.admin.post("/nginx/proxy-hosts", proxy("a1", { forward_host: "unix:/run/npmpro.sock" }));
	assert.equal(host.status, 201, host.text);
	const dead = await ctx.admin.post("/nginx/dead-hosts", { domain_names: [REGEX_NAME] });
	assert.equal(dead.status, 201, dead.text);
});

it("lets a non-admin change other fields of such hosts, but not add another regex name", async () => {
	const host = await created(
		await ctx.admin.post("/nginx/proxy-hosts", proxy("k1", { forward_host: "unix:/run/npmpro.sock" })),
		"proxy",
	);
	const kept = await ctx.user.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: 8081 });
	assert.equal(kept.status, 200, kept.text);
	const dead = await created(
		await ctx.admin.post("/nginx/dead-hosts", { domain_names: ["~^kept\\d\\.example\\.com$"] }),
		"dead",
	);
	const same = await ctx.user.put(`/nginx/dead-hosts/${dead.id}`, { domain_names: dead.domain_names });
	assert.equal(same.status, 200, same.text);
	const more = await ctx.user.put(`/nginx/dead-hosts/${dead.id}`, {
		domain_names: [REGEX_NAME, "~^other\\.example\\.com$"],
	});
	assert.equal(more.status, 400, more.text);
	assert.equal(more.body.error.message_i18n, REGEX);
});
