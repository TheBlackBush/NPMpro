// Tailwind's own class list (with tw-animate-css and shadcn's utilities) against isUnprefixedUtility: every class
// Tailwind can generate must be recognized, so a Tailwind upgrade that adds a utility family fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { isUnprefixedUtility } from "./TailwindPrefix.js";

const stylesheets = {
	"tailwindcss/theme.css": "../../node_modules/tailwindcss/theme.css",
	"tailwindcss/utilities.css": "../../node_modules/tailwindcss/utilities.css",
	"tw-animate-css": "../../node_modules/tw-animate-css/dist/tw-animate.css",
	"shadcn/tailwind.css": "../../node_modules/shadcn/dist/tailwind.css",
};

// classes that are no utility to write in a class list; each with the reason
const EXCEPTIONS = new Set([]);

it("recognizes every class Tailwind, tw-animate-css and shadcn's stylesheet can generate", async () => {
	const css = Object.keys(stylesheets)
		.map((id) => `@import "${id}";`)
		.join("\n");
	const design = await __unstable__loadDesignSystem(css, {
		loadStylesheet: (id, base) => {
			const path = fileURLToPath(new URL(stylesheets[id], import.meta.url));
			return Promise.resolve({ path, base, content: readFileSync(path, "utf8") });
		},
	});
	const classes = design.getClassList().map(([name]) => name);
	assert.ok(classes.length > 10_000, `only ${classes.length} classes: the design system did not load`);
	const missed = classes.filter((name) => !EXCEPTIONS.has(name) && !isUnprefixedUtility(name));
	assert.deepEqual(
		[...new Set(missed.map((name) => name.split("-")[0]))],
		[],
		`${missed.length} classes not recognized`,
	);
});
