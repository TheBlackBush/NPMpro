import assert from "node:assert/strict";
import { it } from "node:test";
import {
	choiceGroupClass,
	choiceItemClass,
	controlAria,
	joinIds,
	legendClass,
	numberInputValue,
	sectionClass,
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

it("classes the legend of a section", () => {
	assert.equal(legendClass(), "mb-1.5 font-medium text-sm");
	assert.equal(legendClass({ heading: true }), "mb-1.5 font-medium text-base");
	assert.equal(legendClass({ hideLegend: true }), "sr-only");
	assert.equal(legendClass({ heading: true, hideLegend: true }), "sr-only");
});

it("classes a section's fieldset: boxed is a bordered panel", () => {
	assert.equal(sectionClass(), "flex min-w-0 flex-col gap-3");
	assert.equal(sectionClass({ boxed: true }), "flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4");
});

it("builds the classes of a choice group and its options", () => {
	assert.equal(choiceGroupClass(), "flex flex-row flex-wrap gap-2");
	assert.equal(choiceGroupClass({ fill: true }), "flex flex-row flex-wrap gap-2");
	assert.equal(choiceGroupClass({ variant: "boxes", vertical: true }), "flex flex-col gap-2");
	const DISABLED = "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";
	const INLINE = "has-[>[data-slot=field]]:w-fit";
	assert.equal(choiceItemClass(), `rounded-lg ${INLINE} ${DISABLED}`);
	assert.equal(choiceItemClass({ variant: "pills" }), `rounded-full ${INLINE} ${DISABLED}`);
	assert.equal(choiceItemClass({ fill: true }), `rounded-lg min-w-0 flex-1 ${DISABLED}`);
	assert.equal(choiceItemClass({ variant: "boxes", fill: true }), `rounded-lg w-full ${DISABLED}`);
});

it("lays out a switch list in one or two columns", () => {
	assert.equal(switchListClass(), "flex flex-col gap-3");
	assert.equal(switchListClass(1), "flex flex-col gap-3");
	assert.equal(switchListClass(2), "grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2");
});
