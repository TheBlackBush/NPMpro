import assert from "node:assert/strict";
import { it } from "node:test";
import { CARD_LINK, CARD_POP } from "./CardLink.js";

const classes = (list) => list.split(" ");

it("the link is the group with the focus ring and fills its grid cell", () => {
	for (const name of [
		"group",
		"block",
		"h-full",
		"min-w-0",
		"focus-visible:ring-[3px]",
		"focus-visible:ring-ring/50",
	]) {
		assert.ok(classes(CARD_LINK).includes(name), name);
	}
});

it("the card lifts only without reduced motion, and shadow and ring change on hover and keyboard focus", () => {
	const pop = classes(CARD_POP);
	for (const name of [
		"h-full",
		"motion-safe:hover:-translate-y-0.5",
		"motion-safe:group-focus-visible:-translate-y-0.5",
		"hover:shadow-md",
		"group-focus-visible:shadow-md",
		"hover:ring-primary/55",
		"group-focus-visible:ring-primary/55",
	]) {
		assert.ok(pop.includes(name), name);
	}
	// no unconditional lift and no translucent fill (it hid the hover in dark mode)
	assert.equal(pop.includes("hover:-translate-y-0.5"), false);
	assert.equal(
		pop.some((name) => name.includes("bg-muted")),
		false,
	);
});
