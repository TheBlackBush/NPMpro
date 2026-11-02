import assert from "node:assert/strict";
import { it } from "node:test";
import { canClose, dialogWidthClass, windowMode } from "./WindowFrame.js";

it("phones always get a full-screen window", () => {
	assert.equal(windowMode({ editorStyle: "sheet", size: "lg", isPhone: true }), "fullscreen");
	assert.equal(windowMode({ editorStyle: "dialog", size: "sm", isPhone: true }), "fullscreen");
});

it("small windows stay dialogs, others follow the preference", () => {
	assert.equal(windowMode({ editorStyle: "sheet", size: "sm", isPhone: false }), "dialog");
	assert.equal(windowMode({ editorStyle: "sheet", size: "lg", isPhone: false }), "sheet");
	assert.equal(windowMode({ editorStyle: "dialog", size: "lg", isPhone: false }), "dialog");
	assert.equal(windowMode({ editorStyle: undefined, size: undefined, isPhone: false }), "dialog");
});

it("a saving window cannot be closed, a static one ignores outside clicks", () => {
	const onHide = () => {};
	assert.equal(canClose({ onHide: undefined, backdrop: "static", reason: "escape" }), false);
	assert.equal(canClose({ onHide, backdrop: "static", reason: "outside" }), false);
	assert.equal(canClose({ onHide, backdrop: "static", reason: "escape" }), true);
	assert.equal(canClose({ onHide, backdrop: true, reason: "outside" }), true);
});

it("dialog widths per size", () => {
	assert.equal(dialogWidthClass("sm"), "sm:max-w-md");
	assert.equal(dialogWidthClass(undefined), "sm:max-w-2xl");
	assert.equal(dialogWidthClass("lg"), "sm:max-w-3xl");
	assert.equal(dialogWidthClass("xl"), "sm:max-w-5xl");
});
