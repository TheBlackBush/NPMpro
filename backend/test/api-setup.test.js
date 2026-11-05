import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { PASSWORD, startApi } from "./support/api.js";

const first = { name: "First", email: "First.Admin@Example.com", auth: { type: "password", secret: PASSWORD } };

let api;

before(async () => {
	api = await startApi();
});
after(() => api?.stop());

// the tests run in order: the first user is made by the "first user" test, the others rely on that state
it("says setup is open while no user exists, and no login works", async () => {
	assert.equal((await api.client().get("")).body.setup, false);
	assert.equal((await api.db("user").count({ n: "*" }).first()).n, 0);
	const refused = await api.client().post("/tokens", { identity: first.email, secret: PASSWORD });
	assert.equal(refused.status, 403);
});

it("answers 400 for a payload that does not match the schema and creates nothing", async () => {
	const bodies = [
		{ email: first.email, auth: first.auth },
		{ name: "First", auth: first.auth },
		{ name: "First", email: first.email },
		{ name: "First", email: "no-at-sign", auth: first.auth },
		{ name: "First", email: first.email, auth: { type: "password", secret: "short" } },
		{ name: "First", email: first.email, auth: { type: "token", secret: PASSWORD } },
		{ name: "First", email: first.email, auth: first.auth, roles: [] },
		{ name: "First", email: first.email, auth: first.auth, is_disabled: true },
	];
	for (const body of bodies) {
		const refused = await api.client().post("/users/setup", body);
		assert.equal(refused.status, 400, JSON.stringify(body));
	}
	assert.equal((await api.db("user").count({ n: "*" }).first()).n, 0);
	assert.equal((await api.client().get("")).body.setup, false);
});

it("makes the first user an administrator, with all visibility and a hashed password", async () => {
	// two requests at once: one wins, the other is refused, so there is never a second administrator
	const rival = { name: "Rival", email: "rival@example.com", auth: first.auth };
	const [one, two] = await Promise.all([
		api.client().post("/users/setup", first),
		api.client().post("/users/setup", rival),
	]);
	assert.deepEqual([one.status, two.status], [201, 403]);
	const created = one;
	assert.equal((await api.db("user").count({ n: "*" }).first()).n, 1);
	assert.deepEqual(created.body.roles, ["admin"]);
	assert.equal(created.body.email, "first.admin@example.com");
	assert.equal(created.body.is_disabled, false);
	const row = await api.db("user").where({ id: created.body.id }).first();
	assert.equal(row.email, "first.admin@example.com");
	assert.deepEqual(JSON.parse(row.roles), ["admin"]);
	const permissions = await api.db("user_permission").where({ user_id: created.body.id }).first();
	assert.equal(permissions.visibility, "all");
	const auth = await api.db("auth").where({ user_id: created.body.id }).first();
	assert.equal(auth.type, "password");
	assert.notEqual(auth.secret, PASSWORD);
	assert.equal(auth.secret.includes(PASSWORD), false);
	assert.equal((await api.client().get("")).body.setup, true);
	const login = await api.client().post("/tokens", { identity: first.email, secret: PASSWORD });
	assert.equal(login.status, 200);
});

it("refuses a second setup with 403 and creates no user, whatever the payload", async () => {
	const second = { name: "Second", email: "second@example.com", auth: first.auth };
	const refused = await api.client().post("/users/setup", second);
	assert.equal(refused.status, 403);
	assert.equal((await api.db("user").count({ n: "*" }).first()).n, 1);
	assert.equal(await api.db("user").where({ email: "second@example.com" }).first(), undefined);
	// the same address is refused before it is checked as taken
	const same = await api.client().post("/users/setup", first);
	assert.equal(same.status, 403);
	// the payload is not looked at once the setup is closed
	assert.equal((await api.client().post("/users/setup", {})).status, 403);
});
