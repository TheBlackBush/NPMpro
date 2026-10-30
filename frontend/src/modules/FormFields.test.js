import assert from "node:assert/strict";
import { it } from "node:test";
import { controlAria, joinIds, labelClass, numberInputValue, valueAt, visibleError } from "./FormFields.js";

it("reads a value at a Formik path", () => {
	const errors = { name: "Required", fieldValues: { token: "Bad" }, items: [undefined, { username: "Taken" }] };
	assert.equal(valueAt(errors, "name"), "Required");
	assert.equal(valueAt(errors, "fieldValues.token"), "Bad");
	assert.equal(valueAt(errors, "items[1].username"), "Taken");
	assert.equal(valueAt(errors, "items.1.username"), "Taken");
	assert.equal(valueAt(errors, "items[0].username"), undefined);
	assert.equal(valueAt(undefined, "name"), undefined);
});

it("shows an error once the field was left", () => {
	assert.equal(visibleError({ error: "Required", touched: true, submitCount: 0 }), "Required");
});

it("shows an error after a save was tried, also for a field never visited", () => {
	assert.equal(visibleError({ error: "Required", touched: false, submitCount: 1 }), "Required");
	assert.equal(visibleError({ error: "Required", touched: undefined, submitCount: 3 }), "Required");
});

it("hides an error while the field was neither left nor saved", () => {
	assert.equal(visibleError({ error: "Required", touched: false, submitCount: 0 }), null);
	assert.equal(visibleError({ error: "Required" }), null);
});

it("shows nothing without a text message", () => {
	assert.equal(visibleError({ error: undefined, touched: true, submitCount: 1 }), null);
	assert.equal(visibleError({ error: "", touched: true, submitCount: 1 }), null);
	// a list field's errors belong to its rows: an array or object is not shown at the list
	assert.equal(visibleError({ error: [{ path: "Required" }], touched: true, submitCount: 1 }), null);
});

it("keeps a number input's value as a number, or empty while it holds none, as the Formik forms did", () => {
	assert.equal(numberInputValue("5432"), 5432);
	assert.equal(numberInputValue("3306.5"), 3306.5);
	assert.equal(numberInputValue("1e3"), 1000);
	assert.equal(numberInputValue(""), "");
	assert.equal(numberInputValue("-"), "");
});

it("joins ids without empty or repeated ones", () => {
	assert.equal(joinIds("a-error", null, "a-hint", undefined, ""), "a-error a-hint");
	assert.equal(joinIds("a b", "b c"), "a b c");
	assert.equal(joinIds(null, undefined), undefined);
});

it("describes a control by its error and its hint together", () => {
	assert.deepEqual(controlAria({ id: "name", hasHint: true, error: "Required" }), {
		labelId: "name-label",
		hintId: "name-hint",
		errorId: "name-error",
		"aria-invalid": "true",
		"aria-describedby": "name-error name-hint",
	});
});

it("keeps the hint without an error and adds the caller's ids", () => {
	const aria = controlAria({ id: "name", hasHint: true, error: null, describedBy: "name-note" });
	assert.equal(aria["aria-invalid"], undefined);
	assert.equal(aria["aria-describedby"], "name-hint name-note");
	assert.equal(controlAria({ id: "x" })["aria-describedby"], undefined);
});

it("marks a required label", () => {
	assert.equal(labelClass(true), "form-label required");
	assert.equal(labelClass(false), "form-label");
	assert.equal(labelClass(), "form-label");
});
