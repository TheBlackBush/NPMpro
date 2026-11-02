import assert from "node:assert/strict";
import { it } from "node:test";
import { findRowActions, focusLost, pickOpener, returnTarget, rowActionsSelector } from "./FocusReturn.js";

const element = ({ connected = true, visible = true, key } = {}) => ({
	isConnected: connected,
	checkVisibility: () => visible,
	getAttribute: (name) => (name === "data-row-actions" ? (key ?? null) : null),
	focus() {},
});

const fakeDoc = ({ active, buttons = [], heading = null } = {}) => {
	const body = { isBody: true };
	return {
		body,
		activeElement: active === "body" ? body : active,
		querySelectorAll: (selector) =>
			buttons.filter((button) => selector === rowActionsSelector(button.getAttribute("data-row-actions"))),
		querySelector: (selector) => (selector === "[data-list-heading]" ? heading : null),
	};
};

it("sees lost focus when the body or nothing has it", () => {
	assert.equal(focusLost(fakeDoc({ active: "body" })), true);
	assert.equal(focusLost(fakeDoc({ active: null })), true);
	assert.equal(focusLost(fakeDoc({ active: element() })), false);
});

it("quotes the key in the selector", () => {
	assert.equal(rowActionsSelector("proxy-host-12"), '[data-row-actions="proxy-host-12"]');
	assert.equal(rowActionsSelector('a"b'), '[data-row-actions="a\\"b"]');
});

it("finds the first visible row action button with the key", () => {
	const hidden = element({ key: "proxy-host-1", visible: false });
	const shown = element({ key: "proxy-host-1" });
	const other = element({ key: "proxy-host-2" });
	const doc = fakeDoc({ buttons: [hidden, other, shown] });
	assert.equal(findRowActions(doc, "proxy-host-1"), shown);
	assert.equal(findRowActions(doc, "proxy-host-3"), null);
	assert.equal(findRowActions(doc, null), null);
});

it("returns to the captured element while it is in the page", () => {
	const captured = element({ key: "proxy-host-1" });
	const twin = element({ key: "proxy-host-1" });
	assert.equal(returnTarget(fakeDoc({ buttons: [twin] }), captured), captured);
});

it("returns to the visible twin when the captured button was replaced", () => {
	const captured = element({ key: "proxy-host-1", connected: false });
	const hiddenTwin = element({ key: "proxy-host-1", visible: false });
	const twin = element({ key: "proxy-host-1" });
	const heading = element();
	assert.equal(returnTarget(fakeDoc({ buttons: [hiddenTwin, twin], heading }), captured), twin);
});

it("falls back to the list heading when the row is gone or nothing was captured", () => {
	const heading = element();
	const gone = element({ key: "proxy-host-1", connected: false });
	const doc = fakeDoc({ heading });
	assert.equal(returnTarget(doc, gone), heading);
	assert.equal(returnTarget(doc, null), heading);
	assert.equal(returnTarget(doc, doc.body), heading);
	assert.equal(returnTarget(fakeDoc(), gone), null);
	// a captured element without a row key that left the page
	assert.equal(returnTarget(doc, element({ connected: false })), heading);
});

it("sees a stale activeElement inside a closed window as lost focus", () => {
	const stale = { closest: (selector) => (selector === '[data-state="closed"]' ? {} : null) };
	assert.equal(focusLost(fakeDoc({ active: stale })), true);
});

it("takes the last pressed control as the opener when Safari left the body focused", () => {
	const pressed = element();
	assert.equal(pickOpener(fakeDoc({ active: "body" }), pressed), pressed);
	assert.equal(pickOpener(fakeDoc({ active: "body" }), element({ connected: false })).isBody, true);
	const focused = element();
	assert.equal(pickOpener(fakeDoc({ active: focused }), pressed), focused);
});
