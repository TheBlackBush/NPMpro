import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Agent, fetch as undiciFetch } from "undici";
import { startApi } from "./support/api.js";

const UPSTREAM_LINE = /server 10\.0\.0\.1:8080/u;
const UNKNOWN_DIRECTIVE = /unknown directive/u;

const host = {
	domain_names: ["smoke.example.com"],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 8080,
};
const viewer = {
	visibility: "user",
	access_lists: "view",
	certificates: "view",
	dead_hosts: "hidden",
	proxy_hosts: "view",
	redirection_hosts: "hidden",
	streams: "hidden",
};

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("answers the health check with the real app and marks it as set up after the first user", async () => {
	const health = await api.client().get("");
	assert.equal(health.status, 200);
	assert.equal(health.body.status, "OK");
	assert.equal(health.body.setup, true);
});

it("writes the config of a new host under the test root and reloads nginx", async () => {
	const reloads = api.outside.control.reloads;
	const created = await admin.post("/nginx/proxy-hosts", host);
	assert.equal(created.status, 201);
	const config = await api.read(`data/nginx/proxy_host/${created.body.id}.conf`);
	assert.match(config, UPSTREAM_LINE);
	assert.ok(api.outside.control.reloads > reloads);
	assert.equal((await api.db("proxy_host").where("id", created.body.id).first()).forward_port, 8080);
});

it("marks a host offline with the nginx message when the reload fails", async () => {
	api.outside.control.failNext = "unknown directive";
	const created = await admin.post("/nginx/proxy-hosts", { ...host, domain_names: ["broken.example.com"] });
	assert.equal(created.status, 201);
	const stored = await api.db("proxy_host").where("id", created.body.id).first();
	assert.equal(stored.npmpro_nginx_online, 0);
	assert.match(stored.npmpro_nginx_err, UNKNOWN_DIRECTIVE);
});

it("refuses a limited user what its permissions do not allow", async () => {
	const user = await api.limited(viewer);
	assert.equal((await user.get("/nginx/proxy-hosts")).status, 200);
	const refused = await user.post("/nginx/proxy-hosts", { ...host, domain_names: ["refused.example.com"] });
	assert.equal(refused.status, 403);
	assert.equal((await user.get("/nginx/streams")).status, 403);
});

it("refuses a request without a session and one from another origin", async () => {
	assert.equal((await api.client().get("/nginx/proxy-hosts")).status, 401);
	const foreign = await api.client().get("", { headers: { origin: "https://evil.example" } });
	assert.equal(foreign.status, 403);
});

it("lets nothing leave: outbound HTTP needs a mock and an own dispatcher finds no DNS", async () => {
	await assert.rejects(fetch("https://outside.example/"));
	await assert.rejects(
		undiciFetch("https://outside.example/", { dispatcher: new Agent() }),
		(error) => error.cause?.code === "ENOTFOUND",
	);
	api.outside.http
		.get("https://api.github.com")
		.intercept({ path: "/repos/TheBlackBush/NPMpro/releases/latest" })
		.reply(200, { tag_name: "v9.9.9" });
	assert.equal((await admin.get("/version/check")).body.latest, "v9.9.9");
});
