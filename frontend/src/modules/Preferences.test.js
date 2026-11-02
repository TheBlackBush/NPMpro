import assert from "node:assert/strict";
import { it } from "node:test";
import { parseCollapsed, parseEditorStyle, parseNavLayout } from "./Preferences.js";

it("navigation layout defaults to the top bar", () => {
	assert.equal(parseNavLayout(null), "top");
	assert.equal(parseNavLayout("rail"), "top");
	assert.equal(parseNavLayout("sidebar"), "sidebar");
});

it("edit windows default to the dialog", () => {
	assert.equal(parseEditorStyle(undefined), "dialog");
	assert.equal(parseEditorStyle("drawer"), "dialog");
	assert.equal(parseEditorStyle("sheet"), "sheet");
});

it("the sidebar is open unless the stored value is exactly 1", () => {
	assert.equal(parseCollapsed(null), false);
	assert.equal(parseCollapsed("true"), false);
	assert.equal(parseCollapsed("1"), true);
});
