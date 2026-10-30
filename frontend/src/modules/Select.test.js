import assert from "node:assert/strict";
import { it } from "node:test";
import { selectClassNames } from "./Select.js";

it("draws a react-select like a Tabler control, red while its field shows an error", () => {
	const control = (state) =>
		selectClassNames.control({ isFocused: false, isDisabled: false, selectProps: {}, ...state });
	assert.equal(control({}), "form-control");
	assert.equal(control({ selectProps: { "aria-invalid": "true" } }), "form-control is-invalid");
	assert.equal(
		control({ isFocused: true, selectProps: { "aria-invalid": "true" } }),
		"form-control border-primary is-invalid",
	);
	assert.equal(control({ isDisabled: true }), "form-control bg-surface-tertiary text-secondary");
});
