import assert from "node:assert/strict";
import { it } from "node:test";
import {
	bumpsOnOutside,
	canClose,
	dialogWidthClass,
	sheetWidthClass,
	windowMode,
	windowPrimitive,
} from "./WindowFrame.js";

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

it("the primitive follows the preference and the size, never the screen width", () => {
	assert.equal(windowPrimitive({ editorStyle: "sheet", size: "lg" }), "sheet");
	assert.equal(windowPrimitive({ editorStyle: "sheet", size: undefined }), "sheet");
	assert.equal(windowPrimitive({ editorStyle: "sheet", size: "sm" }), "dialog");
	assert.equal(windowPrimitive({ editorStyle: "dialog", size: "xl" }), "dialog");
	assert.equal(windowPrimitive({ editorStyle: undefined, size: "lg" }), "dialog");
});

it("sheet widths per size, full screen on a phone", () => {
	assert.equal(sheetWidthClass("lg"), "data-[side=right]:sm:max-w-2xl");
	assert.equal(sheetWidthClass(undefined), "data-[side=right]:sm:max-w-xl");
	const full = sheetWidthClass("full").split(" ");
	assert.ok(full.includes("data-[side=right]:w-full"));
	assert.ok(full.includes("data-[side=right]:sm:max-w-none"));
});

it("a refused outside click bumps the window, unless stacked, full screen or reduced motion", () => {
	const base = { mode: "dialog", refused: true, stacked: false, reducedMotion: false };
	assert.equal(bumpsOnOutside(base), true);
	assert.equal(bumpsOnOutside({ ...base, mode: "sheet" }), true);
	assert.equal(bumpsOnOutside({ ...base, refused: false }), false);
	assert.equal(bumpsOnOutside({ ...base, stacked: true }), false);
	assert.equal(bumpsOnOutside({ ...base, mode: "fullscreen" }), false);
	assert.equal(bumpsOnOutside({ ...base, reducedMotion: true }), false);
});
