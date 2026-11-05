import assert from "node:assert/strict";
import { after, before, it, mock } from "node:test";
import { PASSWORD, startApi } from "./support/api.js";
import { newAdmin, setCookie } from "./support/auth.js";

const SESSION = "__Host-Http-token";
const NEW_PASSWORD = "a-brand-new-password-7";
const PASSWORD_CLEARED = /^__Host-Http-token=;/u;

let api;
let admin;

const loginStatus = async (email, secret) => (await api.client().post("/tokens", { identity: email, secret })).status;
const secretOf = async (userId) => (await api.db("auth").where({ user_id: userId, type: "password" }).first()).secret;

before(async () => {
	api = await startApi();
	admin = await api.admin();
	// a login in the second of a password change or a revocation would count as before it
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
});
after(() => {
	mock.timers.reset();
	return api?.stop();
});

it("changes the own password with the current one: the old password stops working, the new one works", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id, email } = user.user;
	const hashBefore = await secretOf(id);
	const elsewhere = api.client();
	assert.equal((await elsewhere.post("/tokens", { identity: email, secret: PASSWORD })).status, 200);

	const changed = await user.put("/users/me/auth", { type: "password", current: PASSWORD, secret: NEW_PASSWORD });
	assert.equal(changed.status, 200);
	assert.equal(changed.body, true);
	assert.notEqual(await secretOf(id), hashBefore);
	assert.equal((await secretOf(id)).includes(NEW_PASSWORD), false);
	// this session carries on with a new cookie, the other one is ended
	assert.ok(setCookie(changed, SESSION));
	assert.equal((await user.get("/users/me")).status, 200);
	assert.equal((await elsewhere.get("/users/me")).status, 401);

	mock.timers.tick(2000);
	assert.equal(await loginStatus(email, PASSWORD), 403);
	assert.equal(await loginStatus(email, NEW_PASSWORD), 200);
	const audit = await api.db("audit_log").where({ object_type: "user", object_id: id }).orderBy("id", "desc").first();
	assert.equal(JSON.parse(audit.meta).password_changed, true);
});

it("refuses the own password change without the current password (400) or with a wrong one (403)", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id, email } = user.user;
	const hashBefore = await secretOf(id);
	const missing = await user.put(`/users/${id}/auth`, { type: "password", secret: NEW_PASSWORD });
	assert.equal(missing.status, 400);
	const wrong = await user.put(`/users/${id}/auth`, {
		type: "password",
		current: "not-my-password-1",
		secret: NEW_PASSWORD,
	});
	assert.equal(wrong.status, 403);
	assert.equal(wrong.body.error.message, "Invalid email or password");
	assert.equal(await secretOf(id), hashBefore);
	assert.equal(await loginStatus(email, PASSWORD), 200);
	assert.equal(await loginStatus(email, NEW_PASSWORD), 403);
	assert.equal((await user.get("/users/me")).status, 200);
});

it("answers 400 for a password payload that does not match the schema", async () => {
	const user = await api.limited({ visibility: "user" });
	const base = `/users/${user.user.id}/auth`;
	const hashBefore = await secretOf(user.user.id);
	assert.equal((await user.put(base, { type: "password", current: PASSWORD, secret: "short" })).status, 400);
	assert.equal((await user.put(base, { type: "token", current: PASSWORD, secret: NEW_PASSWORD })).status, 400);
	assert.equal((await user.put(base, { type: "password", current: PASSWORD })).status, 400);
	assert.equal((await user.put(base, { current: PASSWORD, secret: NEW_PASSWORD })).status, 400);
	assert.equal(
		(await user.put(base, { type: "password", current: PASSWORD, secret: NEW_PASSWORD, extra: 1 })).status,
		400,
	);
	assert.equal(await secretOf(user.user.id), hashBefore);
});

it("lets an administrator set the password of another user without the current one, ending that user's sessions", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id, email } = user.user;
	assert.equal((await user.get("/users/me")).status, 200);
	const changed = await admin.put(`/users/${id}/auth`, { type: "password", secret: NEW_PASSWORD });
	assert.equal(changed.status, 200);
	assert.equal(setCookie(changed, SESSION), undefined);
	assert.equal((await user.get("/users/me")).status, 401);
	mock.timers.tick(2000);
	assert.equal(await loginStatus(email, PASSWORD), 403);
	assert.equal(await loginStatus(email, NEW_PASSWORD), 200);
	// the administrator keeps its own session
	assert.equal((await admin.get("/users/me")).status, 200);
});

it("refuses a password change for another user without the admin role, without a session, and for a user that is not there", async () => {
	const one = await api.limited({ visibility: "user" });
	const two = await api.limited({ visibility: "user" });
	const hashBefore = await secretOf(two.user.id);
	const refused = await one.put(`/users/${two.user.id}/auth`, { type: "password", secret: NEW_PASSWORD });
	assert.equal(refused.status, 403);
	assert.equal(
		(await api.client().put(`/users/${two.user.id}/auth`, { type: "password", secret: NEW_PASSWORD })).status,
		401,
	);
	assert.equal(await secretOf(two.user.id), hashBefore);
	const session = await newAdmin(api, admin);
	assert.equal((await session.put("/users/999999/auth", { type: "password", secret: NEW_PASSWORD })).status, 404);
});

it("revokes all sessions of the own user: the cookie is cleared, every session ends, a new login works", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id, email } = user.user;
	const elsewhere = api.client();
	await elsewhere.post("/tokens", { identity: email, secret: PASSWORD });
	assert.equal((await elsewhere.get("/users/me")).status, 200);
	const stamp = (await api.db("user").where({ id }).first()).npmpro_token_valid_after;

	const revoked = await user.delete("/users/me/sessions");
	assert.equal(revoked.status, 200);
	assert.equal(revoked.body, true);
	assert.match(setCookie(revoked, SESSION), PASSWORD_CLEARED);
	assert.ok((await api.db("user").where({ id }).first()).npmpro_token_valid_after > stamp);
	assert.equal((await user.get("/users/me")).status, 401);
	assert.equal((await elsewhere.get("/users/me")).status, 401);
	mock.timers.tick(2000);
	const again = api.client();
	assert.equal((await again.post("/tokens", { identity: email, secret: PASSWORD })).status, 200);
	assert.equal((await again.get("/users/me")).status, 200);
});

it("lets an administrator revoke the sessions of another user, and refuses everyone else", async () => {
	const victim = await api.limited({ visibility: "user" });
	const stranger = await api.limited({ visibility: "user" });
	assert.equal((await stranger.delete(`/users/${victim.user.id}/sessions`)).status, 403);
	assert.equal((await api.client().delete(`/users/${victim.user.id}/sessions`)).status, 401);
	assert.equal((await victim.get("/users/me")).status, 200);
	const revoked = await admin.delete(`/users/${victim.user.id}/sessions`);
	assert.equal(revoked.status, 200);
	assert.equal(setCookie(revoked, SESSION), undefined);
	assert.equal((await victim.get("/users/me")).status, 401);
	assert.equal((await admin.get("/users/me")).status, 200);
	const session = await newAdmin(api, admin);
	assert.equal((await session.delete("/users/999999/sessions")).status, 404);
});
