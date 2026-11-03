import assert from "node:assert/strict";
import { it } from "node:test";
import { isStartField, keepsWindowFocus, START_FIELD_SELECTOR } from "./StartField.js";

// a plain text field: shown, enabled, in the tab order, with no control inside it
const field = { role: null, disabled: false, visible: true, tabIndex: 0, containsField: false };

it("a visible, enabled field can start the window", () => {
	assert.equal(isStartField(field), true);
	assert.equal(isStartField({ ...field, role: "combobox" }), true);
	assert.equal(isStartField({ ...field, role: "switch" }), true);
});

it("tabs, disabled and hidden controls never start the window", () => {
	assert.equal(isStartField({ ...field, role: "tab" }), false);
	assert.equal(isStartField({ ...field, disabled: true }), false);
	assert.equal(isStartField({ ...field, visible: false }), false);
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

it("a roving focus container (tab row, radio group, toolbar) is never a start field, its first control is", () => {
	for (const role of ["tablist", "toolbar"]) {
		assert.equal(isStartField({ ...field, role, containsField: true }), false, role);
	}
	assert.equal(isStartField({ ...field, role: "radio" }), true);
});

it("a focusable container (a tab panel before its fields) is never a start field, a plain field is", () => {
	assert.equal(isStartField({ ...field, role: "tabpanel", containsField: true }), false);
	assert.equal(isStartField({ ...field, role: "group", containsField: true }), false);
	assert.equal(isStartField({ ...field, role: "textbox" }), true);
});

it("a container whose fields are all disabled (a View window's panel) is not a start field either", () => {
	// containsField counts disabled fields too: the panel itself is enabled, its fieldset is not
	assert.equal(isStartField({ ...field, role: "tabpanel", containsField: true, disabled: false }), false);
});

it("a control out of the tab order (an unchecked Radix radio, tabindex -1) never starts the window", () => {
	assert.equal(isStartField({ ...field, role: "radio", tabIndex: -1 }), false);
	assert.equal(isStartField({ ...field, role: "radio", tabIndex: 0 }), true);
});

it("a Radix radio group (tabindex 0, its radios tabindex -1) is the start field, its radios are not", () => {
	assert.equal(isStartField({ ...field, role: "radiogroup", tabIndex: 0, containsField: true }), true);
	assert.equal(isStartField({ ...field, role: "radio", tabIndex: -1 }), false);
	assert.equal(
		isStartField({ ...field, role: "radiogroup", tabIndex: 0, containsField: true, disabled: true }),
		false,
	);
});

it("a tab panel, a tab and a tab row stay excluded", () => {
	assert.equal(isStartField({ ...field, role: "tabpanel", tabIndex: 0, containsField: true }), false);
	assert.equal(isStartField({ ...field, role: "tab", tabIndex: 0 }), false);
	assert.equal(isStartField({ ...field, role: "tablist", tabIndex: 0, containsField: true }), false);
});

it("a control marked to be skipped (a chip's remove button) never starts the window", () => {
	assert.equal(isStartField({ ...field, skip: true }), false);
	assert.equal(isStartField({ ...field, skip: false }), true);
});
