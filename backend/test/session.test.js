import assert from "node:assert/strict";
import { it } from "node:test";
import { continueSession, newSession, SESSION_MAX_AGE_SECONDS } from "../lib/session.js";
import { isSealed, openSecret } from "../lib/totp-secret.js";

it("a sign-in starts a session with a random id and the sign-in time", () => {
	const a = newSession();
	const b = newSession();
	assert.notEqual(a.sid, b.sid);
	assert.ok(a.sid.length >= 20);
	assert.ok(Math.abs(a.auth_time - Date.now() / 1000) < 5);
});

it("a refresh keeps the session until it is 30 days old", () => {
	const now = 2_000_000_000;
	const token = { sid: "abc", auth_time: now - SESSION_MAX_AGE_SECONDS };
	assert.deepEqual(continueSession(token, now), { sid: "abc", auth_time: token.auth_time });
	assert.throws(() => continueSession({ ...token, auth_time: token.auth_time - 1 }, now), { status: 403 });
	assert.equal(SESSION_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
});

it("a token from before sessions existed starts a new session on refresh", () => {
	const session = continueSession({ attrs: { id: 1 } });
	assert.equal(typeof session.sid, "string");
	assert.ok(Number.isInteger(session.auth_time));
});

it("plaintext TOTP secrets from before still work, encrypted ones are recognised", () => {
	assert.equal(isSealed("JBSWY3DPEHPK3PXP"), false);
	assert.equal(openSecret("JBSWY3DPEHPK3PXP"), "JBSWY3DPEHPK3PXP");
	assert.equal(isSealed("v1:a:b:c"), true);
});
