import assert from "node:assert/strict";
import { it } from "node:test";
import { labelSearchText } from "./HostSearch.js";

it("gives the description of a host to the list search, nothing for a host without one", () => {
	assert.equal(labelSearchText({ npmproDescription: "Kitchen camera" }).trim(), "Kitchen camera");
	assert.equal(labelSearchText({}).trim(), "");
	assert.equal(labelSearchText(undefined).trim(), "");
});
