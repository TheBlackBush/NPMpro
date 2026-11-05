import assert from "node:assert/strict";
import { it } from "node:test";
import { AUTO_COLLAPSE_BELOW, sidebarOpen, sidebarOpenChange } from "./SidebarOpen.js";

it("collapses to icons below 1024 px", () => {
	assert.equal(AUTO_COLLAPSE_BELOW, 1024);
});

it("follows the saved choice from 1024 px up", () => {
	assert.equal(sidebarOpen({ collapsedPreference: false, narrow: false, openedHere: false }), true);
	assert.equal(sidebarOpen({ collapsedPreference: true, narrow: false, openedHere: false }), false);
	// a leftover "opened here" does not matter on a wide window
	assert.equal(sidebarOpen({ collapsedPreference: true, narrow: false, openedHere: true }), false);
});

it("shows the icon rail below 1024 px whatever the saved choice is", () => {
	assert.equal(sidebarOpen({ collapsedPreference: false, narrow: true, openedHere: false }), false);
	assert.equal(sidebarOpen({ collapsedPreference: true, narrow: true, openedHere: false }), false);
});

it("opens the sidebar for this visit when the trigger was used below 1024 px", () => {
	assert.equal(sidebarOpen({ collapsedPreference: true, narrow: true, openedHere: true }), true);
	assert.equal(sidebarOpen({ collapsedPreference: false, narrow: true, openedHere: true }), true);
});

it("writes the saved choice only from 1024 px up", () => {
	assert.deepEqual(sidebarOpenChange({ narrow: false, open: false }), { collapsedPreference: true });
	assert.deepEqual(sidebarOpenChange({ narrow: false, open: true }), { collapsedPreference: false });
	assert.deepEqual(sidebarOpenChange({ narrow: true, open: true }), { openedHere: true });
	assert.deepEqual(sidebarOpenChange({ narrow: true, open: false }), { openedHere: false });
});
