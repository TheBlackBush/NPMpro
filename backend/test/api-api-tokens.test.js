import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const levels = (level, visibility = "user") => ({ visibility, ...Object.fromEntries(SECTIONS.map((s) => [s, level])) });
const permissionsOf = (level) => Object.fromEntries(SECTIONS.map((s) => [s, level]));
const TOKEN_TEXT = /^npmpro_[0-9a-f]{16}_[\w-]{43}$/u;
const PROXY_HOSTS = /proxy_hosts/u;
const DAY_MS = 86_400_000;

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const bearer = (token) => {
	const client = api.client();
	const headers = { authorization: `Bearer ${token}` };
	return {
		get: (url) => client.get(url, { headers }),
		post: (url, body) => client.post(url, body, { headers }),
		delete: (url) => client.delete(url, { headers }),
	};
};
const make = async (session, fields = {}) => {
	const made = await session.post("/users/me/api-tokens", {
		name: "t",
		permissions: permissionsOf("view"),
		...fields,
	});
	if (made.status !== 201) throw new Error(`creating a token answered ${made.status}: ${made.text}`);
	return made.body;
};
let names = 0;
const uniqueName = () => {
	names += 1;
	return `token-${names}`;
};

it("creates a token: 201, the secret once, the list without it", async () => {
	const owner = await api.limited(levels("view"));
	const created = await owner.post("/users/me/api-tokens", { name: " ci ", permissions: permissionsOf("view") });
	assert.equal(created.status, 201);
	const body = created.body;
	assert.match(body.token, TOKEN_TEXT);
	assert.equal(body.name, "ci");
	assert.equal(body.prefix, body.token.slice(0, 23));
	assert.equal(body.expired, false);
	assert.ok(Math.abs(Date.parse(body.expires_on) - Date.now() - 90 * DAY_MS) < 60_000);
	const list = await owner.get("/users/me/api-tokens");
	assert.equal(list.status, 200);
	assert.equal(list.body.length, 1);
	const stored = await api.db("npmpro_api_token").where({ id: body.id }).first();
	const text = JSON.stringify(list.body);
	assert.ok(!text.includes(body.token));
	assert.ok(!text.includes("secret_hash"));
	assert.ok(!text.includes(stored.secret_hash));
	assert.equal((await bearer(body.token).get("/nginx/proxy-hosts")).status, 200);
});

it("expiry choices", async () => {
	const owner = await api.limited(levels("view"));
	const none = await owner.post("/users/me/api-tokens", {
		name: "none",
		expires_on: null,
		permissions: permissionsOf("view"),
	});
	assert.equal(none.status, 201);
	assert.equal(none.body.expires_on, null);
	const later = new Date(Math.floor((Date.now() + 400 * DAY_MS) / 1000) * 1000).toISOString();
	const far = await owner.post("/users/me/api-tokens", {
		name: "far",
		expires_on: later,
		permissions: permissionsOf("view"),
	});
	assert.equal(far.status, 201);
	assert.equal(Date.parse(far.body.expires_on), Date.parse(later));
	for (const [name, value] of [
		["past", "2001-01-01T00:00:00Z"],
		["junk", "not a date"],
	]) {
		const refused = await owner.post("/users/me/api-tokens", {
			name,
			expires_on: value,
			permissions: permissionsOf("view"),
		});
		assert.equal(refused.status, 400, name);
	}
});

it("names: 1 to 100 characters, unique per owner without regard to case", async () => {
	const owner = await api.limited(levels("view"));
	const other = await api.limited(levels("view"));
	for (const name of ["", "   ", "x".repeat(101)]) {
		assert.equal(
			(await owner.post("/users/me/api-tokens", { name, permissions: permissionsOf("view") })).status,
			400,
		);
	}
	assert.equal(
		(await owner.post("/users/me/api-tokens", { name: "ci", permissions: permissionsOf("view") })).status,
		201,
	);
	const dup = await owner.post("/users/me/api-tokens", { name: "CI", permissions: permissionsOf("view") });
	assert.equal(dup.status, 400);
	assert.equal(dup.body.error.message, "An API token with this name already exists");
	assert.equal(
		(await other.post("/users/me/api-tokens", { name: "ci", permissions: permissionsOf("view") })).status,
		201,
	);
});

it("is capped at the owner", async () => {
	const owner = await api.limited({
		...levels("hidden"),
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	const above = await owner.post("/users/me/api-tokens", {
		name: uniqueName(),
		permissions: { ...permissionsOf("hidden"), proxy_hosts: "manage" },
	});
	assert.equal(above.status, 400);
	assert.match(above.body.error.message, PROXY_HOSTS);
	const visibility = await owner.post("/users/me/api-tokens", {
		name: uniqueName(),
		visibility: "all",
		permissions: permissionsOf("hidden"),
	});
	assert.equal(visibility.status, 400);
	const adminSwitch = await owner.post("/users/me/api-tokens", {
		name: uniqueName(),
		admin: true,
		permissions: permissionsOf("hidden"),
	});
	assert.equal(adminSwitch.status, 403);
	const within = await owner.post("/users/me/api-tokens", {
		name: uniqueName(),
		permissions: { ...permissionsOf("hidden"), proxy_hosts: "view", access_lists: "view", certificates: "view" },
	});
	assert.equal(within.status, 201);
});

it("the Administrator switch by an admin opens admin areas but not user management", async () => {
	const made = await make(admin, {
		name: uniqueName(),
		admin: true,
		permissions: permissionsOf("manage"),
		visibility: "all",
	});
	assert.equal(made.admin, true);
	const token = bearer(made.token);
	assert.equal((await token.get("/audit-log")).status, 200);
	assert.equal((await token.get("/users")).status, 403);
});

it("revokes a token", async () => {
	const owner = await api.limited(levels("view"));
	const other = await api.limited(levels("view"));
	const made = await make(owner, { name: uniqueName() });
	const foreign = await make(other, { name: uniqueName() });
	assert.equal((await owner.delete(`/users/me/api-tokens/${foreign.id}`)).status, 404);
	assert.equal((await owner.delete("/users/me/api-tokens/abc")).status, 400);
	const revoked = await owner.delete(`/users/me/api-tokens/${made.id}`);
	assert.equal(revoked.status, 200);
	assert.equal(revoked.body, true);
	assert.equal((await bearer(made.token).get("/nginx/proxy-hosts")).status, 401);
});

it("the admin overview lists every token with its owner and revokes any", async () => {
	const owner = await api.limited(levels("view"));
	const own = await make(admin, { name: uniqueName() });
	const theirs = await make(owner, { name: uniqueName() });
	const list = await admin.get("/api-tokens");
	assert.equal(list.status, 200);
	const row = list.body.find((t) => t.id === theirs.id);
	assert.equal(row.owner.email, owner.user.email);
	assert.ok(list.body.some((t) => t.id === own.id));
	assert.equal((await owner.get("/api-tokens")).status, 403);
	assert.equal((await owner.delete(`/api-tokens/${own.id}`)).status, 403);
	assert.equal((await admin.delete(`/api-tokens/${theirs.id}`)).status, 200);
	assert.equal((await bearer(theirs.token).get("/nginx/proxy-hosts")).status, 401);
	assert.equal((await admin.delete(`/api-tokens/${theirs.id}`)).status, 404);
});

it("a token cannot manage tokens", async () => {
	const made = await make(admin, {
		name: uniqueName(),
		admin: true,
		permissions: permissionsOf("manage"),
		visibility: "all",
	});
	const token = bearer(made.token);
	const attempts = [
		await token.get("/users/me/api-tokens"),
		await token.post("/users/me/api-tokens", { name: "x", permissions: permissionsOf("view") }),
		await token.delete("/users/me/api-tokens/1"),
		await token.get("/api-tokens"),
		await token.delete("/api-tokens/1"),
	];
	assert.deepEqual(
		attempts.map((r) => r.status),
		[403, 403, 403, 403, 403],
	);
	assert.equal((await admin.get("/users/me/api-tokens")).status, 200);
});

it("only the own id", async () => {
	const owner = await api.limited(levels("view"));
	const refused = await admin.get(`/users/${owner.user.id}/api-tokens`);
	assert.equal(refused.status, 403);
	assert.equal(refused.body.error.message, "Tokens are managed by their owner");
});

it("deleting a user deletes their tokens", async () => {
	const owner = await api.limited(levels("view"));
	await make(owner, { name: uniqueName() });
	assert.equal((await api.db("npmpro_api_token").where({ user_id: owner.user.id })).length, 1);
	assert.equal((await admin.delete(`/users/${owner.user.id}`)).status, 200);
	assert.equal((await api.db("npmpro_api_token").where({ user_id: owner.user.id })).length, 0);
});

it("expired tokens stay listed", async () => {
	const owner = await api.limited(levels("view"));
	const made = await make(owner, { name: uniqueName() });
	await api
		.db("npmpro_api_token")
		.where({ id: made.id })
		.update({ expires_on: Math.floor(Date.now() / 1000) - 10 });
	const list = await owner.get("/users/me/api-tokens");
	assert.equal(list.body[0].expired, true);
	assert.equal((await bearer(made.token).get("/nginx/proxy-hosts")).status, 401);
});

it("audits creation and both kinds of revocation without the secret", async () => {
	const owner = await api.limited(levels("view"));
	const first = await make(owner, { name: uniqueName() });
	const second = await make(owner, { name: uniqueName() });
	await owner.delete(`/users/me/api-tokens/${first.id}`);
	await admin.delete(`/api-tokens/${second.id}`);
	const rows = await api
		.db("audit_log")
		.where({ object_type: "api-token" })
		.whereIn("object_id", [first.id, second.id]);
	const parse = (row) => (typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta);
	const created = rows.find((r) => r.action === "created" && r.object_id === first.id);
	assert.equal(parse(created).name, first.name);
	assert.ok(parse(created).permissions);
	for (const row of rows) {
		assert.equal("token" in parse(row), false);
		assert.ok(!JSON.stringify(parse(row)).includes("secret_hash"));
	}
	const byOwner = rows.find((r) => r.action === "revoked" && r.object_id === first.id);
	const byAdmin = rows.find((r) => r.action === "revoked" && r.object_id === second.id);
	assert.equal(parse(byOwner).owner_id, owner.user.id);
	assert.equal(parse(byAdmin).owner_id, owner.user.id);
	assert.notEqual(byOwner.user_id, byAdmin.user_id);
});
