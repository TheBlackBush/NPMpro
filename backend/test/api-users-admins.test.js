import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { PASSWORD, startApi } from "./support/api.js";

let api;
let first;

const administrators = async () =>
	(await api.db("user").select("id", "roles"))
		.filter((row) => JSON.parse(row.roles).includes("admin"))
		.map((row) => row.id);

// one administrator logs in again with a fresh client, so the refusals of one test do not limit another
const login = async (email) => {
	const session = api.client();
	const answer = await session.post("/tokens", { identity: email, secret: PASSWORD });
	if (answer.status !== 200) throw new Error(`login answered ${answer.status}`);
	return session;
};

before(async () => {
	api = await startApi();
	first = await api.admin();
});
after(() => api?.stop());

it("keeps the only administrator: it cannot delete, demote or disable itself, and the system keeps one", async () => {
	const me = await (await login("admin@example.com")).get("/users/me");
	const id = me.body.id;
	const session = await login("admin@example.com");
	const deleted = await session.delete(`/users/${id}`);
	assert.equal(deleted.status, 403);
	assert.equal(deleted.body.error.message, "You cannot delete yourself.");
	const other = await login("admin@example.com");
	assert.equal((await other.put(`/users/${id}`, { roles: [] })).status, 403);
	const third = await login("admin@example.com");
	assert.equal((await third.put(`/users/${id}`, { is_disabled: true })).status, 403);
	const fourth = await login("admin@example.com");
	assert.equal((await fourth.put("/users/me", { roles: [] })).status, 403);
	assert.deepEqual(await administrators(), [id]);
	assert.equal((await api.db("user").where({ id }).first()).is_disabled, 0);
	assert.equal((await first.get("/users/me")).status, 200);
});

it("lets an administrator remove another one, and the remaining one is the last", async () => {
	const created = await first.post("/users", {
		name: "Second",
		email: "second.admin@example.com",
		roles: ["admin"],
		auth: { type: "password", secret: PASSWORD },
	});
	assert.equal(created.status, 201);
	assert.equal((await administrators()).length, 2);
	const second = await login("second.admin@example.com");
	assert.equal((await first.delete(`/users/${created.body.id}`)).status, 200);
	assert.equal((await second.get("/users/me")).status, 401);
	assert.equal((await administrators()).length, 1);
	const again = await login("admin@example.com");
	assert.equal((await again.delete("/users/me")).status, 403);
	assert.equal((await administrators()).length, 1);
});

it("lets an administrator demote another one, which then cannot use the admin endpoints", async () => {
	const created = await first.post("/users", {
		name: "Third",
		email: "third.admin@example.com",
		roles: ["admin"],
		auth: { type: "password", secret: PASSWORD },
	});
	const third = await login("third.admin@example.com");
	assert.equal((await third.get("/users")).status, 200);
	assert.equal((await first.put(`/users/${created.body.id}`, { roles: [] })).status, 200);
	assert.equal((await third.get("/users")).status, 403);
	assert.deepEqual(await administrators(), [1]);
});
