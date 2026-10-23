import assert from "node:assert/strict";
import { it } from "node:test";
import { buttonClassName } from "./ButtonClasses.js";

it("builds one colour class", () => {
	assert.equal(buttonClassName({ color: "primary" }), "btn btn-primary");
	assert.equal(buttonClassName({ color: "danger", outline: true }), "btn btn-outline-danger");
});

it("adds size, width, loading and extra classes", () => {
	assert.equal(
		buttonClassName({ color: "primary", size: "sm", fullWidth: true, isLoading: true, className: "ms-auto" }),
		"btn btn-primary btn-sm w-100 btn-loading ms-auto",
	);
});

it("is a plain button without options", () => {
	assert.equal(buttonClassName({}), "btn");
});
