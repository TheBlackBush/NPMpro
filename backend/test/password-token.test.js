import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, it, mock } from "node:test";
import { PASSWORD, startApi } from "./support/api.js";

const MINUTE = 60_000;
const REJECTED = /password rejected/u;
const BASE64URL = /^[A-Za-z0-9_-]{43}$/u;
let api;
const ctx = {};
let tokens;
let userId;

const rows = () => api.db("npmpro_password_token").select();
const hashOf = (token) => createHash("sha256").update(token).digest("hex");

before(async () => {
	api = await startApi();
	tokens = (await import("../internal/password-token.js")).default;
	const admin = await api.admin();
	const created = await admin.post("/users", {
		name: "Reset User",
		email: "reset@example.com",
		roles: [],
		auth: { type: "password", secret: PASSWORD },
	});
	if (created.status !== 201) throw new Error(`creating the user answered ${created.status}: ${created.text}`);
	userId = created.body.id;
	ctx.admin = admin;
});
beforeEach(async () => {
	mock.timers.reset();
	await api.db("npmpro_password_token").delete();
	await api.db("user").where({ id: userId }).update({ is_disabled: 0 });
});
after(() => {
	mock.timers.reset();
	return api?.stop();
});

it("creates a 43 character base64url token and stores only its SHA-256, the lifetime and the address", async () => {
	const token = await tokens.create(userId, "reset", { ip: "203.0.113.7" });
	assert.match(token, BASE64URL);
	const [row] = await rows();
	assert.equal(row.token_hash, hashOf(token));
	assert.equal(row.purpose, "reset");
	assert.equal(row.requested_ip, "203.0.113.7");
	assert.equal(row.used_on, null);
	assert.ok(!JSON.stringify(row).includes(token));
	const lifetime = Date.parse(row.expires_on.replace(" ", "T")) - Date.parse(row.created_on.replace(" ", "T"));
	assert.equal(lifetime, 30 * MINUTE);
	assert.notEqual(await tokens.create(userId, "reset"), token);
});

it("takes the lifetime of a caller, and refuses an unknown purpose or no lifetime", async () => {
	await tokens.create(userId, "invite", { lifetimeMs: 72 * 60 * MINUTE });
	const [row] = await rows();
	const lifetime = Date.parse(row.expires_on.replace(" ", "T")) - Date.parse(row.created_on.replace(" ", "T"));
	assert.equal(lifetime, 72 * 60 * MINUTE);
	await assert.rejects(tokens.create(userId, "other"));
	await assert.rejects(tokens.create(userId, "invite"));
});

it("finds the token within 30 minutes and not after", async () => {
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
	const token = await tokens.create(userId, "reset");
	mock.timers.tick(29 * MINUTE);
	const found = await tokens.find(token);
	assert.equal(found.user.id, userId);
	assert.equal(found.row.purpose, "reset");
	mock.timers.tick(MINUTE + 1000);
	assert.equal(await tokens.find(token), null);
});

it("finds nothing for text that is not a token, an unknown token or another purpose", async () => {
	const token = await tokens.create(userId, "reset");
	for (const bad of [undefined, null, 5, "", "abc", `${token}x`, "A".repeat(43), { toString: () => token }])
		assert.equal(await tokens.find(bad), null);
	assert.ok(await tokens.find(token, "reset"));
	assert.equal(await tokens.find(token, "invite"), null);
});

it("consumes once: the second consume finds nothing and fn does not run again", async () => {
	const token = await tokens.create(userId, "reset");
	const seen = [];
	const first = await tokens.consume(token, (user, row) => {
		seen.push([user.id, row.purpose]);
		return "done";
	});
	assert.equal(first, "done");
	assert.deepEqual(seen, [[userId, "reset"]]);
	assert.equal(await tokens.consume(token, () => seen.push("again")), null);
	assert.equal(await tokens.find(token), null);
	assert.equal(seen.length, 1);
	assert.notEqual((await rows())[0].used_on, null);
});

it("two consumes at once run fn once", async () => {
	const token = await tokens.create(userId, "reset");
	let runs = 0;
	const results = await Promise.allSettled([
		tokens.consume(token, () => {
			runs += 1;
			return "ok";
		}),
		tokens.consume(token, () => {
			runs += 1;
			return "ok";
		}),
	]);
	assert.equal(runs, 1);
	assert.equal(results.filter((r) => r.status === "fulfilled" && r.value === "ok").length, 1);
});

it("rolls the use back when fn fails, so the link still works", async () => {
	const token = await tokens.create(userId, "reset");
	await assert.rejects(
		tokens.consume(token, () => {
			throw new Error("password rejected");
		}),
		REJECTED,
	);
	assert.ok(await tokens.find(token));
});

it("a new request removes the older token of that purpose, and leaves the other purpose", async () => {
	const first = await tokens.create(userId, "reset");
	const invite = await tokens.create(userId, "invite", { lifetimeMs: MINUTE });
	const second = await tokens.create(userId, "reset");
	assert.equal(await tokens.find(first), null);
	assert.ok(await tokens.find(second));
	assert.ok(await tokens.find(invite));
	assert.equal((await rows()).length, 2);
});

it("a disabled user has no token that finds", async () => {
	const token = await tokens.create(userId, "reset");
	await api.db("user").where({ id: userId }).update({ is_disabled: 1 });
	assert.equal(await tokens.find(token), null);
	assert.equal(await tokens.consume(token, () => "x"), null);
	await api.db("user").where({ id: userId }).update({ is_disabled: 0 });
	assert.ok(await tokens.find(token));
});

it("a password change of the user removes the tokens", async () => {
	const token = await tokens.create(userId, "reset");
	const invite = await tokens.create(userId, "invite", { lifetimeMs: 10 * MINUTE });
	const set = await ctx.admin.put(`/users/${userId}/auth`, { type: "password", secret: "another-password-77" });
	assert.equal(set.status, 200, set.text);
	assert.equal(await tokens.find(token), null);
	assert.equal(await tokens.find(invite), null);
	assert.equal((await rows()).length, 0);
});

it("deleting the user removes the tokens", async () => {
	const created = await ctx.admin.post("/users", {
		name: "Gone",
		email: "gone@example.com",
		roles: [],
		auth: { type: "password", secret: PASSWORD },
	});
	assert.equal(created.status, 201, created.text);
	await tokens.create(created.body.id, "reset");
	await tokens.create(userId, "reset");
	const deleted = await ctx.admin.delete(`/users/${created.body.id}`);
	assert.equal(deleted.status, 200, deleted.text);
	const left = await rows();
	assert.deepEqual(
		left.map((row) => row.user_id),
		[userId],
	);
});

it("the sweep removes used and expired tokens and keeps live ones", async () => {
	const other = await ctx.admin.post("/users", {
		name: "Other",
		email: "other@example.com",
		roles: [],
		auth: { type: "password", secret: PASSWORD },
	});
	const used = await tokens.create(userId, "reset");
	await tokens.consume(used, () => null);
	const expired = await tokens.create(userId, "invite", { lifetimeMs: MINUTE });
	const live = await tokens.create(other.body.id, "reset");
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
	mock.timers.tick(2 * MINUTE);
	await tokens.sweep();
	mock.timers.reset();
	assert.equal(await tokens.find(used), null);
	assert.equal(await tokens.find(expired), null);
	assert.ok(await tokens.find(live));
	assert.deepEqual(
		(await rows()).map((row) => row.token_hash),
		[hashOf(live)],
	);
});
