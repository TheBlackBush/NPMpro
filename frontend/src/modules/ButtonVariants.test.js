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

it("Bootstrap link and icon classes become variants and are removed from the class list", () => {
	const link = buttonVariant({ className: "btn-link link-secondary ms-auto" });
	assert.equal(link.variant, "link");
	assert.equal(link.rest, "ml-auto");
	const icon = buttonVariant({ size: "sm", className: "btn-icon" });
	assert.equal(icon.size, "icon-sm");
	assert.equal(icon.rest, "");
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
	assert.equal(buttonVariant({ className: "btn-icon" }).size, "icon");
});

it("Bootstrap spacing and width utilities are translated", () => {
	assert.equal(buttonVariant({ className: "me-2 ms-3 w-100" }).rest, "mr-2 ml-3 w-full");
	assert.equal(buttonVariant({ className: "px-1 mb-3 p-0" }).rest, "px-1 mb-3 p-0");
});

it("Bootstrap-only classes without a Tailwind equivalent are dropped", () => {
	const result = buttonVariant({ className: "btn btn-ghost btn-danger btn-action btn-sm dropdown-toggle p-0" });
	assert.equal(result.variant, "ghost");
	assert.equal(result.size, "sm");
	assert.equal(result.rest, "p-0");
});

it("Tailwind classes stay untouched", () => {
	assert.equal(buttonVariant({ className: "gap-2 sm:w-auto md:hidden" }).rest, "gap-2 sm:w-auto md:hidden");
});
