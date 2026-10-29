import assert from "node:assert/strict";
import { it } from "node:test";
import {
	activeStep,
	canCloseMove,
	canMove,
	changeEngine,
	copyProgress,
	failedStepOf,
	initialTarget,
	isMoveActive,
	moveAsApiError,
	moveHint,
	moveLost,
	moveView,
	payloadKey,
	pollStalled,
	resolveMoveEnd,
	sourceBadge,
	stepName,
	stepState,
	targetErrors,
	testOfValues,
	toPayload,
	totals,
	waitForRestart,
	whereText,
} from "./DatabaseMove.js";

it("starts with the engine's port and keeps a changed port when the engine changes", () => {
	assert.equal(initialTarget("mysql").port, 3306);
	assert.equal(changeEngine(initialTarget("mysql"), "postgres").port, 5432);
	assert.equal(changeEngine({ ...initialTarget("mysql"), port: 3307 }, "postgres").port, 3307);
	assert.equal(changeEngine(initialTarget("postgres"), "sqlite").engine, "sqlite");
});

it("checks the fields of server engines only", () => {
	assert.deepEqual(targetErrors(initialTarget("sqlite")), {});
	assert.deepEqual(targetErrors({ ...initialTarget("postgres"), host: "", port: 0, name: "bad name", user: "" }), {
		host: "settings.database.error.host",
		port: "settings.database.error.port",
		name: "settings.database.error.name",
		user: "settings.database.error.user",
	});
	assert.deepEqual(targetErrors({ ...initialTarget("postgres"), host: "db.lan" }), {});
});

it("sends only the engine's fields, the password as typed", () => {
	assert.deepEqual(toPayload({ ...initialTarget("postgres"), engine: "sqlite", host: "x" }), { engine: "sqlite" });
	assert.deepEqual(toPayload({ ...initialTarget("postgres"), host: " db.lan ", password: " p ", sslEnabled: true }), {
		engine: "postgres",
		host: "db.lan",
		port: 5432,
		name: "npmpro",
		user: "npmpro",
		password: " p ",
		ssl: { enabled: true },
	});
	assert.deepEqual(
		toPayload({ ...initialTarget("mysql"), host: "db", sslEnabled: true, sslVerifyIdentity: false }).ssl,
		{
			enabled: true,
			rejectUnauthorized: true,
			verifyIdentity: false,
		},
	);
	const tested = payloadKey(toPayload({ ...initialTarget("mysql"), host: "db" }));
	assert.equal(payloadKey(toPayload({ ...initialTarget("mysql"), host: "db" })), tested);
	assert.notEqual(payloadKey(toPayload({ ...initialTarget("mysql"), host: "db", password: "x" })), tested);
});

it("shows each step as done, active, failed or pending", () => {
	const running = { state: "running", step: "copy" };
	assert.deepEqual(
		["maintenance", "backup", "schema", "copy", "verify", "switch"].map((step) => stepState(running, step)),
		["done", "done", "done", "active", "pending", "pending"],
	);
	assert.equal(stepState({ state: "failed", step: "verify" }, "verify"), "failed");
	assert.equal(stepState({ state: "failed", step: "verify" }, "switch"), "pending");
	assert.equal(stepState({ state: "restarting", step: "switch" }, "switch"), "done");
	assert.equal(stepState(null, "copy"), "pending");
});

it("sums the tables, names the source and the place", () => {
	assert.deepEqual(
		totals([
			{ name: "a", rows: 3, copied: 1 },
			{ name: "b", rows: 2, copied: 2 },
		]),
		{ tables: 2, rows: 5, copied: 3 },
	);
	assert.deepEqual(sourceBadge("env"), { labelId: "settings.database.source.env", className: "bg-orange-lt" });
	assert.equal(sourceBadge("default").labelId, "settings.database.source.default");
	assert.equal(whereText({ engine: "sqlite", file: "/data/npmpro/database.sqlite" }), "/data/npmpro/database.sqlite");
	assert.equal(whereText({ engine: "postgres", host: "db", port: 5432, name: "npmpro" }), "db:5432/npmpro");
});

it("waits for a health answer without maintenance, at most the limit", async () => {
	let clock = 0;
	const answers = [new Error("502"), { status: "OK", maintenance: "database-move" }, { status: "OK" }];
	const result = await waitForRestart({
		fetchHealth: async () => {
			const next = answers.shift();
			if (next instanceof Error) throw next;
			return next;
		},
		sleep: async (ms) => {
			clock += ms;
		},
		now: () => clock,
	});
	assert.equal(result, "ready");
	assert.equal(clock, 4000);
	clock = 0;
	assert.equal(
		await waitForRestart({
			fetchHealth: async () => {
				throw new Error("502");
			},
			sleep: async (ms) => {
				clock += ms;
			},
			now: () => clock,
		}),
		"timeout",
	);
	assert.equal(clock, 120_000);
});

it("changes the key with a TLS switch and sends no MySQL TLS keys for Postgres", () => {
	const mysql = { ...initialTarget("mysql"), host: "db", sslEnabled: true };
	const key = payloadKey(toPayload(mysql));
	assert.notEqual(payloadKey(toPayload({ ...mysql, sslEnabled: false })), key);
	assert.notEqual(payloadKey(toPayload({ ...mysql, sslRejectUnauthorized: false })), key);
	assert.notEqual(payloadKey(toPayload({ ...mysql, sslVerifyIdentity: false })), key);
	assert.deepEqual(toPayload({ ...initialTarget("postgres"), host: "db", sslEnabled: true }).ssl, { enabled: true });
});

it("keeps a test only for the values it used and names the next step", () => {
	const values = { ...initialTarget("postgres"), host: "db" };
	const passed = { key: payloadKey(toPayload(values)), result: { engine: "postgres", version: "16.4" } };
	const failed = { key: passed.key, error: new Error("database.error.connect") };
	assert.equal(testOfValues(passed, values), passed);
	assert.equal(testOfValues(passed, { ...values, password: "x" }), null);
	assert.equal(testOfValues(null, values), null);
	assert.equal(canMove(testOfValues(passed, values)), true);
	assert.equal(canMove(testOfValues(failed, values)), false);
	assert.equal(moveHint(passed), null);
	assert.equal(moveHint(failed), "settings.database.test.failed-hint");
	assert.equal(moveHint(null), "settings.database.test.first");
	const sqlite = initialTarget("sqlite");
	const sqliteTest = { key: payloadKey(toPayload(sqlite)), result: { engine: "sqlite", version: null } };
	assert.equal(canMove(testOfValues(sqliteTest, { ...sqlite, host: "ignored" })), true);
});

it("shows the confirmation, then the move this window follows", () => {
	assert.equal(moveView({ moveId: null, move: null, pollFailed: false }), "confirm");
	const old = { id: "old", state: "failed" };
	assert.equal(moveView({ moveId: "new", move: old, pollFailed: false }), "starting");
	assert.equal(moveView({ moveId: "new", move: null, pollFailed: false }), "starting");
	assert.equal(moveView({ moveId: "new", move: { id: "new", state: "running" }, pollFailed: false }), "running");
	assert.equal(
		moveView({ moveId: "new", move: { id: "new", state: "restarting" }, pollFailed: false }),
		"restarting",
	);
	assert.equal(moveView({ moveId: "new", move: { id: "new", state: "failed" }, pollFailed: true }), "failed");
});

it("takes a failed poll as the restart only at the switch step", () => {
	assert.equal(
		moveView({ moveId: "a", move: { id: "a", state: "running", step: "copy" }, pollFailed: true }),
		"running",
	);
	assert.equal(
		moveView({ moveId: "a", move: { id: "a", state: "running", step: "switch" }, pollFailed: true }),
		"restarting",
	);
	assert.equal(
		moveView({ moveId: "a", move: { id: "a", state: "running", step: "switch" }, pollFailed: false }),
		"running",
	);
});

it("names the active step only while the move runs", () => {
	assert.equal(activeStep({ state: "running", step: "copy" }), "copy");
	assert.equal(activeStep({ state: "failed", step: "copy" }), null);
	assert.equal(activeStep(null), null);
});

it("knows which moves the window follows and when it can close", () => {
	assert.equal(isMoveActive({ state: "running" }), true);
	assert.equal(isMoveActive({ state: "restarting" }), true);
	assert.equal(isMoveActive({ state: "failed" }), false);
	assert.equal(isMoveActive(null), false);
	assert.equal(canCloseMove("confirm", null), true);
	assert.equal(canCloseMove("failed", null), true);
	assert.equal(canCloseMove("running", null), false);
	assert.equal(canCloseMove("starting", null), false);
	assert.equal(canCloseMove("restarting", "waiting"), false);
	assert.equal(canCloseMove("restarting", "timeout"), true);
});

it("reports the copy progress and the table being copied", () => {
	const tables = [
		{ name: "user", rows: 2, copied: 2 },
		{ name: "proxy_host", rows: 6, copied: 1 },
		{ name: "stream", rows: 2, copied: 0 },
	];
	assert.deepEqual(copyProgress(tables), {
		tables: 3,
		rows: 10,
		copied: 3,
		percent: 30,
		current: { name: "proxy_host", rows: 6, copied: 1 },
	});
	assert.equal(copyProgress([{ name: "user", rows: 0, copied: 0 }]).percent, 100);
	assert.equal(copyProgress([{ name: "user", rows: 0, copied: 0 }]).current, null);
	assert.equal(copyProgress([{ name: "user", rows: 3, copied: 3 }]).percent, 100);
});

it("turns a failed move into an API error with its step", () => {
	const move = {
		state: "failed",
		step: "copy",
		error: {
			step: "verify",
			message: "Rows differ",
			messageI18n: "database.error.verify",
			details: "user: 2 != 3",
		},
	};
	assert.deepEqual(moveAsApiError(move.error), {
		payload: { error: { message: "Rows differ", message_i18n: "database.error.verify", output: "user: 2 != 3" } },
	});
	assert.equal(failedStepOf(move), "verify");
	assert.equal(failedStepOf({ state: "failed", step: "copy", error: null }), "copy");
});

// a fake clock: sleep moves the time on
const fakeClock = () => {
	let time = 0;
	return {
		now: () => time,
		sleep: (ms) => {
			time += ms;
			return Promise.resolve();
		},
	};
};

it("starts the resolution after 10 seconds of failed polls or when the move is gone", () => {
	assert.equal(pollStalled({ isError: true, lastAnswerAt: 0, now: 9999 }), false);
	assert.equal(pollStalled({ isError: true, lastAnswerAt: 0, now: 10_000 }), true);
	assert.equal(pollStalled({ isError: false, lastAnswerAt: 0, now: 60_000 }), false);
	assert.equal(moveLost({ seen: true, answered: true, move: null, moveId: "a" }), true);
	assert.equal(moveLost({ seen: true, answered: true, move: { id: "b" }, moveId: "a" }), true);
	assert.equal(moveLost({ seen: true, answered: true, move: { id: "a" }, moveId: "a" }), false);
	assert.equal(moveLost({ seen: false, answered: true, move: { id: "old" }, moveId: "a" }), false);
});

it("keeps a move at copy running while the health check reports maintenance", async () => {
	const clock = fakeClock();
	assert.equal(pollStalled({ isError: true, lastAnswerAt: 0, now: 10_000 }), true);
	const { result } = await resolveMoveEnd({
		moveId: "a",
		expectRestart: false,
		fetchHealth: async () => ({ status: "OK", maintenance: "database-move" }),
		fetchDatabase: async () => assert.fail("not asked while the move runs"),
		...clock,
	});
	assert.equal(result, "running");
});

it("shows the failure when the health check has no maintenance and the move failed", async () => {
	const failed = { id: "a", state: "failed", step: "copy", error: { message: "x" } };
	const { result, move } = await resolveMoveEnd({
		moveId: "a",
		expectRestart: false,
		fetchHealth: async () => ({ status: "OK" }),
		fetchDatabase: async () => ({ move: failed }),
		...fakeClock(),
	});
	assert.equal(result, "failed");
	assert.deepEqual(move, failed);
});

it("reloads when the restarted backend has no move or another one", async () => {
	for (const database of [{ move: null }, { move: { id: "b", state: "failed" } }]) {
		const { result } = await resolveMoveEnd({
			moveId: "a",
			expectRestart: true,
			fetchHealth: async () => ({ status: "OK" }),
			fetchDatabase: async () => database,
			...fakeClock(),
		});
		assert.equal(result, "restarted");
	}
});

it("waits through maintenance and failed health checks while a restart is expected, up to the limit", async () => {
	const answers = [new Error("502"), { status: "OK", maintenance: "database-move" }, { status: "OK" }];
	let asked = 0;
	const { result } = await resolveMoveEnd({
		moveId: "a",
		expectRestart: true,
		fetchHealth: async () => {
			const answer = answers[asked++];
			if (answer instanceof Error) throw answer;
			return answer;
		},
		fetchDatabase: async () => ({ move: null }),
		...fakeClock(),
	});
	assert.equal(result, "restarted");
	assert.equal(asked, 3);
	const timedOut = await resolveMoveEnd({
		moveId: "a",
		expectRestart: true,
		fetchHealth: () => Promise.reject(new Error("502")),
		fetchDatabase: async () => ({ move: null }),
		...fakeClock(),
	});
	assert.equal(timedOut.result, "timeout");
});

it("names a step through the translation, and an unknown one as it is", () => {
	const format = (id) => `[${id}]`;
	assert.equal(stepName("copy", format), "[settings.database.step.copy]");
	assert.equal(stepName("later", format), "later");
	assert.equal(stepName(null, format), "");
});
