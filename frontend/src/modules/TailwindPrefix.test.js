import assert from "node:assert/strict";
import { it } from "node:test";
import { isUnprefixedUtility, unprefixedClasses } from "./TailwindPrefix.js";

// source text with template literals: #{x} stands for a substitution, so no test string holds a real one
const code = (text) => text.replaceAll("#{", "${");
const tokens = (source) => unprefixedClasses(source).map(({ token }) => token);

it("tells a Tailwind utility without the tw: prefix from a prefixed one", () => {
	for (const token of [
		"flex",
		"hidden",
		"px-2",
		"-mt-1",
		"bg-primary/80",
		"w-[calc(100%-1px)]",
		"size-4!",
		"sr-only",
	]) {
		assert.equal(isUnprefixedUtility(token), true, token);
	}
	for (const token of ["tw:flex", "tw:px-2", "!tw:hidden", "tw:-mt-1", "tw:size-4!", "tw:group/button"]) {
		assert.equal(isUnprefixedUtility(token), false, token);
	}
});

it("reads variants: the prefix must come first, before every variant", () => {
	assert.equal(isUnprefixedUtility("data-[state=open]:bg-accent"), true);
	assert.equal(isUnprefixedUtility("hover:md:text-sm"), true);
	assert.equal(isUnprefixedUtility("data-[state=open]:tw:bg-accent"), true);
	assert.equal(isUnprefixedUtility("tw:data-[state=open]:bg-accent"), false);
	assert.equal(isUnprefixedUtility("tw:peer-data-[size=default]/menu-button:top-1.5"), false);
	assert.equal(isUnprefixedUtility("tw:dark:aria-invalid:ring-destructive/40"), false);
});

it("leaves names that are no Tailwind utility alone: Tabler and app classes, slots, words", () => {
	for (const token of [
		"page",
		"container-xl",
		"btn-primary",
		"status-dot",
		"group-label",
		"sidebar",
		"default",
		"open",
	]) {
		assert.equal(isUnprefixedUtility(token), false, token);
	}
});

it("finds unprefixed classes in className, cn() and cva() with their line", () => {
	const source = [
		'<div className="tw:flex px-2 tw:gap-1" />',
		'const x = cn("tw:rounded-md", "data-[state=open]:bg-accent");',
		"const v = cva('tw:inline-flex', { variants: { size: { sm: 'h-8 tw:px-3' } } });",
	].join("\n");
	assert.deepEqual(unprefixedClasses(source), [
		{ line: 1, token: "px-2" },
		{ line: 2, token: "data-[state=open]:bg-accent" },
		{ line: 3, token: "h-8" },
	]);
});

it("reads template literals, skipping substitutions", () => {
	assert.deepEqual(tokens(code("cn(`tw:flex #{open ? 'tw:block' : 'hidden'} mt-2`)")), ["hidden", "mt-2"]);
	assert.deepEqual(tokens(code("cn(`tw:flex #{gap} tw:mt-2`)")), []);
});

it("does not flag attribute values that are names: data-*, aria-*, type, role, id", () => {
	assert.deepEqual(tokens('<div data-sidebar="group-label" data-slot="sidebar-menu-button" />'), []);
	assert.deepEqual(tokens('<input type="hidden" role="separator" aria-orientation="vertical" id="flex-1" />'), []);
});

it("does not flag paths, imports and URLs", () => {
	assert.deepEqual(tokens('import { Button } from "src/ui/button";'), []);
	assert.deepEqual(tokens('const a = "./border-b.js"; const b = "https://x.test/flex-1";'), []);
});

it("checks one-word strings too: a single utility in cn() or className", () => {
	assert.deepEqual(tokens('<div className="flex" />'), ["flex"]);
	assert.deepEqual(tokens('cn("tw:flex", open && "hidden", { truncate: wide })'), ["hidden"]);
	assert.deepEqual(tokens('<div className="tw:flex" />'), []);
	assert.deepEqual(tokens('const side = "right"; const variant = "default"; const t = "open";'), []);
});
