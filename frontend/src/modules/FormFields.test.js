import assert from "node:assert/strict";
import { it } from "node:test";
import {
	choiceGroupClass,
	choiceItemClass,
	controlAria,
	joinIds,
	labelClass,
	numberInputValue,
	SWITCH_CLASS,
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

it("lays out a choice group in a row (filled: sharing it) or a column, its options as cards", () => {
	assert.equal(choiceGroupClass(), "tw:flex tw:flex-wrap tw:gap-2");
	assert.equal(choiceGroupClass({ variant: "pills" }), "tw:flex tw:flex-wrap tw:gap-2");
	assert.equal(choiceGroupClass({ fill: true }), "tw:flex tw:flex-wrap tw:gap-2 tw:w-full");
	assert.equal(choiceGroupClass({ variant: "boxes", vertical: true }), "tw:flex tw:flex-col tw:gap-2");
	assert.equal(choiceGroupClass({ fill: true, vertical: true }), "tw:flex tw:flex-col tw:gap-2");
	assert.equal(choiceItemClass(), "tw:min-w-0");
	assert.equal(choiceItemClass({ fill: true }), "tw:min-w-0 tw:flex-1");
	assert.equal(choiceItemClass({ disabled: true }), "tw:min-w-0 tw:cursor-not-allowed");
});

it("lays out a switch list in one or two columns", () => {
	assert.equal(switchListClass(), "tw:flex tw:flex-col tw:gap-3");
	assert.equal(switchListClass(1), "tw:flex tw:flex-col tw:gap-3");
	assert.equal(switchListClass(2), "tw:grid tw:grid-cols-1 tw:gap-x-6 tw:gap-y-3 tw:md:grid-cols-2");
});

it("draws a native checkbox as shadcn's switch, its state from the input itself", () => {
	for (const part of [
		"tw:appearance-none",
		"tw:checked:bg-primary",
		"tw:disabled:opacity-50",
		"tw:aria-invalid:border-destructive",
		"tw:checked:before:translate-x-[calc(100%-2px)]",
	]) {
		assert.ok(SWITCH_CLASS.split(" ").includes(part), part);
	}
});
