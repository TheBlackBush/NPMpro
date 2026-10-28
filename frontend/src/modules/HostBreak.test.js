import assert from "node:assert/strict";
import { it } from "node:test";
import { hostParts } from "./HostBreak.js";

it("splits after each dot and colon and keeps the separators", () => {
	assert.deepEqual(hostParts("game-server.lan.example.com:25565"), [
		"game-server.",
		"lan.",
		"example.",
		"com:",
		"25565",
	]);
	assert.equal(hostParts("a.example.com:80").join(""), "a.example.com:80");
});

it("leaves a name without separators whole", () => {
	assert.deepEqual(hostParts("localhost"), ["localhost"]);
	assert.deepEqual(hostParts(""), []);
});

it("keeps leading, trailing and repeated separators", () => {
	assert.deepEqual(hostParts(".a..b:"), [".", "a.", ".", "b:"]);
	assert.equal(hostParts("[::1]:8080").join(""), "[::1]:8080");
	assert.equal(hostParts("*.example.com").join(""), "*.example.com");
});

it("splits an e-mail address after the @ and dots", () => {
	assert.deepEqual(hostParts("max.power@mail.example.com"), ["max.", "power@", "mail.", "example.", "com"]);
});

it("splits after the given separators only", () => {
	assert.deepEqual(hostParts("NODE_TLS_REJECT", "_"), ["NODE_", "TLS_", "REJECT"]);
	assert.deepEqual(hostParts("a.b_c", "_"), ["a.b_", "c"]);
});
