import assert from "node:assert/strict";
import { it } from "node:test";
import {
	changeEngine,
	initialTarget,
	payloadKey,
	sourceBadge,
	stepState,
	targetErrors,
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
