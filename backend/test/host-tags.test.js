import assert from "node:assert/strict";
import { it } from "node:test";
import { uniqueTags } from "../lib/host-tags.js";

it("keeps the first of tags that differ only in case, in order", () => {
	assert.deepEqual(uniqueTags(["Prod", "lab", "PROD", "Lab", "café", "CAFÉ"]), ["Prod", "lab", "café"]);
	assert.deepEqual(uniqueTags([]), []);
});
