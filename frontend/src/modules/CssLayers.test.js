import assert from "node:assert/strict";
import { it } from "node:test";
import { classesOf, compareWithAllowlist, cssFindings, parseCss, subjectsOf } from "./CssLayers.js";

it("splits CSS into blocks and statements, ignoring comments and braces in strings", () => {
	const css = '@layer a,b;/* } */@layer a{.x{content:"}";color:red}}:root{--c:1}';
	assert.deepEqual(parseCss(css), [
		{ prelude: "@layer a,b" },
		{
			prelude: "@layer a",
			children: [{ prelude: ".x", children: [{ prelude: 'content:"}"' }, { prelude: "color:red" }] }],
		},
		{ prelude: ":root", children: [{ prelude: "--c:1" }] },
	]);
});

it("unescapes class names and finds the element each selector styles", () => {
	assert.deepEqual(classesOf(".tw\\:flex.tw\\:w-\\[calc\\(100\\%-1px\\)\\]"), ["tw:flex", "tw:w-[calc(100%-1px)]"]);
	assert.deepEqual(classesOf(".\\31 0x"), ["10x"]);
	assert.deepEqual(subjectsOf(".a > .b.c, .d:is(.dark *) ~ .e,.f"), [".b.c", ".e", ".f"]);
	assert.deepEqual(subjectsOf('[data-x="a b"] .g'), [".g"]);
});

it("passes a stylesheet whose rules are all in layers and whose utilities all carry the prefix", () => {
	const css = [
		"@layer tabler,theme,base,components,utilities;",
		"@layer tabler{.flex{display:flex}.border{border:1px solid}a:hover{color:red}}",
		"@layer base{@scope ([data-slot]) to ([data-legacy-ui]){*{margin:0}}}",
		"@layer utilities{.tw\\:flex{display:flex}.tw\\:hover\\:bg-accent{@media (hover:hover){&:hover{color:red}}}}",
		"@property --tw-translate-x{syntax:'*';inherits:false}",
	].join("");
	assert.deepEqual(cssFindings(css), []);
});

it("reports a rule outside every layer, inside a media query too, and unlayered keyframes and properties", () => {
	const css = [
		"@layer tabler{.btn{color:red}}",
		".toast{color:red}",
		"@media (prefers-reduced-motion:reduce){.shimmer{animation:none}}",
		"@keyframes pulse{50%{opacity:.5}}",
		"@property --shimmer-angle{syntax:'<angle>';inherits:false}",
		"@layer utilities{@keyframes spin{to{rotate:1turn}}}",
	].join("");
	assert.deepEqual(cssFindings(css), [
		"unlayered: .toast",
		"unlayered: @media (prefers-reduced-motion:reduce) > .shimmer",
		"unlayered: @keyframes pulse",
		"unlayered: @property --shimmer-angle",
		"layered: utilities: @keyframes spin",
	]);
});

it("reports an unprefixed utility class the new UI's layers style, but not Tabler's layer or a condition", () => {
	const css = [
		"@layer tabler{.hidden{display:none}}",
		"@layer utilities{.hidden{display:none}.tw\\:px-2{padding:0}}",
		"@layer components{.card .rounded-md{border-radius:1px}}",
		"@layer utilities{.tw\\:\\[\\.border-b\\]\\:pb-2.border-b{padding:0}.tw\\:group:hover .tw\\:flex{display:flex}}",
		"@layer base{.app-scroll-area{scrollbar-width:none}}",
	].join("");
	assert.deepEqual(cssFindings(css), [
		"unprefixed: utilities: .hidden",
		"unprefixed: components: .card .rounded-md",
		"unprefixed: base: .app-scroll-area",
	]);
});

it("denies by default: a rule of a layer other than Tabler's needs a tw: class in each selector", () => {
	assert.deepEqual(cssFindings("@layer tabler,base;@layer base{*{margin:0}button{color:red}}"), [
		"unprefixed: base: *",
		"unprefixed: base: button",
	]);
	assert.deepEqual(cssFindings("@layer components{.btn{color:red}}"), ["unprefixed: components: .btn"]);
	assert.deepEqual(cssFindings("@layer theme{:root,:host{--tw-x:1}}"), ["unprefixed: theme: :root,:host"]);
	assert.deepEqual(cssFindings("@layer base{@supports (a:b){.tw\\:a,.b{color:red}}}"), [
		"unprefixed: base: .tw\\:a,.b",
	]);
});

it("reports layered keyframes, font faces and properties outside Tabler's layer", () => {
	const css = [
		"@layer utilities{@keyframes pulse{50%{opacity:.5}}}",
		"@layer base{@font-face{font-family:x}@property --a{syntax:'*';inherits:false}}",
		"@layer tabler{@keyframes spinner-border{to{rotate:1turn}}}",
	].join("");
	assert.deepEqual(cssFindings(css), [
		"layered: utilities: @keyframes pulse",
		"layered: base: @font-face",
		"layered: base: @property --a",
	]);
});

it("accepts rules inside @scope and tw: rules with nested selectors", () => {
	const css = [
		"@layer base{@scope ([data-slot]) to ([data-legacy-ui]){*{margin:0}button{color:red}}}",
		"@layer utilities{.tw\\:hover\\:bg-a{&:hover{color:red}@media (hover:hover){&:hover{color:red}}}}",
	].join("");
	assert.deepEqual(cssFindings(css), []);
});

it("names nested layers by their path", () => {
	assert.deepEqual(cssFindings("@layer x{@layer y{.flex{display:flex}}}"), ["unprefixed: x.y: .flex"]);
	assert.deepEqual(cssFindings("@layer tabler{@layer inner{.flex{display:flex}}}"), []);
});

it("compares findings with the allowlist both ways, ignoring comments and blank lines", () => {
	const allowlist = "# shadcn\nunlayered: :root\n\nunlayered: .gone\n";
	assert.deepEqual(compareWithAllowlist(["unlayered: :root", "unlayered: .new"], allowlist), {
		added: ["unlayered: .new"],
		gone: ["unlayered: .gone"],
	});
});
