import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { generate } from "otplib";
import { generateApiToken } from "../lib/api-token.js";
import { PASSWORD, startApi } from "./support/api.js";
import { newAdmin } from "./support/auth.js";

const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const LIST_PATHS = {
	proxy_hosts: "/nginx/proxy-hosts",
	redirection_hosts: "/nginx/redirection-hosts",
	dead_hosts: "/nginx/dead-hosts",
	streams: "/nginx/streams",
	access_lists: "/nginx/access-lists",
	certificates: "/nginx/certificates",
};
const levels = (level, visibility = "user") => ({ visibility, ...Object.fromEntries(SECTIONS.map((s) => [s, level])) });
const now = () => Math.floor(Date.now() / 1000);
const host = (n) => ({
	domain_names: [`bearer${n}.example.com`],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 8080,
});
const BEARER = /Bearer/u;
const REJECTED_ORIGIN = /Rejected Origin\./u;

let api;
let admin;
let tokens = 0;
let hosts = 0;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

// a token row for a user, as the service would store it; returns the token text
const makeToken = async (userId, fields = {}) => {
	tokens += 1;
	const made = generateApiToken();
	await api.db("npmpro_api_token").insert({
		user_id: userId,
		name: `token ${tokens}`,
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		...levels("view"),
		created_on: now(),
		expires_on: now() + 3600,
		...fields,
	});
	return made.token;
};

// a client of its own (its own address) that sends the token
const bearer = (token) => {
	const client = api.client();
	const auth = { authorization: `Bearer ${token}` };
	return {
		get: (url, headers) => client.get(url, { headers: { ...auth, ...headers } }),
		post: (url, body) => client.post(url, body, { headers: auth }),
		put: (url, body) => client.put(url, body, { headers: auth }),
		delete: (url) => client.delete(url, { headers: auth }),
		client,
	};
};
const adminId = async () => (await admin.get("/users/me")).body.id;
const rows = (where) => api.db("audit_log").where(where);

it("a view token lists proxy hosts and cannot create one", async () => {
	const user = await api.limited(levels("manage", "all"));
	const token = await makeToken(user.user.id, levels("view"));
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
	hosts += 1;
	assert.equal((await bearer(token).post("/nginx/proxy-hosts", host(hosts))).status, 403);
});

it("the owner's level lowered after creation caps the token", async () => {
	const user = await api.limited({ ...levels("view"), proxy_hosts: "manage" });
	const token = await makeToken(user.user.id, { ...levels("view"), proxy_hosts: "manage" });
	hosts += 1;
	assert.equal((await bearer(token).post("/nginx/proxy-hosts", host(hosts))).status, 201);
	const lowered = await admin.put(`/users/${user.user.id}/permissions`, levels("view"));
	assert.equal(lowered.status, 200);
	hosts += 1;
	assert.equal((await bearer(token).post("/nginx/proxy-hosts", host(hosts))).status, 403);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
});

it("visibility is the lower of the owner's and the token's", async () => {
	const mine = await api.limited(levels("manage", "all"));
	hosts += 1;
	const domain = `bearer${hosts}.example.com`;
	assert.equal((await admin.post("/nginx/proxy-hosts", host(hosts))).status, 201);
	const listed = async (token) =>
		(await bearer(token).get("/nginx/proxy-hosts")).body.some((h) => h.domain_names.includes(domain));
	assert.equal(await listed(await makeToken(mine.user.id, levels("view", "user"))), false);
	assert.equal(await listed(await makeToken(mine.user.id, levels("view", "all"))), true);
	const narrow = await api.limited(levels("manage", "user"));
	assert.equal(await listed(await makeToken(narrow.user.id, levels("view", "all"))), false);
});

it("every section opens its own list and hides the others", async () => {
	const user = await api.limited(levels("manage", "all"));
	for (const [index, section] of SECTIONS.entries()) {
		const other = SECTIONS[(index + 1) % SECTIONS.length];
		const token = await makeToken(user.user.id, { ...levels("hidden"), [section]: "view" });
		assert.equal((await bearer(token).get(LIST_PATHS[section])).status, 200, section);
		assert.equal((await bearer(token).get(LIST_PATHS[other])).status, 403, other);
	}
});

it("an admin's token without the switch is not an admin", async () => {
	const token = await makeToken(await adminId(), levels("manage"));
	assert.equal((await bearer(token).get("/audit-log")).status, 403);
	assert.equal((await bearer(token).get("/settings")).status, 403);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
});

it("an admin's token with the switch is an admin, except for users", async () => {
	const token = await makeToken(await adminId(), { ...levels("manage"), is_admin: true });
	assert.equal((await bearer(token).get("/audit-log")).status, 200);
	assert.equal((await bearer(token).get("/settings")).status, 200);
	assert.equal((await bearer(token).get("/backups")).status, 200);
	assert.equal((await bearer(token).get("/users")).status, 403);
});

it("a demoted admin's token loses the admin rights", async () => {
	const boss = await newAdmin(api, admin);
	const token = await makeToken(boss.user.id, { ...levels("manage"), is_admin: true });
	assert.equal((await bearer(token).get("/audit-log")).status, 200);
	const demoted = await admin.put(`/users/${boss.user.id}`, { roles: [] });
	assert.equal(demoted.status, 200);
	await admin.put(`/users/${boss.user.id}/permissions`, levels("view"));
	assert.equal((await bearer(token).get("/audit-log")).status, 403);
});

it("a non-admin owner's token with is_admin stored is not an admin", async () => {
	const user = await api.limited(levels("manage"));
	const token = await makeToken(user.user.id, { ...levels("manage"), is_admin: true });
	assert.equal((await bearer(token).get("/audit-log")).status, 403);
});

it("an expired token is a 401, audited once", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id, { expires_on: now() - 1 });
	const first = await bearer(token).get("/nginx/proxy-hosts");
	assert.equal(first.status, 401);
	assert.equal(first.body.error.message, "API token has expired");
	assert.match(first.headers.get("www-authenticate"), BEARER);
	const row = await api
		.db("npmpro_api_token")
		.where({ lookup_id: token.split("_")[1] })
		.first();
	const where = { action: "expired", object_type: "api-token", npmpro_api_token_name: row.name };
	assert.equal((await rows(where)).length, 1);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 401);
	assert.equal((await rows(where)).length, 1);
});

it("a revoked token is a 401", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
	await api.db("npmpro_api_token").where({ user_id: user.user.id }).delete();
	const refused = await bearer(token).get("/nginx/proxy-hosts");
	assert.equal(refused.status, 401);
	assert.equal(refused.body.error.message, "Invalid or expired token");
});

it("unknown and malformed tokens are a 401", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id);
	const [prefix, lookup] = token.split("_");
	const wrongSecret = `${prefix}_${lookup}_${"A".repeat(43)}`;
	const tests = [`npmpro_0123456789abcdef_${"B".repeat(43)}`, "garbage", wrongSecret];
	for (const text of tests) {
		assert.equal((await bearer(text).get("/nginx/proxy-hosts")).status, 401, text);
	}
	const alone = await api.client().get("/nginx/proxy-hosts", { headers: { authorization: "Bearer" } });
	assert.equal(alone.status, 401);
});

it("a disabled or deleted owner is a 401", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id);
	assert.equal((await admin.put(`/users/${user.user.id}`, { is_disabled: true })).status, 200);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 401);
	assert.equal((await admin.put(`/users/${user.user.id}`, { is_disabled: false })).status, 200);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
	assert.equal((await admin.delete(`/users/${user.user.id}`)).status, 200);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 401);
});

it("a cookie plus a bearer is a 400 and keeps the cookie", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id);
	const both = await user.get("/nginx/proxy-hosts", { headers: { authorization: `Bearer ${token}` } });
	assert.equal(both.status, 400);
	assert.equal(both.body.error.message, "Send a session cookie or an API token, not both");
	assert.equal(
		both.headers.getSetCookie().some((line) => line.startsWith("__Host-Http-token=;")),
		false,
	);
	assert.equal((await user.get("/nginx/proxy-hosts")).status, 200);
});

it("five failed bearer requests limit the address, refusals other than 401 do not count", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id);
	const limited = bearer(token);
	for (let i = 0; i < 5; i += 1) {
		assert.equal((await limited.get("/nginx/proxy-hosts", { authorization: "Bearer garbage" })).status, 401);
	}
	assert.equal((await limited.get("/nginx/proxy-hosts")).status, 429);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);

	const refused = bearer(token);
	for (let i = 0; i < 6; i += 1) {
		hosts += 1;
		assert.equal((await refused.post("/nginx/proxy-hosts", host(hosts))).status, 403);
	}
	assert.equal((await refused.get("/nginx/proxy-hosts")).status, 200);
});

it("last use is written once a minute and the first use is audited once", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id);
	const row = () => api.db("npmpro_api_token").where({ user_id: user.user.id }).first();
	assert.equal((await row()).last_used_on, null);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
	const first = (await row()).last_used_on;
	assert.notEqual(first, null);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
	assert.equal(Number((await row()).last_used_on), Number(first));
	const entries = () => rows({ action: "first-used", npmpro_api_token_id: undefined }).catch(() => []);
	void entries;
	const used = async () => (await rows({ action: "first-used", user_id: user.user.id })).length;
	assert.equal(await used(), 1);
	const found = await rows({ action: "first-used", user_id: user.user.id }).first();
	assert.equal(found.npmpro_api_token_name, (await row()).name);
	await api
		.db("npmpro_api_token")
		.where({ user_id: user.user.id })
		.update({ last_used_on: now() - 61 });
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
	assert.ok(Number((await row()).last_used_on) >= now() - 2);
	assert.equal(await used(), 1);
});

it("the audit entries of a token request carry the token", async () => {
	const user = await api.limited(levels("manage"));
	const token = await makeToken(user.user.id, levels("manage"));
	hosts += 1;
	const created = await bearer(token).post("/nginx/proxy-hosts", host(hosts));
	assert.equal(created.status, 201);
	const entry = await rows({ action: "created", object_type: "proxy-host", object_id: created.body.id }).first();
	const row = await api.db("npmpro_api_token").where({ user_id: user.user.id }).first();
	assert.equal(entry.user_id, user.user.id);
	assert.equal(entry.npmpro_api_token_id, row.id);
	assert.equal(entry.npmpro_api_token_name, row.name);
	hosts += 1;
	const byCookie = await user.post("/nginx/proxy-hosts", host(hosts));
	const plain = await rows({ action: "created", object_type: "proxy-host", object_id: byCookie.body.id }).first();
	assert.equal(plain.npmpro_api_token_id, null);
	assert.equal(plain.npmpro_api_token_name, null);
});

// the status of every account route for a token, then of the two reads of its own user
const accountRoutes = async (token, ownId, extra = []) => {
	const refusals = [
		["put", "/users/me/auth", { type: "password", current: PASSWORD, secret: "new-password-123456" }],
		["get", "/users/me/mfa"],
		["post", "/users/me/mfa/totp"],
		["delete", "/users/me/sessions"],
		["delete", "/users/me/avatar"],
		["put", "/users/me", { name: "x" }],
		["get", "/tokens"],
		...extra,
	];
	const refused = {};
	for (const [method, url, body] of refusals) {
		refused[`${method} ${url}`] = (await bearer(token)[method](url, body)).status;
	}
	const own = [(await bearer(token).get("/users/me")).status, (await bearer(token).get(`/users/${ownId}`)).status];
	return { refused, own };
};

// the same calls, all answered 403
const allRefused = (refused) => Object.fromEntries(Object.keys(refused).map((call) => [call, 403]));

it("account routes refuse a token and leave the account unchanged", async () => {
	const user = await api.limited(levels("manage"));
	const token = await makeToken(user.user.id, levels("manage"));
	const own = await accountRoutes(token, user.user.id);
	assert.deepEqual(own.refused, allRefused(own.refused));
	assert.deepEqual(own.own, [200, 200]);
	const boss = await adminId();
	const other = await api.limited(levels("view"));
	const adminToken = await makeToken(boss, { ...levels("manage"), is_admin: true });
	const asAdmin = await accountRoutes(adminToken, boss, [["delete", `/users/${other.user.id}/oidc`]]);
	assert.deepEqual(asAdmin.refused, allRefused(asAdmin.refused));
	assert.deepEqual(asAdmin.own, [200, 200]);
	assert.equal((await api.client().post("/tokens", { identity: user.user.email, secret: PASSWORD })).status, 200);
});

it("an MFA user's token keeps working", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id);
	const setup = await user.post(`/users/${user.user.id}/mfa/totp`);
	assert.equal(setup.status, 200);
	const enabled = await user.post(`/users/${user.user.id}/mfa/totp/enable`, {
		code: await generate({ secret: setup.body.secret }),
	});
	assert.equal(enabled.status, 200);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts")).status, 200);
});

it("user management refuses every token and changes nothing", async () => {
	const target = await api.limited(levels("view"));
	const id = target.user.id;
	const original = await api.db("user").where({ id }).first();
	const owners = [
		[await adminId(), { is_admin: true, ...levels("manage") }],
		[(await api.limited(levels("manage"))).user.id, levels("manage")],
	];
	const calls = [
		["get", "/users"],
		[
			"post",
			"/users",
			{ name: "N", email: "new-user@example.com", roles: [], auth: { type: "password", secret: PASSWORD } },
		],
		["get", `/users/${id}`],
		["put", `/users/${id}`, { name: "x" }],
		["put", `/users/${id}`, { is_disabled: true }],
		["delete", `/users/${id}`],
		["put", `/users/${id}/permissions`, levels("manage")],
		["put", `/users/${id}/auth`, { type: "password", secret: "new-password-123456" }],
		["delete", `/users/${id}/mfa`],
		["delete", `/users/${id}/sessions`],
		["delete", `/users/${id}/oidc`],
		["post", `/users/${id}/avatar`],
		["delete", `/users/${id}/avatar`],
		["put", "/users/me", { name: "x" }],
		["delete", "/users/me"],
	];
	for (const [owner, fields] of owners) {
		const token = await makeToken(owner, fields);
		for (const [method, url, body] of calls) {
			const response = await bearer(token)[method](url, body);
			assert.equal(response.status, 403, `${method} ${url}`);
		}
		assert.equal((await bearer(token).get("/users/me")).status, 200);
		assert.equal((await bearer(token).get(`/users/${owner}`)).status, 200);
	}
	assert.deepEqual(await api.db("user").where({ id }).first(), original);
	assert.equal((await api.db("user").where({ email: "new-user@example.com" })).length, 0);
	assert.equal((await api.db("user").where({ id: owners[1][0] }).first()).is_disabled, 0);
	assert.equal(
		(await bearer(owners[0][0] && (await makeToken(owners[0][0], levels("view")))).get(`/users/${id}`)).status,
		403,
	);
});

it("the Origin check applies to a bearer request", async () => {
	const user = await api.limited(levels("view"));
	const token = await makeToken(user.user.id);
	const foreign = await bearer(token).get("/nginx/proxy-hosts", { origin: "https://evil.example" });
	assert.equal(foreign.status, 403);
	assert.match(foreign.text, REJECTED_ORIGIN);
	assert.equal((await bearer(token).get("/nginx/proxy-hosts", { "sec-fetch-site": "cross-site" })).status, 403);
});

it("refusals of the user management guard do not count toward the sign-in limit", async () => {
	const token = await makeToken(await adminId(), { ...levels("manage"), is_admin: true });
	const client = bearer(token);
	for (let i = 0; i < 7; i += 1) assert.equal((await client.get("/users")).status, 403);
	// the limit is 5 failed requests from one address: a counted refusal would have turned these into 429
	assert.equal((await client.get("/users/me")).status, 200);
});
