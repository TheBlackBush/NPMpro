import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { after, before, it, mock } from "node:test";
import { PASSWORD, startApi } from "./support/api.js";
import { newAdmin } from "./support/auth.js";

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.alloc(64, 2)]);

let api;
let admin;
let accounts = 0;

const form = (bytes, type, name = "avatar.bin") => {
	const data = new FormData();
	data.append("avatar", new Blob([bytes], { type }), name);
	return data;
};
const exists = (file) =>
	stat(path.join(api.root, file)).then(
		() => true,
		() => false,
	);
const create = async (overrides = {}) => {
	accounts += 1;
	const body = {
		name: `User ${accounts}`,
		email: `plain${accounts}@example.com`,
		auth: { type: "password", secret: PASSWORD },
		...overrides,
	};
	const created = await admin.post("/users", body);
	if (created.status !== 201) throw new Error(`creating a user answered ${created.status}: ${created.text}`);
	return created.body;
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
});
after(() => {
	mock.timers.reset();
	return api?.stop();
});

it("creates a user: 201, the address lowercased, no administrator, hidden permissions, a hashed password", async () => {
	const created = await admin.post("/users", {
		name: "Created One",
		email: "Created.One@Example.COM",
		auth: { type: "password", secret: PASSWORD },
	});
	assert.equal(created.status, 201);
	assert.equal(created.body.email, "created.one@example.com");
	assert.equal(created.body.name, "Created One");
	assert.deepEqual(created.body.roles, []);
	assert.equal(created.body.is_disabled, false);
	assert.equal(typeof created.body.avatar, "string");
	for (const secret of ["auth", "secret", "password"]) assert.equal(secret in created.body, false);
	const row = await api.db("user").where({ id: created.body.id }).first();
	assert.equal(row.email, "created.one@example.com");
	const permissions = await api.db("user_permission").where({ user_id: created.body.id }).first();
	assert.equal(permissions.visibility, "user");
	for (const type of ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"]) {
		assert.equal(permissions[type], "hidden", type);
	}
	const auth = await api.db("auth").where({ user_id: created.body.id }).first();
	assert.equal(auth.type, "password");
	// stored as a salted hash, never the password
	assert.equal(auth.secret.includes(PASSWORD), false);
	assert.ok(JSON.parse(auth.secret).tag);
	const login = await api.client().post("/tokens", { identity: "CREATED.one@example.com", secret: PASSWORD });
	assert.equal(login.status, 200);
	const audit = await api.db("audit_log").where({ object_type: "user", object_id: created.body.id }).first();
	assert.equal(audit.action, "created");
});

it("creates an administrator with all visibility, and a user without a password that cannot log in", async () => {
	const boss = await create({ roles: ["admin"], is_disabled: false });
	assert.deepEqual(boss.roles, ["admin"]);
	assert.equal((await api.db("user_permission").where({ user_id: boss.id }).first()).visibility, "all");
	const passwordless = await admin.post("/users", { name: "No Password", email: "nopassword@example.com" });
	assert.equal(passwordless.status, 201);
	assert.equal(await api.db("auth").where({ user_id: passwordless.body.id }).first(), undefined);
	const login = await api.client().post("/tokens", { identity: "nopassword@example.com", secret: PASSWORD });
	assert.equal(login.status, 403);
});

it("answers 400 for a user that does not match the schema and creates nothing", async () => {
	const users = (await api.db("user").count({ n: "*" }).first()).n;
	const ok = { name: "Bad", email: "bad@example.com", auth: { type: "password", secret: PASSWORD } };
	const bodies = [
		{ ...ok, name: undefined },
		{ ...ok, email: undefined },
		{ ...ok, email: "no-at-sign" },
		{ ...ok, name: "" },
		{ ...ok, roles: ["root"] },
		{ ...ok, extra: true },
		{ ...ok, auth: { type: "password", secret: "short" } },
		{ ...ok, auth: { type: "token", secret: PASSWORD } },
		{ ...ok, auth: { type: "password" } },
	];
	// a client is refused after five failed requests, so each body takes an administrator of its own
	for (const body of bodies) {
		const session = await newAdmin(api, admin);
		assert.equal((await session.post("/users", body)).status, 400, JSON.stringify(body));
	}
	assert.equal(await api.db("user").where({ email: "bad@example.com" }).first(), undefined);
	assert.equal((await api.db("user").count({ n: "*" }).first()).n, users + bodies.length);
});

it("refuses a duplicate address with 400, whatever its letter case", async () => {
	const session = await newAdmin(api, admin);
	const taken = await create();
	const same = await session.post("/users", { name: "Copy", email: taken.email.toUpperCase() });
	assert.equal(same.status, 400);
	assert.equal((await api.db("user").where({ email: taken.email }).count({ n: "*" }).first()).n, 1);
	assert.equal((await session.post("/users", { name: "Copy", email: "ADMIN@example.com" })).status, 400);
});

it("lists the users for an administrator: sorted by name, searchable, no secrets", async () => {
	const list = await admin.get("/users");
	assert.equal(list.status, 200);
	assert.ok(Array.isArray(list.body));
	assert.ok(list.body.length >= 2);
	const names = list.body.map((user) => user.name);
	assert.deepEqual(
		names,
		[...names].sort((a, b) => a.localeCompare(b)),
	);
	for (const user of list.body) {
		for (const secret of ["auth", "secret", "password"]) assert.equal(secret in user, false);
		assert.ok(Number.isInteger(user.id));
	}
	const found = await create({ name: "Zebra Findable", email: "needle.haystack@example.com" });
	const byName = await admin.get("/users?query=zebra%20find");
	assert.deepEqual(
		byName.body.map((user) => user.id),
		[found.id],
	);
	const byEmail = await admin.get("/users?query=needle.hay");
	assert.deepEqual(
		byEmail.body.map((user) => user.id),
		[found.id],
	);
	assert.deepEqual((await admin.get("/users?query=no-such-person-anywhere")).body, []);
});

it("refuses the user list and creation without a session (401) and without the admin role (403)", async () => {
	const user = await api.limited({ visibility: "user" });
	assert.equal((await api.client().get("/users")).status, 401);
	assert.equal((await api.client().post("/users", { name: "X", email: "x@example.com" })).status, 401);
	assert.equal((await user.get("/users")).status, 403);
	const usersBefore = (await api.db("user").count({ n: "*" }).first()).n;
	const refused = await user.post("/users", { name: "X", email: "x@example.com" });
	assert.equal(refused.status, 403);
	assert.equal((await api.db("user").count({ n: "*" }).first()).n, usersBefore);
});

it("reads one user: an administrator any, a user itself and me, with the permissions on request", async () => {
	const account = await api.limited({
		visibility: "user",
		proxy_hosts: "view",
		access_lists: "view",
		certificates: "view",
	});
	const { id } = account.user;
	const asAdmin = await admin.get(`/users/${id}`);
	assert.equal(asAdmin.status, 200);
	assert.equal(asAdmin.body.id, id);
	assert.equal("permissions" in asAdmin.body, false);
	const expanded = await admin.get(`/users/${id}?expand=permissions`);
	assert.equal(expanded.body.permissions.proxy_hosts, "view");
	assert.equal(expanded.body.permissions.visibility, "user");
	assert.equal(expanded.body.permissions.user_id, id);
	const own = await account.get(`/users/${id}`);
	assert.equal(own.status, 200);
	const me = await account.get("/users/me");
	assert.equal(me.status, 200);
	assert.equal(me.body.id, id);
	assert.equal(me.body.email, account.user.email);
	assert.equal(me.body.monitoring, false);
	assert.equal((await admin.get("/users/me")).body.email, "admin@example.com");
});

it("refuses reading another user without being an administrator, and unknown users and ids", async () => {
	const one = await api.limited({ visibility: "user" });
	const two = await api.limited({ visibility: "user" });
	assert.equal((await one.get(`/users/${two.user.id}`)).status, 403);
	assert.equal((await api.client().get(`/users/${one.user.id}`)).status, 401);
	assert.equal((await api.client().get("/users/me")).status, 401);
	const session = await newAdmin(api, admin);
	assert.equal((await session.get("/users/999999")).status, 404);
	assert.equal((await session.get("/users/abc")).status, 400);
	assert.equal((await session.get("/users/0")).status, 400);
	assert.equal((await session.get(`/users/${one.user.id}?expand=secrets`)).status, 400);
});

it("updates a user: name and address (lowercased), refreshing the modified time, and writes an audit entry", async () => {
	const account = await create();
	const updated = await admin.put(`/users/${account.id}`, { name: "Renamed", email: "Renamed.User@Example.com" });
	assert.equal(updated.status, 200);
	assert.equal(updated.body.name, "Renamed");
	assert.equal(updated.body.email, "renamed.user@example.com");
	const row = await api.db("user").where({ id: account.id }).first();
	assert.equal(row.name, "Renamed");
	assert.equal(row.email, "renamed.user@example.com");
	assert.equal(
		(await api.client().post("/tokens", { identity: "renamed.user@example.com", secret: PASSWORD })).status,
		200,
	);
	assert.equal((await api.client().post("/tokens", { identity: account.email, secret: PASSWORD })).status, 403);
	const audit = await api
		.db("audit_log")
		.where({ object_type: "user", object_id: account.id, action: "updated" })
		.first();
	assert.ok(audit);
});

it("promotes another user to administrator and back, and disabling ends its sessions", async () => {
	const account = await api.limited({ visibility: "user" });
	assert.equal((await account.get("/users")).status, 403);
	const promoted = await admin.put(`/users/${account.user.id}`, { roles: ["admin"] });
	assert.deepEqual(promoted.body.roles, ["admin"]);
	assert.equal((await account.get("/users")).status, 200);
	assert.deepEqual(JSON.parse((await api.db("user").where({ id: account.user.id }).first()).roles), ["admin"]);
	assert.equal((await admin.put(`/users/${account.user.id}`, { roles: [] })).status, 200);
	assert.equal((await account.get("/users")).status, 403);
	assert.equal((await admin.put(`/users/${account.user.id}`, { is_disabled: true })).status, 200);
	assert.equal((await account.get("/users/me")).status, 401);
	assert.equal((await admin.put(`/users/${account.user.id}`, { is_disabled: false })).status, 200);
	assert.equal((await api.db("user").where({ id: account.user.id }).first()).is_disabled, 0);
});

it("answers 400 for an update that does not match the schema or takes an address that is in use", async () => {
	const session = await newAdmin(api, admin);
	const one = await create();
	const two = await create();
	assert.equal((await session.put(`/users/${one.id}`, {})).status, 400);
	assert.equal((await session.put(`/users/${one.id}`, { extra: 1 })).status, 400);
	assert.equal((await session.put(`/users/${one.id}`, { email: "no-at-sign" })).status, 400);
	assert.equal((await session.put(`/users/${one.id}`, { roles: ["root"] })).status, 400);
	const taken = await newAdmin(api, admin);
	const clash = await taken.put(`/users/${one.id}`, { email: two.email.toUpperCase() });
	assert.equal(clash.status, 400);
	assert.equal((await api.db("user").where({ id: one.id }).first()).email, one.email);
	// its own address in another letter case is not a clash
	assert.equal((await admin.put(`/users/${one.id}`, { email: one.email.toUpperCase() })).status, 200);
});

it("lets a user change its own name but not its roles or another user, and an administrator not its own roles or state", async () => {
	const account = await api.limited({ visibility: "user" });
	const other = await create();
	const own = await account.put("/users/me", { name: "My New Name" });
	assert.equal(own.status, 200);
	assert.equal(own.body.name, "My New Name");
	assert.equal((await api.db("user").where({ id: account.user.id }).first()).name, "My New Name");
	assert.equal((await account.put(`/users/${account.user.id}`, { roles: ["admin"] })).status, 403);
	assert.equal((await account.put(`/users/${other.id}`, { name: "Hijacked" })).status, 403);
	assert.equal((await api.db("user").where({ id: other.id }).first()).name, other.name);
	assert.equal((await api.client().put(`/users/${other.id}`, { name: "Anonymous" })).status, 401);

	const sole = await newAdmin(api, admin);
	assert.equal((await sole.put(`/users/${sole.user.id}`, { roles: [] })).status, 403);
	const other2 = await newAdmin(api, admin);
	assert.equal((await other2.put("/users/me", { is_disabled: true })).status, 403);
	assert.deepEqual(JSON.parse((await api.db("user").where({ id: other2.user.id }).first()).roles), ["admin"]);
	assert.equal((await api.db("user").where({ id: other2.user.id }).first()).is_disabled, 0);
});

it("deletes a user: its rows and avatar files go, the answer is the user, a second delete is 404", async () => {
	const account = await create();
	const session = await newAdmin(api, admin);
	const uploaded = await admin.post(`/users/${account.id}/avatar`, undefined, { form: form(PNG, "image/png") });
	assert.equal(uploaded.status, 200);
	assert.equal(await exists(`data/public/avatar/${account.id}.png`), true);
	const deleted = await admin.delete(`/users/${account.id}`);
	assert.equal(deleted.status, 200);
	assert.equal(deleted.body.id, account.id);
	assert.equal(deleted.body.email, account.email);
	assert.equal(await api.db("user").where({ id: account.id }).first(), undefined);
	assert.equal(await api.db("auth").where({ user_id: account.id }).first(), undefined);
	assert.equal(await api.db("user_permission").where({ user_id: account.id }).first(), undefined);
	assert.equal(await exists(`data/public/avatar/${account.id}.png`), false);
	assert.equal(
		(await api.db("audit_log").where({ object_type: "user", object_id: account.id, action: "deleted" }).first())
			.action,
		"deleted",
	);
	assert.equal((await session.delete(`/users/${account.id}`)).status, 404);
	assert.equal((await api.client().post("/tokens", { identity: account.email, secret: PASSWORD })).status, 403);
});

it("refuses deleting without a session (401), without the admin role (403) and deleting yourself (403)", async () => {
	const account = await create();
	const user = await api.limited({ visibility: "user" });
	assert.equal((await api.client().delete(`/users/${account.id}`)).status, 401);
	assert.equal((await user.delete(`/users/${account.id}`)).status, 403);
	assert.equal((await user.delete(`/users/${user.user.id}`)).status, 403);
	const session = await newAdmin(api, admin);
	const self = await session.delete(`/users/${session.user.id}`);
	assert.equal(self.status, 403);
	assert.equal(self.body.error.message, "You cannot delete yourself.");
	assert.ok(await api.db("user").where({ id: account.id }).first());
	assert.ok(await api.db("user").where({ id: user.user.id }).first());
	assert.ok(await api.db("user").where({ id: session.user.id }).first());
});

it("stores an uploaded avatar under data/public/avatar and replaces it with the next one", async () => {
	const account = await api.limited({ visibility: "user" });
	const { id } = account.user;
	const png = await account.post(`/users/${id}/avatar`, undefined, { form: form(PNG, "image/png") });
	assert.equal(png.status, 200);
	assert.match(png.body.avatar, new RegExp(`^/images/avatar/${id}\\.png\\?v=\\d+$`, "u"));
	assert.equal(await exists(`data/public/avatar/${id}.png`), true);
	assert.equal((await api.db("user").where({ id }).first()).avatar, png.body.avatar);
	assert.equal((await account.get("/users/me")).body.avatar, png.body.avatar);
	// the type comes from the content, not from the name or the declared type
	const jpeg = await account.post("/users/me/avatar", undefined, { form: form(JPEG, "text/plain", "avatar.png") });
	assert.equal(jpeg.status, 200);
	assert.match(jpeg.body.avatar, new RegExp(`^/images/avatar/${id}\\.jpg\\?v=\\d+$`, "u"));
	assert.equal(await exists(`data/public/avatar/${id}.jpg`), true);
	assert.equal(await exists(`data/public/avatar/${id}.png`), false);
});

it("refuses an avatar that is no png, jpeg, gif or webp, one over 1 MiB, and a request without a file, and stores nothing", async () => {
	const account = await api.limited({ visibility: "user" });
	const { id } = account.user;
	const text = await account.post(`/users/${id}/avatar`, undefined, {
		form: form(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/svg+xml", "a.svg"),
	});
	assert.equal(text.status, 400);
	const tiny = await account.post(`/users/${id}/avatar`, undefined, {
		form: form(Buffer.from([0x89, 0x50]), "image/png"),
	});
	assert.equal(tiny.status, 400);
	const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
	const oversized = await account.post(`/users/${id}/avatar`, undefined, { form: form(big, "image/png") });
	assert.equal(oversized.status, 400);
	const data = new FormData();
	data.append("other", new Blob([PNG]), "a.png");
	assert.equal((await account.post(`/users/${id}/avatar`, undefined, { form: data })).status, 400);
	for (const ext of ["png", "jpg", "gif", "webp"])
		assert.equal(await exists(`data/public/avatar/${id}.${ext}`), false);
	assert.equal((await api.db("user").where({ id }).first()).avatar.startsWith("/images/avatar/"), false);
});

it("takes an avatar up to the limit and refuses it for another user, without a session and for a user that is not there", async () => {
	const one = await api.limited({ visibility: "user" });
	const two = await api.limited({ visibility: "user" });
	const atLimit = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 - PNG.length)]);
	assert.equal(
		(await one.post(`/users/${one.user.id}/avatar`, undefined, { form: form(atLimit, "image/png") })).status,
		200,
	);
	assert.equal(
		(await one.post(`/users/${two.user.id}/avatar`, undefined, { form: form(PNG, "image/png") })).status,
		403,
	);
	assert.equal((await one.delete(`/users/${two.user.id}/avatar`)).status, 403);
	assert.equal(await exists(`data/public/avatar/${two.user.id}.png`), false);
	assert.equal(
		(await api.client().post(`/users/${one.user.id}/avatar`, undefined, { form: form(PNG, "image/png") })).status,
		401,
	);
	assert.equal((await api.client().delete(`/users/${one.user.id}/avatar`)).status, 401);
	// an administrator sets the avatar of another user
	assert.equal(
		(await admin.post(`/users/${two.user.id}/avatar`, undefined, { form: form(PNG, "image/png") })).status,
		200,
	);
	assert.equal(await exists(`data/public/avatar/${two.user.id}.png`), true);
	const session = await newAdmin(api, admin);
	assert.equal((await session.post("/users/999999/avatar", undefined, { form: form(PNG, "image/png") })).status, 404);
});

it("removes the avatar: the file goes and the user falls back to the default picture", async () => {
	const account = await api.limited({ visibility: "user" });
	const { id } = account.user;
	await account.post(`/users/${id}/avatar`, undefined, { form: form(PNG, "image/png") });
	assert.equal(await exists(`data/public/avatar/${id}.png`), true);
	const removed = await account.delete("/users/me/avatar");
	assert.equal(removed.status, 200);
	assert.equal(removed.body.id, id);
	assert.equal(removed.body.avatar.startsWith("/images/avatar/"), false);
	assert.equal(await exists(`data/public/avatar/${id}.png`), false);
	assert.equal((await api.db("user").where({ id }).first()).avatar, removed.body.avatar);
});
