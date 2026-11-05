import assert from "node:assert/strict";
import { after, before, it, mock } from "node:test";
import { generate } from "otplib";
import { PASSWORD, startApi } from "./support/api.js";
import { newAdmin, setCookie } from "./support/auth.js";

const SESSION = "__Host-Http-token";
const CHALLENGE = "__Host-Http-challenge_token";
const HTTP_ONLY = /; HttpOnly/u;
const SECURE = /; Secure/u;
const STRICT = /; SameSite=Strict/u;
const CLEARED = /^__Host-Http-challenge_token=;.*Expires=Thu, 01 Jan 1970/u;
const BACKUP_CODE = /^[0-9A-Z]{8}$/u;
const SIGNED = /^__Host-Http-challenge_token=s%3A/u;
const OTPAUTH = /^otpauth:\/\/totp\//u;

let api;
let admin;

// the codes change every 30 seconds and one code works once: every use moves the clock to the next period
const nextPeriod = () => mock.timers.tick(31_000);
const codeOf = (secret) => generate({ secret });
const wrong = (code) => `${code[0] === "0" ? "1" : "0"}${code.slice(1)}`;
const must = (response, status = 200) => {
	if (response.status !== status) throw new Error(`answered ${response.status}: ${response.text}`);
	return response;
};
const auths = (userId, type) => api.db("auth").where({ user_id: userId, type });

const enroll = async () => {
	const user = await api.limited({ visibility: "user" });
	const setup = await user.post(`/users/${user.user.id}/mfa/totp`);
	assert.equal(setup.status, 200);
	nextPeriod();
	const enabled = await user.post(`/users/${user.user.id}/mfa/totp/enable`, {
		code: await codeOf(setup.body.secret),
	});
	assert.equal(enabled.status, 200);
	return {
		user,
		id: user.user.id,
		email: user.user.email,
		secret: setup.body.secret,
		codes: enabled.body.backup_codes,
	};
};

// a login of an enrolled user: the challenge, then the code
const loginWith = async ({ email }, code) => {
	const client = api.client();
	const challenge = await client.post("/tokens", { identity: email, secret: PASSWORD });
	must(challenge);
	const result = await client.post("/tokens/totp", { code });
	return { client, challenge, result };
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

it("starts the setup: a secret and an otpauth URL for the account, the secret stored sealed and pending", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id, email } = user.user;
	const setup = await user.post(`/users/${id}/mfa/totp`);
	assert.equal(setup.status, 200);
	assert.deepEqual(Object.keys(setup.body).sort(), ["otpauth_url", "secret"]);
	assert.match(setup.body.otpauth_url, OTPAUTH);
	assert.ok(setup.body.otpauth_url.includes(`secret=${setup.body.secret}`));
	assert.ok(decodeURIComponent(setup.body.otpauth_url).includes(email));
	assert.ok(setup.body.otpauth_url.includes("issuer=NPMpro"));
	const pending = await auths(id, "totp_pending");
	assert.equal(pending.length, 1);
	assert.notEqual(pending[0].secret, setup.body.secret);
	assert.ok(pending[0].secret.startsWith("v1:"));
	assert.deepEqual((await user.get(`/users/${id}/mfa`)).body, { totp_enabled: false, backup_codes_remaining: 0 });
	// starting again replaces the pending secret
	const again = await user.post(`/users/${id}/mfa/totp`);
	assert.notEqual(again.body.secret, setup.body.secret);
	assert.equal((await auths(id, "totp_pending")).length, 1);
	assert.equal((await auths(id, "totp")).length, 0);
});

it("answers 400 for a code that does not match the schema and for an enable without a setup", async () => {
	const user = await api.limited({ visibility: "user" });
	const base = `/users/${user.user.id}/mfa`;
	assert.equal((await user.post(`${base}/totp/enable`, { code: "123456" })).status, 400);
	assert.equal((await user.post(`${base}/totp/enable`, { code: "12" })).status, 400);
	assert.equal((await user.post(`${base}/totp/enable`, { code: "123456789" })).status, 400);
	assert.equal((await user.post(`${base}/totp/enable`, { code: "123456", extra: 1 })).status, 400);
	assert.equal((await auths(user.user.id, "totp")).length, 0);
});

it("refuses a wrong code and a setup that ran out, enables with the right code and returns backup codes once", async () => {
	const user = await api.limited({ visibility: "user" });
	const { id } = user.user;
	const earlier = api.client();
	assert.equal((await earlier.post("/tokens", { identity: user.user.email, secret: PASSWORD })).status, 200);
	const setup = await user.post(`/users/${id}/mfa/totp`);
	nextPeriod();
	const good = await codeOf(setup.body.secret);

	const refused = await user.post(`/users/${id}/mfa/totp/enable`, { code: wrong(good) });
	assert.equal(refused.status, 400);
	assert.equal((await auths(id, "totp")).length, 0);
	assert.equal((await auths(id, "totp_pending")).length, 1);

	// a setup that was not confirmed within 10 minutes starts again
	await api.db("auth").where({ user_id: id, type: "totp_pending" }).update({ created_on: "2020-01-01 00:00:00" });
	const expired = await user.post(`/users/${id}/mfa/totp/enable`, { code: good });
	assert.equal(expired.status, 400);
	assert.equal((await auths(id, "totp")).length, 0);
	await api
		.db("auth")
		.where({ user_id: id, type: "totp_pending" })
		.update({ created_on: api.db.raw("datetime('now','localtime')") });

	const enabled = await user.post(`/users/${id}/mfa/totp/enable`, { code: good });
	assert.equal(enabled.status, 200);
	assert.equal(enabled.body.backup_codes.length, 8);
	for (const code of enabled.body.backup_codes) assert.match(code, BACKUP_CODE);
	assert.equal((await auths(id, "totp")).length, 1);
	assert.equal((await auths(id, "totp_pending")).length, 0);
	const stored = await auths(id, "backup_code");
	assert.equal(stored.length, 8);
	for (const row of stored) assert.equal(enabled.body.backup_codes.includes(row.secret), false);
	assert.deepEqual((await user.get(`/users/${id}/mfa`)).body, { totp_enabled: true, backup_codes_remaining: 8 });
	// the session that enabled it goes on, a session from before it does not
	assert.equal((await user.get("/users/me")).status, 200);
	assert.equal((await earlier.get("/users/me")).status, 401);
	// a second setup and a second enable are refused
	assert.equal((await user.post(`/users/${id}/mfa/totp`)).status, 400);
	assert.equal((await user.post(`/users/${id}/mfa/totp/enable`, { code: good })).status, 400);
});

it("gives a challenge cookie instead of a session when the account has TOTP", async () => {
	const { email, secret } = await enroll();
	nextPeriod();
	const client = api.client();
	const login = await client.post("/tokens", { identity: email, secret: PASSWORD });
	assert.equal(login.status, 200);
	assert.deepEqual(Object.keys(login.body).sort(), ["expires", "requiresTotp"]);
	assert.equal(login.body.requiresTotp, true);
	const cookie = setCookie(login, CHALLENGE);
	assert.match(cookie, SIGNED);
	assert.match(cookie, HTTP_ONLY);
	assert.match(cookie, SECURE);
	assert.match(cookie, STRICT);
	assert.equal(setCookie(login, SESSION), undefined);
	assert.equal((await client.get("/users/me")).status, 401);
	// the challenge is no session, not even in the session cookie
	const disguised = api.client();
	disguised.jar.set(SESSION, client.jar.get(CHALLENGE));
	assert.equal((await disguised.get("/users/me")).status, 401);
	assert.equal((await client.post("/tokens/totp", { code: await codeOf(secret) })).status, 200);
});

it("turns the challenge into a session with a right code, and only once", async () => {
	const account = await enroll();
	nextPeriod();
	const code = await codeOf(account.secret);
	const client = api.client();
	await client.post("/tokens", { identity: account.email, secret: PASSWORD });
	const challenge = client.jar.get(CHALLENGE);
	const result = await client.post("/tokens/totp", { code });
	assert.equal(result.status, 200);
	assert.deepEqual(Object.keys(result.body), ["expires"]);
	assert.match(setCookie(result, SESSION), HTTP_ONLY);
	assert.match(setCookie(result, CHALLENGE), CLEARED);
	assert.equal(client.jar.has(CHALLENGE), false);
	assert.equal((await client.get("/users/me")).status, 200);

	// the same code again, with a new challenge: refused
	const replay = await loginWith(account, code);
	assert.equal(replay.result.status, 403);
	assert.equal(replay.result.body.error.message, "Invalid verification code");
	assert.equal(setCookie(replay.result, SESSION), undefined);

	// the used challenge: refused even with a fresh code
	nextPeriod();
	const used = api.client();
	used.jar.set(CHALLENGE, challenge);
	const stale = await used.post("/tokens/totp", { code: await codeOf(account.secret) });
	assert.equal(stale.status, 401);
	assert.equal(setCookie(stale, SESSION), undefined);
});

it("refuses a wrong code with 403, lets the challenge be tried again, and 400 for a malformed code", async () => {
	const account = await enroll();
	nextPeriod();
	const good = await codeOf(account.secret);
	const client = api.client();
	await client.post("/tokens", { identity: account.email, secret: PASSWORD });
	const refused = await client.post("/tokens/totp", { code: wrong(good) });
	assert.equal(refused.status, 403);
	assert.equal(refused.body.error.message, "Invalid verification code");
	assert.equal(setCookie(refused, SESSION), undefined);
	assert.equal((await client.post("/tokens/totp", { code: "12" })).status, 400);
	assert.equal((await client.post("/tokens/totp", {})).status, 400);
	assert.equal((await client.post("/tokens/totp", { code: good })).status, 200);
});

it("refuses the code step without a challenge cookie and with a cookie that is not a challenge", async () => {
	const account = await enroll();
	nextPeriod();
	const code = await codeOf(account.secret);
	const none = await api.client().post("/tokens/totp", { code });
	assert.equal(none.status, 401);
	const session = api.client();
	session.jar.set(CHALLENGE, account.user.jar.get(SESSION));
	assert.equal((await session.post("/tokens/totp", { code })).status, 401);
});

it("takes a code in the login request itself", async () => {
	const account = await enroll();
	nextPeriod();
	const client = api.client();
	const login = await client.post("/tokens", {
		identity: account.email,
		secret: PASSWORD,
		code: await codeOf(account.secret),
	});
	assert.equal(login.status, 200);
	assert.deepEqual(Object.keys(login.body), ["expires"]);
	assert.ok(setCookie(login, SESSION));
	assert.equal((await client.get("/users/me")).status, 200);
	const refused = await api.client().post("/tokens", { identity: account.email, secret: PASSWORD, code: "000000" });
	assert.equal(refused.status, 403);
});

it("lets a backup code log in once", async () => {
	const account = await enroll();
	const [first, second] = account.codes;
	nextPeriod();
	const used = await loginWith(account, first);
	assert.equal(used.result.status, 200);
	assert.equal((await used.client.get("/users/me")).status, 200);
	assert.deepEqual((await used.client.get(`/users/${account.id}/mfa`)).body, {
		totp_enabled: true,
		backup_codes_remaining: 7,
	});
	assert.equal((await auths(account.id, "backup_code")).length, 7);

	const again = await loginWith(account, first);
	assert.equal(again.result.status, 403);
	assert.equal(setCookie(again.result, SESSION), undefined);
	assert.equal((await auths(account.id, "backup_code")).length, 7);

	// another one still works, in the login request itself
	const direct = api.client();
	const login = await direct.post("/tokens", { identity: account.email, secret: PASSWORD, code: second });
	assert.equal(login.status, 200);
	assert.ok(setCookie(login, SESSION));
	assert.equal((await auths(account.id, "backup_code")).length, 6);
});

it("regenerates the backup codes with a right code: the old ones stop working and old sessions end", async () => {
	const account = await enroll();
	const { user, id } = account;
	const oldCookie = user.jar.get(SESSION);
	nextPeriod();
	const base = `/users/${id}/mfa/backup-codes`;
	assert.equal((await user.post(base, { code: wrong(await codeOf(account.secret)) })).status, 400);
	// a backup code does not prove the second factor here
	assert.equal((await user.post(base, { code: account.codes[0] })).status, 400);
	assert.deepEqual((await user.get(`/users/${id}/mfa`)).body.backup_codes_remaining, 8);

	const regenerated = await user.post(base, { code: await codeOf(account.secret) });
	assert.equal(regenerated.status, 200);
	assert.deepEqual(Object.keys(regenerated.body), ["backup_codes"]);
	assert.equal(regenerated.body.backup_codes.length, 8);
	assert.equal(regenerated.body.backup_codes.filter((code) => account.codes.includes(code)).length, 0);
	assert.equal((await auths(id, "backup_code")).length, 8);
	assert.ok(setCookie(regenerated, SESSION));
	assert.equal((await user.get("/users/me")).status, 200);
	const stale = api.client();
	stale.jar.set(SESSION, oldCookie);
	assert.equal((await stale.get("/users/me")).status, 401);

	nextPeriod();
	const old = await loginWith(account, account.codes[0]);
	assert.equal(old.result.status, 403);
	const fresh = await loginWith(account, regenerated.body.backup_codes[0]);
	assert.equal(fresh.result.status, 200);
});

it("disables TOTP with a right code and removes the backup codes, then the login needs no code", async () => {
	const account = await enroll();
	const { user, id } = account;
	const base = `/users/${id}/mfa/totp/disable`;
	nextPeriod();
	assert.equal((await user.post(base, { code: wrong(await codeOf(account.secret)) })).status, 400);
	assert.equal((await user.post(base, {})).status, 400);
	assert.equal((await auths(id, "totp")).length, 1);

	const disabled = await user.post(base, { code: await codeOf(account.secret) });
	assert.equal(disabled.status, 200);
	assert.equal(disabled.body, true);
	assert.equal((await auths(id, "totp")).length, 0);
	assert.equal((await auths(id, "backup_code")).length, 0);
	assert.deepEqual((await user.get(`/users/${id}/mfa`)).body, { totp_enabled: false, backup_codes_remaining: 0 });

	const client = api.client();
	const login = await client.post("/tokens", { identity: account.email, secret: PASSWORD });
	assert.equal(login.status, 200);
	assert.deepEqual(Object.keys(login.body), ["expires"]);
	assert.ok(setCookie(login, SESSION));
	// it is not enabled any more
	assert.equal((await user.post(base, { code: "123456" })).status, 400);
});

it("disables TOTP with a backup code", async () => {
	const account = await enroll();
	const disabled = await account.user.post(`/users/${account.id}/mfa/totp/disable`, { code: account.codes[3] });
	assert.equal(disabled.status, 200);
	assert.equal((await auths(account.id, "totp")).length, 0);
});

it("lets an administrator read the status of another user and reset its MFA", async () => {
	const account = await enroll();
	const reader = await newAdmin(api, admin);
	assert.deepEqual((await reader.get(`/users/${account.id}/mfa`)).body, {
		totp_enabled: true,
		backup_codes_remaining: 8,
	});
	const reset = await reader.delete(`/users/${account.id}/mfa`);
	assert.equal(reset.status, 200);
	assert.equal(reset.body, true);
	assert.equal((await auths(account.id, "totp")).length, 0);
	assert.equal((await auths(account.id, "backup_code")).length, 0);
	const login = await api.client().post("/tokens", { identity: account.email, secret: PASSWORD });
	assert.equal(login.status, 200);
	assert.deepEqual(Object.keys(login.body), ["expires"]);
	// nothing left to reset, and not for the own account
	assert.equal((await reader.delete(`/users/${account.id}/mfa`)).status, 400);
	assert.equal((await reader.delete(`/users/${reader.user.id}/mfa`)).status, 400);
	assert.equal((await reader.delete("/users/999999/mfa")).status, 404);
});

it("refuses MFA calls without a session with 401", async () => {
	const account = await enroll();
	const base = `/users/${account.id}/mfa`;
	const code = { code: "123456" };
	const calls = [
		["get", base],
		["delete", base],
		["post", `${base}/totp`],
		["post", `${base}/totp/enable`, code],
		["post", `${base}/totp/disable`, code],
		["post", `${base}/backup-codes`, code],
	];
	for (const [method, url, body] of calls) {
		assert.equal((await api.client()[method](url, body)).status, 401, `${method} ${url}`);
	}
	assert.equal((await auths(account.id, "totp")).length, 1);
});

it("refuses 403 to manage the MFA of another user, even for an administrator, and to read it or reset it without being one", async () => {
	const victim = await enroll();
	const stranger = await api.limited({ visibility: "user" });
	const base = `/users/${victim.id}/mfa`;
	assert.equal((await stranger.get(base)).status, 403);
	assert.equal((await stranger.delete(base)).status, 403);
	assert.equal((await stranger.post(`${base}/totp`)).status, 403);

	const other = await newAdmin(api, admin);
	nextPeriod();
	const code = await codeOf(victim.secret);
	assert.equal((await other.post(`${base}/totp`)).status, 403);
	assert.equal((await other.post(`${base}/totp/enable`, { code })).status, 403);
	assert.equal((await other.post(`${base}/totp/disable`, { code })).status, 403);
	assert.equal((await other.post(`${base}/backup-codes`, { code })).status, 403);
	// nothing changed
	assert.equal((await auths(victim.id, "totp")).length, 1);
	assert.equal((await auths(victim.id, "backup_code")).length, 8);
});
