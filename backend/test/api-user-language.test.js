import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { newAdmin } from "./support/auth.js";

let api;
// /users/<id>/language is no route: the router answers 404
const STATUS_OTHER_ID = 404;

before(async () => {
	api = await startApi();
});
after(() => api?.stop());

const languageOf = async (id) => (await api.db("user").where({ id }).first()).npmpro_language;

it("stores a valid code, shows it in /users/me and writes no audit row", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id } = user.user;
	assert.equal((await user.get("/users/me")).body.npmpro_language, null);
	const rowsBefore = await api.db("audit_log").count({ n: "id" }).first();
	const put = await user.put("/users/me/language", { language: "de" });
	assert.equal(put.status, 204);
	assert.equal(await languageOf(id), "de");
	assert.equal((await user.get("/users/me")).body.npmpro_language, "de");
	assert.equal((await user.put("/users/me/language", { language: "uk" })).status, 204);
	assert.equal(await languageOf(id), "uk");
	const rowsAfter = await api.db("audit_log").count({ n: "id" }).first();
	assert.equal(Number(rowsAfter.n), Number(rowsBefore.n));
});

it("refuses an unknown code, a missing one and extra fields with 400, and stores nothing", async () => {
	const user = await api.limited({ visibility: "user" });
	for (const body of [{ language: "xx" }, { language: "" }, { language: "DE" }, {}, { language: "de", extra: 1 }]) {
		assert.equal((await user.put("/users/me/language", body)).status, 400, JSON.stringify(body));
	}
	assert.equal(await languageOf(user.user.id), null);
});

it("reaches only the own user: another id is no route, nobody else changes", async () => {
	const user = await api.limited({ visibility: "user" });
	const other = await api.limited({ visibility: "user" });
	const response = await user.put(`/users/${other.user.id}/language`, { language: "fr" });
	assert.equal(response.status, STATUS_OTHER_ID);
	assert.equal(await languageOf(other.user.id), null);
});

it("needs a session: no sign-in is 401 and an API token is refused with 403", async () => {
	assert.equal((await api.client().put("/users/me/language", { language: "de" })).status, 401);
	const user = await newAdmin(api, await api.admin());
	const made = await user.post("/users/me/api-tokens", {
		name: "language",
		permissions: Object.fromEntries(
			["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"].map((s) => [
				s,
				"view",
			]),
		),
	});
	assert.equal(made.status, 201, made.text);
	const refused = await api
		.client()
		.put("/users/me/language", { language: "de" }, { headers: { authorization: `Bearer ${made.body.token}` } });
	assert.equal(refused.status, 403);
	assert.equal(await languageOf(user.user.id), null);
});
