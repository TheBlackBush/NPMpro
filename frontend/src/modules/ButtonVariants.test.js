import assert from "node:assert/strict";
import { it } from "node:test";
import { buttonVariant } from "./ButtonVariants.js";

it("danger colours become the destructive variant", () => {
	assert.equal(buttonVariant({ color: "danger" }).variant, "destructive");
	assert.equal(buttonVariant({ color: "red" }).variant, "destructive");
});

it("secondary and outline map to their variants", () => {
	assert.equal(buttonVariant({ color: "secondary" }).variant, "secondary");
	assert.equal(buttonVariant({ color: "primary", outline: true }).variant, "outline");
	assert.equal(buttonVariant({}).variant, "outline");
});

it("section and accent colours become the primary button", () => {
	for (const color of ["primary", "green", "azure", "teal", "purple", "orange", "blue", "lime"]) {
		assert.equal(buttonVariant({ color }).variant, "default");
	}
});

it("sizes map to shadcn sizes", () => {
	assert.equal(buttonVariant({ size: "sm" }).size, "sm");
	assert.equal(buttonVariant({ size: "lg" }).size, "lg");
	assert.equal(buttonVariant({ size: "xl" }).size, "lg");
	assert.equal(buttonVariant({}).size, "default");
	assert.equal(buttonVariant({ size: "icon" }).size, "icon");
});

it("sizes that name an icon button map directly", () => {
	assert.equal(buttonVariant({ size: "icon-sm" }).size, "icon-sm");
	assert.equal(buttonVariant({ size: "icon-lg" }).size, "icon-lg");
});
