import assert from "node:assert/strict";
import { it } from "node:test";
import { PASSWORD_MAX, passwordPairValidate, publicPageOf, tokenFromHash } from "./ResetPassword.js";

it("reads the token from the fragment", () => {
	assert.equal(tokenFromHash("#token=abc"), "abc");
	assert.equal(tokenFromHash("#x=1&token=abc"), "abc");
	assert.equal(tokenFromHash("token=abc"), "abc");
});

it("gives an empty token for an empty or missing fragment", () => {
	assert.equal(tokenFromHash(""), "");
	assert.equal(tokenFromHash("#"), "");
	assert.equal(tokenFromHash("#x=1"), "");
	assert.equal(tokenFromHash(undefined), "");
});

it("names the pages that need no session", () => {
	assert.equal(publicPageOf("/forgot-password"), "forgot");
	assert.equal(publicPageOf("/reset-password/"), "reset");
	assert.equal(publicPageOf("/"), null);
	assert.equal(publicPageOf("/reset-password/x"), null);
});

it("accepts two equal passwords of a valid length", () => {
	assert.equal(passwordPairValidate("12345678", "12345678"), null);
});

it("refuses a mismatch on the repeat", () => {
	assert.deepEqual(passwordPairValidate("12345678", "1234567"), { field: "confirm", reason: "mismatch" });
	assert.deepEqual(passwordPairValidate("12345678", ""), { field: "confirm", reason: "mismatch" });
});

it("refuses an empty, a short and a too long password before the repeat", () => {
	assert.deepEqual(passwordPairValidate("", ""), { field: "new", reason: "required" });
	assert.deepEqual(passwordPairValidate("1234567", "other"), { field: "new", reason: "short" });
	assert.deepEqual(passwordPairValidate("x".repeat(PASSWORD_MAX + 1), "x"), { field: "new", reason: "long" });
});

it("does not trim", () => {
	assert.equal(passwordPairValidate("        ", "        "), null);
});
