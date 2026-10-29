import assert from "node:assert/strict";
import { it } from "node:test";
import { createRetryLog, knexConnectionError, knexLogOf } from "../lib/retry-log.js";

const setup = () => {
	let clock = 0;
	const lines = [];
	const log = { warn: (line) => lines.push(`warn ${line}`), info: (line) => lines.push(`info ${line}`) };
	const retry = createRetryLog({ log, now: () => clock });
	const full = (message) => () => lines.push(`full ${message}`);
	const tick = (ms) => {
		clock += ms;
	};
	return { retry, lines, full, tick };
};

it("logs the first failure in full, then one short line every 30 s, then the reconnect", () => {
	const { retry, lines, full, tick } = setup();
	const refused = "connect ECONNREFUSED 172.20.0.2:3306";
	assert.equal(retry.failed(refused, full(refused)), "full");
	for (let second = 1; second < 30; second++) {
		tick(1000);
		assert.equal(retry.failed(refused, full(refused)), "quiet", `second ${second}`);
	}
	tick(1000);
	assert.equal(retry.failed(refused, full(refused)), "short");
	tick(29_999);
	assert.equal(retry.failed(refused, full(refused)), "quiet");
	tick(1);
	assert.equal(retry.failed(refused, full(refused)), "short");
	retry.connected();
	retry.connected();
	assert.deepEqual(lines, [
		`full ${refused}`,
		`warn Still waiting for the database: ${refused}`,
		`warn Still waiting for the database: ${refused}`,
		"info Connected to the database again",
	]);
});

it("logs a different error in full again, and the same error in full after a reconnect", () => {
	const { retry, lines, full, tick } = setup();
	retry.failed("a", full("a"));
	tick(1000);
	retry.failed("b", full("b"));
	tick(1000);
	retry.failed("a", full("a"));
	retry.connected();
	tick(1000);
	retry.failed("a", full("a"));
	assert.deepEqual(lines, ["full a", "full b", "full a", "info Connected to the database again", "full a"]);
});

it("a failure after the database answered is throttled across retries without a reconnect line", () => {
	const { retry, lines, full, tick } = setup();
	for (let second = 0; second <= 30; second++) {
		retry.connected();
		retry.failed("nginx -t failed", full("nginx"), { reached: true });
		tick(1000);
	}
	assert.deepEqual(lines, ["full nginx", "warn Startup still failing: nginx -t failed"]);
});

it("says nothing on connect when nothing failed", () => {
	const { retry, lines } = setup();
	retry.connected();
	assert.deepEqual(lines, []);
});

it("reads the error of knex's connection warnings and shares the throttle with the startup error", () => {
	assert.equal(
		knexConnectionError(
			"Acquire connection error: Error: connect ECONNREFUSED 172.20.0.2:3306\n    at TCP.onconnect",
		),
		"connect ECONNREFUSED 172.20.0.2:3306",
	);
	assert.equal(
		knexConnectionError("Connection Error: Error: Connection lost: The server closed the connection."),
		"Connection lost: The server closed the connection.",
	);
	assert.equal(knexConnectionError("Acquire connection error: getaddrinfo ENOTFOUND db"), "getaddrinfo ENOTFOUND db");
	assert.equal(knexConnectionError("something else"), null);
	assert.equal(knexConnectionError({ not: "text" }), null);

	const { retry, lines, full, tick } = setup();
	const warned = [];
	const knexLog = knexLogOf(retry, (message) => warned.push(message));
	knexLog.warn("Acquire connection error: Error: connect ECONNREFUSED 10.0.0.1:3306\n    at x");
	// the startup error with the same message right after: already logged
	assert.equal(retry.failed("connect ECONNREFUSED 10.0.0.1:3306", full("startup")), "quiet");
	tick(1000);
	knexLog.warn("Acquire connection error: Error: connect ECONNREFUSED 10.0.0.1:3306\n    at x");
	knexLog.warn("FS-related option specified for migration configuration");
	assert.deepEqual(warned, [
		"Acquire connection error: Error: connect ECONNREFUSED 10.0.0.1:3306\n    at x",
		"FS-related option specified for migration configuration",
	]);
	assert.deepEqual(lines, []);
});
