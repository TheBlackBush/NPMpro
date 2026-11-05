import assert from "node:assert/strict";
import { after, before, it, mock } from "node:test";
import { startApi } from "./support/api.js";
import { setCookie } from "./support/auth.js";

const SESSION = "__Host-Http-token";
const SIGNED = /^__Host-Http-token=s%3A/u;
const ROOT_PATH = /; Path=\/(;|$)/u;
const HTTP_ONLY = /; HttpOnly/u;
const SECURE = /; Secure/u;
const STRICT = /; SameSite=Strict/u;
const DOMAIN = /Domain=/u;
const CLEARED = /^__Host-Http-token=;.*Expires=Thu, 01 Jan 1970/u;
const PASSWORD = "correct-horse-battery-9";
const MINUTE = 60 * 1000;
const viewer = {
	visibility: "user",
	access_lists: "view",
	certificates: "view",
	dead_hosts: "hidden",
	proxy_hosts: "view",
	redirection_hosts: "hidden",
	streams: "hidden",
};

let api;
let admin;
let accounts = 0;

// every test works with an account of its own, so a revoked session or a disabled user never reaches another test
const account = async () => {
	accounts += 1;
	const email = `Token.User${accounts}@Example.com`;
	const created = await admin.post("/users", {
		name: `Token user ${accounts}`,
		email,
		roles: [],
		auth: { type: "password", secret: PASSWORD },
	});
	if (created.status !== 201) throw new Error(`creating a user answered ${created.status}`);
	return { id: created.body.id, email };
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
	// the clock is moved on by the tests: a refresh, a token that ran out and a login after a revocation need seconds
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
});
after(() => {
	mock.timers.reset();
	return api?.stop();
});

it("logs in with a signed, httpOnly, secure, strict session cookie and no token in the body", async () => {
	const { email } = await account();
	const session = api.client();
	const login = await session.post("/tokens", { identity: email, secret: PASSWORD });
	assert.equal(login.status, 200);
	assert.deepEqual(Object.keys(login.body), ["expires"]);
	assert.ok(new Date(login.body.expires).getTime() > Date.now());
	const cookie = setCookie(login, SESSION);
	assert.match(cookie, SIGNED);
	assert.match(cookie, ROOT_PATH);
	assert.match(cookie, HTTP_ONLY);
	assert.match(cookie, SECURE);
	assert.match(cookie, STRICT);
	assert.doesNotMatch(cookie, DOMAIN);
	assert.equal(setCookie(login, "__Host-Http-challenge_token"), undefined);
	assert.equal((await session.get("/users/me")).status, 200);
});

it("accepts the address in any letter case", async () => {
	const { email } = await account();
	const login = await api.client().post("/tokens", { identity: email.toUpperCase(), secret: PASSWORD });
	assert.equal(login.status, 200);
	assert.ok(setCookie(login, SESSION));
});

it("answers a wrong password and an unknown address with the same 403 and the same text", async () => {
	const { email } = await account();
	const wrong = await api.client().post("/tokens", { identity: email, secret: "not-the-password-1" });
	const unknown = await api
		.client()
		.post("/tokens", { identity: "nobody@example.com", secret: "not-the-password-1" });
	assert.equal(wrong.status, 403);
	assert.equal(unknown.status, 403);
	assert.deepEqual(wrong.body, unknown.body);
	assert.equal(wrong.body.error.message, "Invalid email or password");
	assert.equal(setCookie(wrong, SESSION), undefined);
	assert.equal(setCookie(unknown, SESSION), undefined);
});

it("answers 400 for a body that does not match the schema and sets no cookie", async () => {
	const bodies = [
		{ identity: "admin@example.com" },
		{ secret: PASSWORD },
		{ identity: "", secret: PASSWORD },
		{ identity: "admin@example.com", secret: PASSWORD, extra: true },
		{ identity: "admin@example.com", secret: PASSWORD, code: "12" },
	];
	for (const body of bodies) {
		const refused = await api.client().post("/tokens", body);
		assert.equal(refused.status, 400, JSON.stringify(body));
		assert.equal(refused.headers.getSetCookie().length, 0);
	}
});

it("refuses a disabled user like a wrong password and ends the sessions it had", async () => {
	const { id, email } = await account();
	const session = api.client();
	assert.equal((await session.post("/tokens", { identity: email, secret: PASSWORD })).status, 200);
	assert.equal((await session.get("/users/me")).status, 200);
	assert.equal((await admin.put(`/users/${id}`, { is_disabled: true })).status, 200);
	assert.equal((await api.db("user").where({ id }).first()).is_disabled, 1);
	const refused = await api.client().post("/tokens", { identity: email, secret: PASSWORD });
	assert.equal(refused.status, 403);
	assert.equal(refused.body.error.message, "Invalid email or password");
	assert.equal(setCookie(refused, SESSION), undefined);
	assert.equal((await session.get("/users/me")).status, 401);
});

it("limits the sixth failed login of an address and keeps it out even with the right password", async () => {
	const { email } = await account();
	const client = api.client();
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const refused = await client.post("/tokens", { identity: email, secret: "wrong-password-1" });
		assert.equal(refused.status, 403, `attempt ${attempt}`);
	}
	const limited = await client.post("/tokens", { identity: email, secret: "wrong-password-1" });
	assert.equal(limited.status, 429);
	assert.equal(limited.body.error.message, "Too many requests, please try again later.");
	const correct = await client.post("/tokens", { identity: email, secret: PASSWORD });
	assert.equal(correct.status, 429);
	assert.equal(setCookie(correct, SESSION), undefined);
	// another address is not affected
	assert.equal((await api.client().post("/tokens", { identity: email, secret: PASSWORD })).status, 200);
});

it("does not count successful logins against the limit", async () => {
	const { email } = await account();
	const client = api.client();
	for (let attempt = 1; attempt <= 7; attempt += 1) {
		assert.equal(
			(await client.post("/tokens", { identity: email, secret: PASSWORD })).status,
			200,
			`login ${attempt}`,
		);
	}
});

it("refreshes the session: a new cookie and a later expiry, and the old cookie keeps working until it runs out", async () => {
	const { email } = await account();
	const session = api.client();
	const login = await session.post("/tokens", { identity: email, secret: PASSWORD });
	const oldCookie = session.jar.get(SESSION);
	mock.timers.tick(5000);
	const refreshed = await session.get("/tokens");
	assert.equal(refreshed.status, 200);
	assert.deepEqual(Object.keys(refreshed.body), ["expires"]);
	assert.ok(new Date(refreshed.body.expires) > new Date(login.body.expires));
	const cookie = setCookie(refreshed, SESSION);
	assert.match(cookie, HTTP_ONLY);
	assert.match(cookie, SECURE);
	assert.match(cookie, STRICT);
	assert.notEqual(session.jar.get(SESSION), oldCookie);
	assert.equal((await session.get("/users/me")).status, 200);
	const old = api.client();
	old.jar.set(SESSION, oldCookie);
	assert.equal((await old.get("/users/me")).status, 200);
});

it("answers 401 without a session or with a cookie that is not signed by the backend", async () => {
	const anonymous = await api.client().get("/tokens");
	assert.equal(anonymous.status, 401);
	assert.equal(anonymous.body.error.message, "Invalid or expired token");
	const forged = api.client();
	forged.jar.set(SESSION, "s%3Anot-a-token.signature");
	assert.equal((await forged.get("/tokens")).status, 401);
	assert.equal((await forged.get("/users/me")).status, 401);
});

it("rejects a session after one hour", async () => {
	const { email } = await account();
	const session = api.client();
	await session.post("/tokens", { identity: email, secret: PASSWORD });
	const now = Date.now();
	try {
		mock.timers.tick(59 * MINUTE);
		assert.equal((await session.get("/users/me")).status, 200);
		mock.timers.tick(2 * MINUTE);
		const expired = await session.get("/users/me");
		assert.equal(expired.status, 401);
		assert.equal((await session.get("/tokens")).status, 401);
	} finally {
		mock.timers.setTime(now);
	}
});

it("logs out: the cookie is cleared, the old cookie stops working and the session is stored as revoked", async () => {
	const { email } = await account();
	const session = api.client();
	const other = api.client();
	await session.post("/tokens", { identity: email, secret: PASSWORD });
	await other.post("/tokens", { identity: email, secret: PASSWORD });
	const copy = session.jar.get(SESSION);
	const revokedBefore = (await api.db("session_revocation").count({ n: "*" }).first()).n;

	const logout = await session.delete("/tokens");
	assert.equal(logout.status, 200);
	assert.equal(logout.body.expires, "1970-01-01T00:00:00.000Z");
	assert.match(setCookie(logout, SESSION), CLEARED);
	assert.equal(session.jar.has(SESSION), false);
	assert.equal((await api.db("session_revocation").count({ n: "*" }).first()).n, Number(revokedBefore) + 1);

	const replay = api.client();
	replay.jar.set(SESSION, copy);
	assert.equal((await replay.get("/users/me")).status, 401);
	assert.equal((await replay.get("/tokens")).status, 401);
	// only that session ended
	assert.equal((await other.get("/users/me")).status, 200);
});

it("answers a logout without a session or with a broken cookie with 200", async () => {
	const none = await api.client().delete("/tokens");
	assert.equal(none.status, 200);
	assert.equal(none.body.expires, "1970-01-01T00:00:00.000Z");
	const broken = api.client();
	broken.jar.set(SESSION, "s%3Agarbage.garbage");
	assert.equal((await broken.delete("/tokens")).status, 200);
});

it("a valid session of a deleted user gets 401, not data", async () => {
	const user = await api.limited(viewer);
	assert.equal((await user.get("/nginx/proxy-hosts")).status, 200);
	assert.equal((await admin.delete(`/users/${user.user.id}`)).status, 200);
	const refused = await user.get("/nginx/proxy-hosts");
	assert.equal(refused.status, 401);
	assert.equal(refused.body.error.message, "Invalid or expired token");
	assert.equal((await user.get("/users/me")).status, 401);
	assert.equal(await api.db("user").where({ id: user.user.id }).first(), undefined);
});

it("a valid session of a disabled user gets 401, not data", async () => {
	const user = await api.limited(viewer);
	assert.equal((await user.get("/nginx/proxy-hosts")).status, 200);
	assert.equal((await admin.put(`/users/${user.user.id}`, { is_disabled: true })).status, 200);
	const refused = await user.get("/nginx/proxy-hosts");
	assert.equal(refused.status, 401);
	assert.equal(refused.body.error.message, "Invalid or expired token");
});

it("a valid session gets 401 after its sessions were revoked, and a new login works", async () => {
	const user = await api.limited(viewer);
	assert.equal((await user.get("/nginx/proxy-hosts")).status, 200);
	assert.equal((await admin.delete(`/users/${user.user.id}/sessions`)).status, 200);
	const refused = await user.get("/nginx/proxy-hosts");
	assert.equal(refused.status, 401);
	assert.equal(refused.body.error.message, "Invalid or expired token");
	// tokens carry whole seconds: a login in the second of the revocation would be revoked too
	mock.timers.tick(2000);
	const again = api.client();
	assert.equal((await again.post("/tokens", { identity: user.user.email, secret: PASSWORD })).status, 200);
	assert.equal((await again.get("/nginx/proxy-hosts")).status, 200);
});

it("a session cookie with a broken signature gets 401", async () => {
	const { email } = await account();
	const session = api.client();
	await session.post("/tokens", { identity: email, secret: PASSWORD });
	const cookie = session.jar.get(SESSION);
	// a changed character breaks the signature
	const tampered = api.client();
	tampered.jar.set(SESSION, `${cookie.slice(0, -2)}${cookie.endsWith("AA") ? "BB" : "AA"}`);
	assert.equal((await tampered.get("/users/me")).status, 401);
});
