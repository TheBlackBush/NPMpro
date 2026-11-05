import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { newAdmin } from "./support/auth.js";

// The contract (schema/paths/users/userID): the user in the path is "me" or an integer of at least 1. Every case here
// runs as an administrator of its own, so what goes wrong stays with that account.

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const withAdmin = async (call) => {
	const session = await newAdmin(api, admin);
	const row = await api.db("user").where({ id: session.user.id }).first();
	const response = await call(session);
	return { session, before: row, response };
};

it("answers GET with a user id below 1 or that is no integer with 400", async () => {
	const session = await newAdmin(api, admin);
	assert.equal((await session.get("/users/0")).status, 400);
	assert.equal((await session.get("/users/-3")).status, 400);
	assert.equal((await session.get("/users/abc")).status, 400);
});

it("answers GET with a fractional user id with 400", { todo: "BUG-4" }, async () => {
	const session = await newAdmin(api, admin);
	assert.equal((await session.get("/users/1.5")).status, 400);
});

it("answers PUT /users/abc with 400", { todo: "BUG-2" }, async () => {
	const { response } = await withAdmin((session) => session.put("/users/abc", { name: "Renamed" }));
	assert.equal(response.status, 400);
});

it("answers PUT /users/0 with 400 and does not give an account the id 0", { todo: "BUG-1" }, async () => {
	const { session, response } = await withAdmin((s) => s.put("/users/0", { name: "Renamed" }));
	assert.equal(response.status, 400);
	assert.equal(await api.db("user").where({ id: 0 }).first(), undefined);
	assert.equal((await session.get("/users/me")).status, 200);
});

it("refuses PUT /users/0 with roles for the own account, like the same call with the own id", {
	todo: "BUG-1",
}, async () => {
	const { session, response } = await withAdmin((s) => s.put("/users/0", { roles: [] }));
	assert.equal(response.status, 400);
	assert.deepEqual(JSON.parse((await api.db("user").where({ id: session.user.id }).first())?.roles ?? "[]"), [
		"admin",
	]);
});

it("answers PUT with a negative user id with 400", { todo: "BUG-3" }, async () => {
	const { response } = await withAdmin((session) => session.put("/users/-3", { name: "Renamed" }));
	assert.equal(response.status, 400);
});

it("answers PUT /users/0/permissions with 400 and leaves the own permissions alone", { todo: "BUG-3" }, async () => {
	const {
		session,
		before: row,
		response,
	} = await withAdmin((s) => s.put("/users/0/permissions", { visibility: "user" }));
	assert.equal(response.status, 400);
	assert.equal((await api.db("user_permission").where({ user_id: row.id }).first()).visibility, "all");
	assert.equal((await session.get("/users/me")).status, 200);
});

it("answers DELETE /users/0 and DELETE /users/abc with 400", { todo: "BUG-3" }, async () => {
	const zero = await withAdmin((session) => session.delete("/users/0"));
	assert.equal(zero.response.status, 400);
	const text = await withAdmin((session) => session.delete("/users/abc"));
	assert.equal(text.response.status, 400);
});

it("answers DELETE /users/0/sessions with 400 and keeps the own session", { todo: "BUG-3" }, async () => {
	const { session, response } = await withAdmin((s) => s.delete("/users/0/sessions"));
	assert.equal(response.status, 400);
	assert.equal((await session.get("/users/me")).status, 200);
});

it("answers PUT /users/0/auth, GET /users/0/mfa and DELETE /users/0/avatar with 400", { todo: "BUG-3" }, async () => {
	const auth = await withAdmin((session) =>
		session.put("/users/0/auth", { type: "password", secret: "another-secret-1", current: "x" }),
	);
	assert.equal(auth.response.status, 400);
	const mfa = await withAdmin((session) => session.get("/users/0/mfa"));
	assert.equal(mfa.response.status, 400);
	const avatar = await withAdmin((session) => session.delete("/users/0/avatar"));
	assert.equal(avatar.response.status, 400);
});
