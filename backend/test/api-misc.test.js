import assert from "node:assert/strict";
import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// /schema, /docs, /version/check, /reports/hosts, /auth* and the 404 of an unknown route (schema/paths/schema, docs,
// version, reports, auth).

const GITHUB = "https://api.github.com";
const LATEST = "/repos/TheBlackBush/NPMpro/releases/latest";
const DAY = 86400000;
const stamp = (offset) => new Date(Date.now() + offset).toISOString().slice(0, 19).replace("T", " ");

let api;
let admin;
let version;

const certificate = (extra) =>
	api.db("certificate").insert({
		owner_user_id: 1,
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		provider: "other",
		nice_name: "cert",
		domain_names: JSON.stringify(["cert.example.com"]),
		meta: "{}",
		...extra,
	});

before(async () => {
	api = await startApi();
	admin = await api.admin();
	version = JSON.parse(await readFile(path.join(import.meta.dirname, "../package.json"), "utf8")).version;
});
after(() => api?.stop());

it("serves the compiled OpenAPI schema with the version of this build and the address it was reached on", async () => {
	const done = await admin.get("/schema");
	assert.equal(done.status, 200, done.text);
	assert.match(done.headers.get("content-type"), /^application\/json/u);
	assert.equal(done.body.openapi.startsWith("3."), true);
	assert.equal(done.body.info.version, version);
	assert.match(done.body.servers[0].url, /^http:\/\/127\.0\.0\.1:\d+\/api$/u);
	for (const route of [
		"/nginx/access-lists",
		"/nginx/proxy-hosts/{hostID}",
		"/settings/runtime/network",
		"/settings/oidc/icon/url",
		"/backups/schedules/{id}/run",
		"/database/move",
		"/audit-log",
		"/version/check",
	]) {
		assert.ok(done.body.paths[route], route);
	}
	assert.ok(done.body.paths["/nginx/access-lists"].post.responses["201"]);
	assert.ok(done.body.components);
});

it("serves the interactive documentation to a signed-in user only", async () => {
	for (const url of ["/docs", "/docs/"]) {
		const done = await admin.get(url);
		assert.equal(done.status, 200, url);
		assert.match(done.headers.get("content-type"), /^text\/html/u);
		assert.match(done.text, /swagger/iu);
	}
	assert.equal((await api.client().get("/docs/")).status, 401);
	assert.equal((await api.client().get("/schema")).status, 401);
});

it("answers the version check without data when GitHub fails, and does not ask again for a while", async () => {
	const github = api.outside.http.get(GITHUB);
	github.intercept({ path: LATEST, method: "GET" }).reply(503, "down");
	const failed = await admin.get("/version/check");
	assert.equal(failed.status, 200, failed.text);
	assert.deepEqual(failed.body, { current: version, latest: "unknown", update_available: false });
	// the retry window: a second call finds the answer GitHub would now give unused
	github.intercept({ path: LATEST, method: "GET" }).reply(200, { tag_name: "v99.0.0" });
	const again = await admin.get("/version/check");
	assert.deepEqual(again.body, failed.body);
	// one interceptor is left; Node 24's built-in fetch uses a second mock pool ("#http1-only") that lists it again
	const pending = api.outside.http.pendingInterceptors().filter((one) => !one.origin.endsWith("#http1-only"));
	assert.equal(pending.length, 1);
	assert.equal(`${pending[0].method} ${pending[0].path}`, `GET ${LATEST}`);
	assert.equal((await api.client().get("/version/check")).status, 401);
});

it("counts the hosts, lists, certificates, errors and expiring certificates the user may see", async () => {
	const empty = await admin.get("/reports/hosts");
	assert.equal(empty.status, 200, empty.text);
	assert.deepEqual(empty.body, {
		proxy: 0,
		redirection: 0,
		stream: 0,
		dead: 0,
		access_list: 0,
		certificate: 0,
		errors: { proxy: 0, redirection: 0, dead: 0, stream: 0 },
		certificates_expiring: 0,
		certificates_expired: 0,
		backup_schedules_failed: [],
	});

	const proxy = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["report-proxy.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.11.1",
		forward_port: 80,
	});
	await admin.post("/nginx/proxy-hosts", {
		domain_names: ["report-proxy2.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.11.2",
		forward_port: 80,
	});
	assert.equal(
		(
			await admin.post("/nginx/redirection-hosts", {
				domain_names: ["report-redirect.example.com"],
				forward_scheme: "https",
				forward_domain_name: "target.example.com",
				forward_http_code: 301,
			})
		).status,
		201,
	);
	assert.equal((await admin.post("/nginx/dead-hosts", { domain_names: ["report-dead.example.com"] })).status, 201);
	assert.equal(
		(
			await admin.post("/nginx/streams", {
				incoming_port: "9101",
				forwarding_host: "10.0.11.3",
				forwarding_port: "9102",
				tcp_forwarding: true,
			})
		).status,
		201,
	);
	assert.equal(
		(await admin.post("/nginx/access-lists", { name: "Report list", items: [{ username: "u", password: "p" }] }))
			.status,
		201,
	);
	await certificate({ expires_on: stamp(-DAY) });
	await certificate({ expires_on: stamp(5 * DAY) });
	await certificate({ expires_on: stamp(400 * DAY) });
	await api.db("proxy_host").where({ id: proxy.body.id }).update({ npmpro_nginx_online: 0 });

	const done = await admin.get("/reports/hosts");
	assert.equal(done.body.proxy, 2);
	assert.equal(done.body.redirection, 1);
	assert.equal(done.body.dead, 1);
	assert.equal(done.body.stream, 1);
	assert.equal(done.body.access_list, 1);
	assert.equal(done.body.certificate, 3);
	assert.deepEqual(done.body.errors, { proxy: 1, redirection: 0, dead: 0, stream: 0 });
	assert.equal(done.body.certificates_expired, 1);
	assert.equal(done.body.certificates_expiring, 1);

	// a disabled host with an error is not counted
	assert.equal((await admin.post(`/nginx/proxy-hosts/${proxy.body.id}/disable`)).status, 200);
	assert.equal((await admin.get("/reports/hosts")).body.errors.proxy, 0);
});

it("names the enabled schedules whose last run failed, to administrators only", async () => {
	const created = await admin.post("/backups/schedules", {
		name: "Failing",
		frequency: "daily",
		time: "03:00",
		types: ["proxy_hosts"],
		protection: "none",
		keep: 3,
	});
	assert.equal(created.status, 200, created.text);
	const folder = path.join(api.root, "data/backups");
	await chmod(folder, 0o500);
	try {
		const ran = await admin.post(`/backups/schedules/${created.body.id}/run`);
		assert.equal(ran.body.last_status, "failed");
	} finally {
		await chmod(folder, 0o700);
	}
	assert.deepEqual((await admin.get("/reports/hosts")).body.backup_schedules_failed, [
		{ id: created.body.id, name: "Failing" },
	]);
	const user = await api.limited({
		visibility: "all",
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	assert.deepEqual((await user.get("/reports/hosts")).body.backup_schedules_failed, []);

	assert.equal((await admin.put(`/backups/schedules/${created.body.id}`, { enabled: false })).status, 200);
	assert.deepEqual((await admin.get("/reports/hosts")).body.backup_schedules_failed, []);
});

it("shows a user only the counts of what the permissions let it see", async () => {
	const hostsOnly = await api.limited({
		visibility: "all",
		proxy_hosts: "hidden",
		redirection_hosts: "hidden",
		dead_hosts: "hidden",
		streams: "hidden",
		access_lists: "hidden",
		certificates: "hidden",
	});
	// every proxy host is enabled and offline, yet a user who may not view proxy hosts sees no error
	await api.db("proxy_host").update({ enabled: 1, npmpro_nginx_online: 0 });
	assert.equal((await admin.get("/reports/hosts")).body.errors.proxy, 2);
	const hidden = await hostsOnly.get("/reports/hosts");
	assert.equal(hidden.status, 200, hidden.text);
	assert.equal(hidden.body.certificates_expired, 0);
	assert.equal(hidden.body.certificates_expiring, 0);
	assert.deepEqual(hidden.body.errors, { proxy: 0, redirection: 0, dead: 0, stream: 0 });

	const own = await api.limited({
		visibility: "user",
		proxy_hosts: "manage",
		access_lists: "view",
		certificates: "view",
	});
	const mine = await own.post("/nginx/proxy-hosts", {
		domain_names: ["own-report.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.11.9",
		forward_port: 80,
	});
	assert.equal(mine.status, 201, mine.text);
	const counts = (await own.get("/reports/hosts")).body;
	assert.equal(counts.proxy, 1);
	assert.equal(counts.access_list, 0);
	assert.equal(counts.certificate, 0);
	assert.equal((await api.client().get("/reports/hosts")).status, 401);
});

it("answers the auth checks of nginx: 200 for a session, 403 on the admin check for a user, 401 without one", async () => {
	assert.equal((await admin.get("/auth")).status, 200);
	assert.equal((await admin.get("/auth/admin")).status, 200);
	const user = await api.limited({ visibility: "all" });
	assert.equal((await user.get("/auth")).status, 200);
	assert.equal((await user.get("/auth/admin")).status, 403);
	const none = api.client();
	assert.equal((await none.get("/auth")).status, 401);
	assert.equal((await none.get("/auth/admin")).status, 401);
});

it("answers an unknown API route with 404 and an error body, for every method", async () => {
	for (const method of ["get", "post", "put", "delete"]) {
		const done = await admin[method]("/nothing/here", method === "get" || method === "delete" ? undefined : {});
		assert.equal(done.status, 404, method);
		assert.equal(done.body.error.code, 404);
		assert.equal(done.body.error.message, "Not Found - /api/nothing/here");
	}
});
