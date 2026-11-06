import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { fileExists, reloads } from "./support/hosts.js";

// /settings, /settings/{id} and /settings/environment (schema/paths/settings). The default site is the only setting
// the generic route may change: it writes data/public/html/index.html and the default config.

const DEFAULT_CONF = "usr/local/nginx/conf/conf.d/default.conf";
const INDEX_HTML = "data/public/html/index.html";
const SITE = "/settings/default-site";

let api;
let admin;

const stored = async () => {
	const row = await api.db("setting").where({ id: "default-site" }).first();
	return { value: row.value, meta: typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta };
};
const location = (config) => config.match(/server_name _;[\s\S]*$/u)[0];
const save = (body) => admin.put(SITE, body);

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("lists the default site and no setting that has its own endpoint or is internal", async () => {
	for (const id of ["oidc", "monitoring", "geoip", "traffic-state", "network", "certificates", "advanced"]) {
		await api
			.db("setting")
			.insert({ id, name: id, description: `zz ${id}`, value: "x", meta: "{}" })
			.onConflict("id")
			.ignore();
	}
	const all = await admin.get("/settings");
	assert.equal(all.status, 200, all.text);
	const ids = all.body.map((row) => row.id);
	assert.ok(ids.includes("default-site"));
	for (const hidden of ["traffic-state", "certificates", "network", "nginx", "forward-auth", "logs", "advanced"]) {
		assert.equal(ids.includes(hidden), false, hidden);
	}
	const row = all.body.find((entry) => entry.id === "default-site");
	assert.equal(row.name, "Default Site");
	assert.equal(row.value, "congratulations");
	assert.deepEqual(row.meta, {});
	const descriptions = all.body.map((entry) => entry.description);
	assert.deepEqual(descriptions, [...descriptions].sort());
});

it("reads one setting, and answers 404 for an unknown or hidden id", async () => {
	const one = await admin.get(SITE);
	assert.equal(one.status, 200);
	assert.equal(one.body.id, "default-site");
	for (const id of [
		"nope",
		"traffic-state",
		"certificates",
		"network",
		"nginx",
		"forward-auth",
		"logs",
		"advanced",
	]) {
		assert.equal((await admin.get(`/settings/${id}`)).status, 404, id);
	}
});

it("refuses to change a setting that has its own endpoint, and an unknown one", async () => {
	for (const id of ["OIDC", "Monitoring", "GEOIP", "traffic-state", "network", "nginx", "advanced"]) {
		const done = await admin.put(`/settings/${id}`, { value: "404" });
		assert.equal(done.status, 400, `${id}: ${done.text}`);
		assert.match(done.body.error.message, /own endpoint/u);
	}
	assert.equal((await admin.put("/settings/nope", { value: "404" })).status, 404);
	assert.equal((await stored()).value, "congratulations");
});

it("refuses invalid default site bodies with 400 and keeps the saved site", async () => {
	const config = await api.read(DEFAULT_CONF);
	const calls = reloads(api);
	const bodies = {
		"empty body": {},
		"unknown value": { value: "teapot" },
		"unknown field": { value: "404", extra: 1 },
		"unknown meta field": { value: "404", meta: { extra: 1 } },
		"redirect with a space": { value: "redirect", meta: { redirect: "https://a b" } },
		"status below 400": { value: "html", meta: { html: "<p>x</p>", status: 301 } },
		"status above 599": { value: "html", meta: { html: "<p>x</p>", status: 600 } },
		"redirect without a target": { value: "redirect" },
		"redirect with a blank target": { value: "redirect", meta: { redirect: "" } },
		"redirect that is not http": { value: "redirect", meta: { redirect: "ftp://example.com/" } },
		"redirect with nginx syntax": { value: "redirect", meta: { redirect: "https://example.com/;}" } },
		"redirect with a quote": { value: "redirect", meta: { redirect: 'https://example.com/"x' } },
		"html mode without html": { value: "html" },
		"html mode with a blank page": { value: "html", meta: { html: "  " } },
	};
	for (const [label, body] of Object.entries(bodies)) {
		const done = await save(body);
		assert.equal(done.status, 400, `${label}: ${done.text}`);
	}
	assert.equal(await api.read(DEFAULT_CONF), config);
	assert.equal(reloads(api), calls);
	assert.equal((await stored()).value, "congratulations");
});

it("writes the default config and reloads nginx for each fixed answer, and audits the change", async () => {
	assert.match(location(await api.read(DEFAULT_CONF)), /try_files \/default\.html =404;/u);
	const calls = reloads(api);
	const notFound = await save({ value: "404" });
	assert.equal(notFound.status, 200, notFound.text);
	assert.equal(notFound.body.value, "404");
	const site404 = location(await api.read(DEFAULT_CONF));
	assert.match(site404, /location \/ \{\s+return 404;/u);
	assert.match(site404, /error_page 404 \/dead\.html;/u);
	assert.doesNotMatch(site404, /default\.html/u);
	assert.equal(reloads(api), calls + 1);
	assert.equal((await stored()).value, "404");

	const closed = await save({ value: "444" });
	assert.equal(closed.status, 200, closed.text);
	const site444 = location(await api.read(DEFAULT_CONF));
	assert.match(site444, /ssl_reject_handshake on;\s+location \/ \{ return 444; \}/u);
	assert.doesNotMatch(site444, /default-cert\.conf/u);

	const back = await save({ value: "congratulations" });
	assert.equal(back.status, 200);
	assert.match(location(await api.read(DEFAULT_CONF)), /try_files \/default\.html =404;/u);
	assert.equal(reloads(api), calls + 3);

	const audit = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id");
	assert.deepEqual(
		audit.map((entry) => entry.action),
		["updated", "updated", "updated"],
	);
	assert.equal(JSON.parse(audit[0].meta).value, "404");
});

it("redirects to the URL in the redirect mode, and writes the page and status in the html mode", async () => {
	const redirect = await save({
		value: "redirect",
		meta: { redirect: "https://example.org/start?a=1&b=$request_uri" },
	});
	assert.equal(redirect.status, 200, redirect.text);
	assert.equal(redirect.body.meta.redirect, "https://example.org/start?a=1&b=$request_uri");
	assert.match(
		location(await api.read(DEFAULT_CONF)),
		/location \/ \{ return 302 https:\/\/example\.org\/start\?a=1&b=\$request_uri; \}/u,
	);
	assert.deepEqual((await stored()).meta, { redirect: "https://example.org/start?a=1&b=$request_uri" });

	const html = await save({ value: "html", meta: { html: "<h1>Hello there</h1>" } });
	assert.equal(html.status, 200, html.text);
	assert.equal(await api.read(INDEX_HTML), "<h1>Hello there</h1>");
	const plain = location(await api.read(DEFAULT_CONF));
	assert.match(plain, /root \/data\/public\/html;\s+try_files \$uri \$uri\/ \/index\.html;/u);
	assert.doesNotMatch(plain, /return 302/u);

	const withStatus = await save({ value: "html", meta: { html: "<h1>Gone</h1>", status: 410 } });
	assert.equal(withStatus.status, 200, withStatus.text);
	assert.equal(await api.read(INDEX_HTML), "<h1>Gone</h1>");
	const gone = location(await api.read(DEFAULT_CONF));
	assert.match(gone, /return 410;/u);
	assert.match(gone, /error_page 410 \/index\.html;/u);
	assert.deepEqual((await stored()).meta, { html: "<h1>Gone</h1>", status: 410 });
});

// nginx -t of the fake fails only for a config that holds the marker, so the saved config can be put back
const refuseMarker = (marker) =>
	api.outside.hookCommand(
		"nginx",
		`#!/bin/sh\nif grep -q '${marker}' "${api.root}/${DEFAULT_CONF}" 2>/dev/null; then echo "nginx: [emerg] refused" >&2; exit 1; fi\n`,
	);

it("keeps the saved value, page and config when nginx refuses the change", async () => {
	assert.equal((await save({ value: "html", meta: { html: "<p>kept</p>" } })).status, 200);
	const config = await api.read(DEFAULT_CONF);
	const before_ = await stored();
	const calls = reloads(api);
	await refuseMarker("return 503;");
	try {
		const refused = await save({ value: "html", meta: { html: "<p>refused</p>", status: 503 } });
		assert.equal(refused.status, 400, refused.text);
		assert.match(refused.body.error.message, /Could not reconfigure Nginx/u);
	} finally {
		await api.outside.hookCommand("nginx", "#!/bin/sh\nexit 0\n");
	}
	assert.deepEqual(await stored(), before_);
	assert.equal(await api.read(INDEX_HTML), "<p>kept</p>");
	assert.equal(await api.read(DEFAULT_CONF), config);
	// the restore reloads nginx once, the refused change never did
	assert.equal(reloads(api), calls + 1);
});

it("removes the default config when nginx refuses the saved one too, and keeps the saved row", async () => {
	assert.equal((await save({ value: "404" })).status, 200);
	const before_ = await stored();
	await api.outside.hookCommand("nginx", "#!/bin/sh\necho 'nginx: [emerg] broken' >&2\nexit 1\n");
	try {
		const refused = await save({ value: "redirect", meta: { redirect: "https://example.net/" } });
		assert.equal(refused.status, 400, refused.text);
	} finally {
		await api.outside.hookCommand("nginx", "#!/bin/sh\nexit 0\n");
	}
	assert.deepEqual(await stored(), before_);
	assert.equal(await fileExists(api, DEFAULT_CONF), false);
	const again = await save({ value: "congratulations" });
	assert.equal(again.status, 200, again.text);
	assert.equal(await fileExists(api, DEFAULT_CONF), true);
});

it("keeps the saved value when the reload fails, and puts the page back", async () => {
	assert.equal((await save({ value: "html", meta: { html: "<p>stays</p>" } })).status, 200);
	const before_ = await stored();
	api.outside.control.failNext = "reload failed";
	const refused = await save({ value: "html", meta: { html: "<p>new</p>" } });
	assert.equal(refused.status, 400, refused.text);
	assert.deepEqual(await stored(), before_);
	assert.equal(await api.read(INDEX_HTML), "<p>stays</p>");
	assert.equal((await save({ value: "congratulations" })).status, 200);
});

it("shows the startup environment to an administrator, with secrets only as set or not set", async () => {
	const done = await admin.get("/settings/environment");
	assert.equal(done.status, 200, done.text);
	assert.ok(Array.isArray(done.body.groups));
	const items = done.body.groups.flatMap((group) => group.items);
	const http = items.find((entry) => entry.name === "HTTP_PORT");
	assert.equal(http.default, "80");
	assert.equal(http.secret, false);
	const unset = items.find((entry) => entry.name === "INITIAL_ADMIN_PASSWORD");
	assert.equal(unset.secret, true);
	assert.equal(unset.set, false);
	process.env.INITIAL_ADMIN_PASSWORD = "sekret-admin-pw-77";
	try {
		const withSecret = await admin.get("/settings/environment");
		const secret = withSecret.body.groups
			.flatMap((group) => group.items)
			.find((entry) => entry.name === "INITIAL_ADMIN_PASSWORD");
		assert.equal(secret.set, true);
		assert.equal("value" in secret, false);
		assert.equal(withSecret.text.includes("sekret-admin-pw-77"), false);
	} finally {
		delete process.env.INITIAL_ADMIN_PASSWORD;
	}
	assert.ok(Array.isArray(done.body.locked_runtime));
});

it("lists the settings the environment locks, with the variable that does it", async () => {
	const done = await admin.get("/settings/environment");
	assert.equal(done.status, 200);
	// startApi sets DISABLE_GRAVATAR and DISABLE_NGINX_BEAUTIFIER
	assert.deepEqual(
		done.body.locked_runtime.filter((entry) => entry.group === "advanced" && entry.key !== "time_zone"),
		[
			{ group: "advanced", key: "config_beautifier", env: "DISABLE_NGINX_BEAUTIFIER", reason: null },
			{ group: "advanced", key: "gravatar", env: "DISABLE_GRAVATAR", reason: null },
		],
	);
});

it("answers 401 without a session and 403 for a user who is not an administrator", async () => {
	const none = api.client();
	const user = await api.limited({ visibility: "all" });
	for (const [method, url, body] of [
		["get", "/settings"],
		["get", SITE],
		["put", SITE, { value: "404" }],
		["get", "/settings/environment"],
	]) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
		assert.equal((await user[method](url, body)).status, 403, `${method} ${url}`);
	}
	assert.equal((await stored()).value, "congratulations");
	assert.equal(await fileExists(api, DEFAULT_CONF), true);
});
