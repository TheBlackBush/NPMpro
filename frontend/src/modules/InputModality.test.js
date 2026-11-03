import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { modalityAfter } from "./InputModality.js";

describe("modalityAfter", () => {
	it("a key press makes the keyboard the last input", () => {
		assert.equal(modalityAfter("pointer", "keydown"), "keyboard");
	});
	it("a pointer press makes the pointer the last input", () => {
		assert.equal(modalityAfter("keyboard", "pointerdown"), "pointer");
	});
	it("other events keep the last input", () => {
		assert.equal(modalityAfter("keyboard", "focus"), "keyboard");
		assert.equal(modalityAfter("pointer", "scroll"), "pointer");
	});
});
