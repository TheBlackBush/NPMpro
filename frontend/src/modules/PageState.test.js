import assert from "node:assert/strict";
import { it } from "node:test";
import { settlePage } from "./PageState.js";

it("keeps the page when nothing changed", () => {
	const state = { index: 2, signature: "a" };
	assert.equal(settlePage(state, "a", 100, 25), state);
});

it("goes back to the first page when the signature changes", () => {
	assert.deepEqual(settlePage({ index: 2, signature: "a" }, "b", 100, 25), { index: 0, signature: "b" });
});

it("goes to the last page that exists when the rows no longer reach the page", () => {
	assert.deepEqual(settlePage({ index: 3, signature: "a" }, "a", 60, 25), { index: 2, signature: "a" });
	assert.deepEqual(settlePage({ index: 3, signature: "a" }, "a", 0, 25), { index: 0, signature: "a" });
});

it("keeps the page while the total is not known", () => {
	const state = { index: 3, signature: "a" };
	assert.equal(settlePage(state, "a", null, 25), state);
});
