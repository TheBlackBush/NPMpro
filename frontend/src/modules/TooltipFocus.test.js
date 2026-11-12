import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keyboardFocusOnly } from "./TooltipFocus.js";

const focusEvent = (
	focusVisible,
	target = { matches: (selector) => selector === ":focus-visible" && focusVisible },
) => {
	const event = {
		currentTarget: target,
		prevented: false,
		preventDefault() {
			event.prevented = true;
		},
	};
	return event;
};

describe("keyboardFocusOnly", () => {
	it("lets keyboard focus open the tooltip", () => {
		const event = focusEvent(true);
		keyboardFocusOnly(event);
		assert.equal(event.prevented, false);
	});

	it("stops focus that is not keyboard focus (a window opened with the mouse)", () => {
		const event = focusEvent(false);
		keyboardFocusOnly(event);
		assert.equal(event.prevented, true);
	});

	it("leaves an event without a target alone", () => {
		const event = focusEvent(false, null);
		keyboardFocusOnly(event);
		assert.equal(event.prevented, false);
	});
});
