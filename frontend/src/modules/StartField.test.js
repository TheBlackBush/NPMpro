import assert from "node:assert/strict";
import { it } from "node:test";
import { isStartField, keepsWindowFocus, START_FIELD_SELECTOR } from "./StartField.js";

it("a visible, enabled field can start the window", () => {
	assert.equal(isStartField({ role: null, disabled: false, visible: true }), true);
	assert.equal(isStartField({ role: "combobox", disabled: false, visible: true }), true);
	assert.equal(isStartField({ role: "switch", disabled: false, visible: true }), true);
});

it("tabs, disabled and hidden controls never start the window", () => {
	assert.equal(isStartField({ role: "tab", disabled: false, visible: true }), false);
	assert.equal(isStartField({ role: null, disabled: true, visible: true }), false);
	assert.equal(isStartField({ role: null, disabled: false, visible: false }), false);
});

it("the selector covers inputs, selects, textareas, buttons and comboboxes, not hidden inputs", () => {
	for (const part of ['input:not([type="hidden"])', "select", "textarea", "button", '[role="combobox"]']) {
		assert.ok(START_FIELD_SELECTOR.includes(part), part);
	}
});

it("phones and a focus that already moved keep the focus where it is", () => {
	assert.equal(keepsWindowFocus({ isPhone: true, activeIsWindow: true }), true);
	assert.equal(keepsWindowFocus({ isPhone: false, activeIsWindow: false }), true);
	assert.equal(keepsWindowFocus({ isPhone: false, activeIsWindow: true }), false);
});
