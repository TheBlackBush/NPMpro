import assert from "node:assert/strict";
import { it } from "node:test";
import {
	choiceGroupClass,
	choiceItemClass,
	controlAria,
	joinIds,
	labelClass,
	numberInputValue,
	switchListClass,
	valueAt,
} from "./FormFields.js";

it("reads a value at a field path", () => {
	const errors = { name: "Required", fieldValues: { token: "Bad" }, items: [undefined, { username: "Taken" }] };
	assert.equal(valueAt(errors, "name"), "Required");
	assert.equal(valueAt(errors, "fieldValues.token"), "Bad");
	assert.equal(valueAt(errors, "items[1].username"), "Taken");
	assert.equal(valueAt(errors, "items.1.username"), "Taken");
	assert.equal(valueAt(errors, "items[0].username"), undefined);
	assert.equal(valueAt(undefined, "name"), undefined);
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

it("builds the classes of a choice group and its options", () => {
	assert.equal(choiceGroupClass(), "form-selectgroup");
	assert.equal(choiceGroupClass({ variant: "pills" }), "form-selectgroup form-selectgroup-pills");
	assert.equal(choiceGroupClass({ fill: true }), "form-selectgroup w-100");
	assert.equal(
		choiceGroupClass({ variant: "boxes", vertical: true }),
		"form-selectgroup form-selectgroup-boxes d-flex flex-column",
	);
	assert.equal(choiceItemClass(), "form-selectgroup-item");
	assert.equal(choiceItemClass({ fill: true }), "form-selectgroup-item flex-fill");
	assert.equal(choiceItemClass({ disabled: true }), "form-selectgroup-item opacity-50 cursor-not-allowed");
});

it("lays out a switch list in one or two columns", () => {
	assert.equal(switchListClass(), "divide-y");
	assert.equal(switchListClass(1), "divide-y");
	assert.equal(switchListClass(2), "row row-cols-1 row-cols-md-2 gx-4");
});
