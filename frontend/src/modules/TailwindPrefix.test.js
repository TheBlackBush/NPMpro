import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { isUnprefixedUtility, NEW_UI_PATHS, unprefixedClasses } from "./TailwindPrefix.js";

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

it("flags the bare utilities and the families the first matcher missed", () => {
	for (const token of [
		"border",
		"rounded",
		"shadow",
		"ring",
		"outline",
		"transition",
		"container",
		"static",
		"invisible",
		"table",
		"transform",
		"isolate",
		"antialiased",
		"blur",
		"shrink-0",
		"grow-0",
		"animate-in",
		"fade-in-0",
		"zoom-out-95",
		"slide-in-from-top-2",
		"slide-out-to-left",
		"spin-in-180",
		"origin-top-right",
		"divide-y",
		"backdrop-blur-sm",
		"blur-sm",
		"list-none",
		"decoration-2",
		"underline-offset-4",
		"touch-none",
		"tabular-nums",
		"hover:-mt-1",
		"!flex",
		"flex!",
		"hover:!flex",
		"[mask-type:alpha]",
	]) {
		assert.equal(isUnprefixedUtility(token), true, token);
	}
	for (const token of ["!tw:flex", "tw:hover:-mt-1", "tw:shrink-0", "tw:border", "tw:fade-in-0", "container-xl"]) {
		assert.equal(isUnprefixedUtility(token), false, token);
	}
});

it("ignores comments and JSX text: an apostrophe there does not hide a class", () => {
	const source = "const a = <><p>Don't do it</p> <div className=\"flex\" /> it's</>;";
	assert.deepEqual(tokens(source), ["flex"]);
	assert.deepEqual(tokens('// "hidden" and `flex` in a comment\n/* "border" */ const a = 1;'), []);
	assert.deepEqual(tokens("const a = <p>hidden border flex</p>;"), []);
});

it("reads nested template literals and reports the right line", () => {
	assert.deepEqual(tokens(code("cn(`tw:flex #{a ? `hidden` : ''} mt-2`)")), ["hidden", "mt-2"]);
	const source = code(
		"const x = cn(\n\t`tw:flex\n\ttw:gap-1\n\tpx-2 #{open ? 'tw:block' : 'rounded'}`,\n\t'border',\n);",
	);
	assert.deepEqual(unprefixedClasses(source), [
		{ line: 4, token: "px-2" },
		{ line: 4, token: "rounded" },
		{ line: 5, token: "border" },
	]);
});

it("leaves a class piece that touches a substitution alone", () => {
	assert.deepEqual(tokens(code("cn(`tw:p-#{n} #{side}-flex tw:mt-2`)")), []);
});

it("skips the variant attribute and defaultVariants: names, not classes", () => {
	assert.deepEqual(tokens('<Button variant="outline" size="sm" />'), []);
	assert.deepEqual(tokens('const d = { defaultVariants: { variant: "outline", align: "inline-start" } };'), []);
	assert.deepEqual(tokens('<Addon align="block-end" />'), []);
	assert.deepEqual(tokens('function Addon({ className, align = "inline-start", ...props }) {}'), []);
	assert.deepEqual(
		tokens('const v = { align: { "inline-start": "tw:order-first px-2", "block-end": "tw:w-full" } };'),
		["px-2"],
	);
	assert.deepEqual(tokens('cn({ "px-2": open, "tw:flex": true })'), ["px-2"]);
});

it("leaves the line below a tw-prefix-ignore comment out", () => {
	const source = [
		"// tw-prefix-ignore",
		'const position = "fixed";',
		'const other = "fixed";',
		"const a = <div>",
		"\t{/* tw-prefix-ignore */}",
		'\t<span className="hidden" />',
		'\t<span className="hidden" />',
		"</div>;",
	].join("\n");
	assert.deepEqual(unprefixedClasses(source), [
		{ line: 3, token: "fixed" },
		{ line: 7, token: "hidden" },
	]);
});

it("does not take the paths of a dynamic import or require for classes", () => {
	assert.deepEqual(tokens('const m = await import("border"); const r = require("flex");'), []);
	assert.deepEqual(tokens('export { x } from "hidden"; export * from "border";'), []);
});

it("throws on source that does not parse", () => {
	assert.throws(() => unprefixedClasses("const a = ;"));
});

it("the script skips *.test.js and *.test.jsx files, reports line numbers, honors the ignore comment", () => {
	const dir = mkdtempSync(join(tmpdir(), "tw-prefix-"));
	try {
		writeFileSync(join(dir, "a.jsx"), 'export const A = () => <div className="tw:flex hidden" />;\n');
		writeFileSync(join(dir, "b.test.jsx"), 'export const B = () => <div className="hidden" />;\n');
		writeFileSync(join(dir, "c.test.js"), 'export const c = "hidden";\n');
		writeFileSync(join(dir, "d.js"), '// tw-prefix-ignore\nexport const d = "fixed";\n');
		const script = fileURLToPath(new URL("../../scripts/check-tw-prefix.js", import.meta.url));
		const run = spawnSync(process.execPath, [script, dir], { cwd: dir, encoding: "utf8" });
		assert.equal(run.status, 1);
		assert.ok(run.stdout.startsWith("a.jsx:1: hidden\n1 findings"), run.stdout);
		assert.ok(!(run.stdout.includes("test.js") || run.stdout.includes("d.js")), run.stdout);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("checks the new UI by default, and the new UI passes", () => {
	const layer = ["FormField", "FormSection", "SwitchList", "SwitchField", "ChoiceGroup", "PasswordInput"];
	layer.push("NginxConfigField", "FormSubmit", "FormErrorNote", "HookForm", "CodeInput");
	for (const path of ["src/components/PageHeader.jsx", ...layer.map((name) => `src/components/Form/${name}.jsx`)]) {
		assert.ok(NEW_UI_PATHS.includes(path), path);
	}
	const frontend = fileURLToPath(new URL("../..", import.meta.url));
	for (const path of NEW_UI_PATHS) assert.ok(existsSync(join(frontend, path)), `${path} exists`);
	const script = fileURLToPath(new URL("../../scripts/check-tw-prefix.js", import.meta.url));
	const run = spawnSync(process.execPath, [script], { cwd: frontend, encoding: "utf8" });
	assert.equal(run.status, 0, run.stdout);
});
