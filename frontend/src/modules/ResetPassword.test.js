import assert from "node:assert/strict";
import { it } from "node:test";
import { publicPageOf, resetTokenOf, tokenFromHash } from "./ResetPassword.js";

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

it("takes the token from the fragment first, then from the history state, else none", () => {
	assert.equal(resetTokenOf("#token=abc", { resetToken: "old" }), "abc");
	assert.equal(resetTokenOf("", { resetToken: "kept" }), "kept");
	assert.equal(resetTokenOf("#x=1", { resetToken: "kept" }), "kept");
	assert.equal(resetTokenOf("", null), "");
	assert.equal(resetTokenOf("", { resetToken: 5 }), "");
	assert.equal(resetTokenOf("", undefined), "");
});
