import assert from "node:assert/strict";
import { it } from "node:test";
import { maintenance } from "../lib/database/maintenance.js";
import errs from "../lib/error.js";
import { createLogoutHandler } from "../lib/express/logout.js";
import { closeSessions, reopenSessions, revokeSession, takeHeldRevocations } from "../lib/session.js";
import { migratedSqlite } from "./support/database.js";

const tokenData = { sid: "route-sid", auth_time: 1_800_000_000 };

// runs the handler with a signed token cookie and records the answer
const call = async (handler) => {
	const sent = { cleared: [], cookies: [] };
	const res = {
		clearCookie: (name) => sent.cleared.push(name),
		cookie: (name) => sent.cookies.push(name),
		status: (code) => {
			sent.status = code;
			return res;
		},
		send: (value) => {
			sent.body = value;
		},
	};
	try {
		await handler({ signedCookies: { "__Host-Http-token": "signed-token" } }, res);
	} catch (error) {
		sent.error = error;
	}
	return sent;
};

it("a logout while a move restarts answers 409 and keeps the cookie", async () => {
	maintenance.start("route-closing");
	closeSessions();
	try {
		const sent = await call(createLogoutHandler({ revokeSession, loadToken: () => tokenData }));
		assert.ok(sent.error instanceof errs.DatabaseMoveError);
		assert.equal(sent.error.status, 409);
		assert.equal(sent.error.code, "move-running");
		assert.equal(sent.status, undefined);
		assert.deepEqual(sent.cleared, []);
		assert.deepEqual(sent.cookies, []);
		assert.deepEqual(takeHeldRevocations(), []);
	} finally {
		reopenSessions();
		takeHeldRevocations();
		maintenance.end();
	}
});

it("a logout outside a move revokes the session, answers 200 and clears the cookie", async () => {
	const db = await migratedSqlite();
	try {
		const handler = createLogoutHandler({
			revokeSession: (data) => revokeSession(data, { knex: db.knex }),
			loadToken: () => tokenData,
		});
		const sent = await call(handler);
		assert.equal(sent.error, undefined);
		assert.equal(sent.status, 200);
		assert.deepEqual(sent.cleared, ["__Host-Http-token"]);
		assert.ok(await db.knex("session_revocation").where("sid", "route-sid").first());
	} finally {
		await db.cleanup();
	}
});

it("an invalid token still logs out (answers 200 and clears the cookie)", async () => {
	const sent = await call(
		createLogoutHandler({
			revokeSession,
			loadToken: () => {
				throw new Error("invalid token");
			},
		}),
	);
	assert.equal(sent.error, undefined);
	assert.equal(sent.status, 200);
	assert.deepEqual(sent.cleared, ["__Host-Http-token"]);
});
