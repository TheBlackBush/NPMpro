import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// app.js in front of every router: the Origin and Sec-Fetch-Site checks, and the error body.

const ROUTERS = [
	["GET", "/tokens"],
	["POST", "/tokens"],
	["POST", "/tokens/totp"],
	["GET", "/users"],
	["GET", "/users/me"],
	["GET", "/audit-log"],
	["GET", "/backups"],
	["GET", "/backups/schedules"],
	["GET", "/database"],
	["GET", "/reports/hosts"],
	["GET", "/monitoring/traffic"],
	["GET", "/settings"],
	["GET", "/version/check"],
	["GET", "/nginx/proxy-hosts"],
	["GET", "/nginx/redirection-hosts"],
	["GET", "/nginx/dead-hosts"],
	["GET", "/nginx/streams"],
	["GET", "/nginx/access-lists"],
	["GET", "/nginx/certificates"],
	["GET", "/nginx/dns-credentials"],
	["GET", "/oidc/config"],
	["GET", "/schema"],
	["GET", "/auth"],
	["GET", "/auth/admin"],
	["GET", ""],
];
const REJECTED_ORIGIN = "Rejected Origin.";
const REJECTED_FETCH_SITE = "Rejected Sec-Fetch-Site Value.";
const SQL_WORDS = /sqlite|no such table|SELECT|audit_log|knex/iu;

let api;
let admin;

const call = (session, [method, url], headers) =>
	session.send(method, url, { headers, body: method === "POST" ? {} : undefined });

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("refuses a foreign Origin with 403 on every router, with and without a session", async () => {
	for (const route of ROUTERS) {
		for (const session of [api.client(), admin]) {
			const refused = await call(session, route, { origin: "https://evil.example.org" });
			assert.equal(refused.status, 403, route.join(" "));
			assert.equal(refused.body.error.message, REJECTED_ORIGIN, route.join(" "));
		}
	}
});

it("refuses Sec-Fetch-Site cross-site and same-site with 403 on every router", async () => {
	for (const route of ROUTERS) {
		for (const site of ["cross-site", "same-site"]) {
			const refused = await call(api.client(), route, { "sec-fetch-site": site });
			assert.equal(refused.status, 403, `${route.join(" ")} ${site}`);
			assert.equal(refused.body.error.message, REJECTED_FETCH_SITE, `${route.join(" ")} ${site}`);
		}
	}
});

it("lets same-origin and direct (none) requests through to the router", async () => {
	for (const site of ["same-origin", "none"]) {
		const response = await admin.get("/users/me", { headers: { "sec-fetch-site": site } });
		assert.equal(response.status, 200, site);
	}
});

it("does not log in or change anything for a request from a foreign Origin", async () => {
	const login = await api
		.client()
		.post(
			"/tokens",
			{ identity: "admin@example.com", secret: "correct-horse-battery-9" },
			{ headers: { origin: "https://evil.example.org" } },
		);
	assert.equal(login.status, 403);
	assert.equal(login.headers.getSetCookie().length, 0);
	const users = (await api.db("user").count({ n: "*" }).first()).n;
	const created = await admin.post(
		"/users",
		{ name: "Evil", email: "evil@example.com" },
		{ headers: { "sec-fetch-site": "cross-site" } },
	);
	assert.equal(created.status, 403);
	assert.equal((await api.db("user").count({ n: "*" }).first()).n, users);
	// the session of the administrator is not touched either
	assert.equal((await admin.delete("/tokens", { headers: { origin: "https://evil.example.org" } })).status, 403);
	assert.equal((await admin.get("/users/me")).status, 200);
});

it("answers an unknown route with 404 and a malformed JSON body with 400, without a stack trace", async () => {
	const missing = await admin.get("/no-such-route");
	assert.equal(missing.status, 404);
	assert.equal(missing.body.error.code, 404);
	assert.equal(missing.text.includes(" at "), false);
	const broken = await api.client().send("POST", "/tokens", {
		headers: { "content-type": "application/json" },
		form: "{ not json",
	});
	assert.equal(broken.status, 400);
	assert.equal(broken.text.includes("node_modules"), false);
});

it("shows only 'Internal Error' for a failure inside, never the database message", async () => {
	await api.db.schema.renameTable("audit_log", "audit_log_hidden");
	let response;
	try {
		response = await admin.post("/users", { name: "Breaks", email: "breaks@example.com" });
	} finally {
		await api.db.schema.renameTable("audit_log_hidden", "audit_log");
	}
	assert.equal(response.status, 500);
	assert.deepEqual(response.body, { error: { code: 500, message: "Internal Error" } });
	assert.doesNotMatch(response.text, SQL_WORDS);
});
