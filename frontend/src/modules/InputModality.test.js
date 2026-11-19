import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { modalityAfter, quietFocus } from "./InputModality.js";

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

describe("quietFocus", () => {
	it("a focus given back after a pointer close hides its ring, after a key press it shows", () => {
		assert.equal(quietFocus("pointer"), true);
		assert.equal(quietFocus("keyboard"), false);
	});
});
