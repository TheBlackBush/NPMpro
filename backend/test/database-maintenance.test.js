import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import { createMaintenance, maintenance } from "../lib/database/maintenance.js";
import errs from "../lib/error.js";
import {
	closeSessions,
	isSessionRevoked,
	reopenSessions,
	revokeSession,
	takeHeldRevocations,
	writeHeldRevocations,
} from "../lib/session.js";
import { migratedSqlite } from "./support/database.js";

const run = (m, method, path, res = {}) => {
	let result = "next";
	m.guard({ method, path }, res, (error) => {
		if (error) result = error;
	});
	return result;
};
const refused = (result) =>
	result instanceof errs.DatabaseMoveError && result.code === "maintenance" && result.status === 409;

it("lets everything through when no move runs", () => {
	const m = createMaintenance();
	assert.equal(m.active(), false);
	assert.equal(m.moveId(), null);
	for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]) {
		assert.equal(run(m, method, "/api/nginx/proxy-hosts"), "next", method);
	}
	m.refuseWrite();
});

it("refuses writes during a move, allows reads, login, logout and the move endpoints", () => {
	const m = createMaintenance();
	m.start("move-1");
	assert.equal(m.active(), true);
	assert.equal(m.moveId(), "move-1");
	for (const [method, path] of [
		["POST", "/api/nginx/proxy-hosts"],
		["PUT", "/api/settings/nginx"],
		["DELETE", "/api/users/2"],
		["POST", "/api/backups"],
		["POST", "/api/tokens/other"],
		["DELETE", "/api/tokens/totp"],
		["PATCH", "/api/tokens"],
		["POST", "/api/databases"],
		["POST", "/api/database"],
		["POST", "/api/database/other"],
		["PUT", "/api/database/move"],
		["DELETE", "/api/database/move"],
		["POST", "/api/database/move/extra"],
	]) {
		assert.ok(refused(run(m, method, path)), `${method} ${path}`);
	}
	for (const [method, path] of [
		["GET", "/api/nginx/proxy-hosts"],
		["HEAD", "/api"],
		["OPTIONS", "/api/users"],
		["POST", "/api/tokens"],
		["POST", "/api/tokens/"],
		["POST", "/api/tokens/totp"],
		["DELETE", "/api/tokens"],
		["POST", "/api/database/test"],
		["POST", "/api/database/move"],
		["GET", "/api/database/move"],
	]) {
		assert.equal(run(m, method, path), "next", `${method} ${path}`);
	}
	assert.throws(
		() => m.refuseWrite(),
		(error) => refused(error),
	);
	assert.throws(
		() => m.start("move-2"),
		(error) => error.code === "move-running" && error.status === 409,
	);
	assert.equal(m.moveId(), "move-1");
	m.end();
	assert.equal(m.active(), false);
	assert.equal(run(m, "POST", "/api/nginx/proxy-hosts"), "next");
	m.refuseWrite();
});

it("waits for a write request that started before the move", async () => {
	const m = createMaintenance();
	await m.idle();
	const res = new EventEmitter();
	assert.equal(run(m, "PUT", "/api/settings/nginx", res), "next");
	// reads and the move's own requests are not waited for
	assert.equal(run(m, "GET", "/api/settings", new EventEmitter()), "next");
	assert.equal(run(m, "POST", "/api/database/move", new EventEmitter()), "next");
	m.start("move-idle");
	let settled = false;
	const idle = m.idle().then(() => {
		settled = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(settled, false);
	res.emit("finish");
	res.emit("close");
	await idle;
	assert.equal(settled, true);
	await m.idle();
	m.end();
});

it("a claimed write is refused during a move and keeps idle() pending until it is released", async () => {
	const m = createMaintenance();
	const release = m.beginWrite();
	m.start("move-claim");
	assert.throws(
		() => m.beginWrite(),
		(error) => refused(error),
	);
	assert.equal(m.tryBeginWrite(), null);
	let settled = false;
	const idle = m.idle().then(() => {
		settled = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(settled, false);
	release();
	release();
	await idle;
	assert.equal(settled, true);
	m.end();
	const skipped = m.tryBeginWrite();
	assert.equal(typeof skipped, "function");
	skipped();
	await m.idle();
});

it("idle() with a time limit rejects when writes do not finish in time", async () => {
	const m = createMaintenance();
	await m.idle({ timeoutMs: 1 });
	const release = m.beginWrite();
	m.start("move-late");
	await assert.rejects(
		m.idle({ timeoutMs: 5 }),
		(error) => error instanceof errs.DatabaseMoveError && error.code === "writes-running" && error.status === 409,
	);
	const idle = m.idle({ timeoutMs: 1000 });
	release();
	await idle;
	m.end();
});

it("holds a logout's revocation during a move and gives it to the move", async () => {
	maintenance.start("move-held");
	try {
		const authTime = 1_800_000_000;
		await revokeSession({ sid: "held-sid", auth_time: authTime });
		assert.equal(await isSessionRevoked("held-sid"), true);
		assert.deepEqual(takeHeldRevocations(), [{ sid: "held-sid", expires_at: authTime + 30 * 24 * 60 * 60 }]);
		assert.deepEqual(takeHeldRevocations(), []);
	} finally {
		takeHeldRevocations();
		maintenance.end();
	}
});

it("writes the held revocations into the database that stays", async () => {
	const db = await migratedSqlite();
	try {
		maintenance.start("move-write");
		try {
			await revokeSession({ sid: "sid-a", auth_time: 1_800_000_000 });
			await revokeSession({ sid: "sid-b", auth_time: 1_800_000_100 });
		} finally {
			maintenance.end();
		}
		await db.knex("session_revocation").insert({ sid: "sid-a", expires_at: 1 });

		// a failed write keeps them held, so they still count as revoked
		await assert.rejects(
			writeHeldRevocations(() => {
				throw new Error("gone");
			}),
			{ message: "gone" },
		);
		assert.equal(await isSessionRevoked("sid-b"), true);

		assert.equal(await writeHeldRevocations(db.knex), 2);
		assert.deepEqual(takeHeldRevocations(), []);
		const rows = await db.knex("session_revocation").select("sid", "expires_at").orderBy("sid");
		assert.deepEqual(
			rows.map((row) => ({ ...row })),
			[
				{ sid: "sid-a", expires_at: 1 },
				{ sid: "sid-b", expires_at: 1_800_000_100 + 30 * 24 * 60 * 60 },
			],
		);
	} finally {
		takeHeldRevocations();
		maintenance.end();
		await db.cleanup();
	}
});

it("revocations a failed write kept are written with the next logout after the move", async () => {
	const db = await migratedSqlite();
	try {
		maintenance.start("move-failed-write");
		try {
			await revokeSession({ sid: "kept-sid", auth_time: 1_800_000_000 });
		} finally {
			maintenance.end();
		}
		// the failed move could not write it into the database that stays
		await assert.rejects(
			writeHeldRevocations(() => {
				throw new Error("gone");
			}),
		);
		assert.equal(await isSessionRevoked("kept-sid"), true);
		await revokeSession({ sid: "next-sid", auth_time: 1_800_000_000 }, { knex: db.knex });
		assert.deepEqual(takeHeldRevocations(), []);
		const sids = await db.knex("session_revocation").orderBy("sid").pluck("sid");
		assert.deepEqual(sids, ["kept-sid", "next-sid"]);
	} finally {
		takeHeldRevocations();
		await db.cleanup();
	}
});

it("after the move's last logout write a logout is refused, not held", async () => {
	maintenance.start("move-closing");
	closeSessions();
	try {
		await assert.rejects(
			revokeSession({ sid: "too-late", auth_time: 1_800_000_000 }),
			(error) => error instanceof errs.DatabaseMoveError && error.code === "move-running" && error.status === 409,
		);
		assert.deepEqual(takeHeldRevocations(), []);
	} finally {
		reopenSessions();
		takeHeldRevocations();
		maintenance.end();
	}
});
