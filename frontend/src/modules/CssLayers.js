// Reads a built stylesheet and lists what could reach the old Tabler pages from outside Tabler's cascade layer: every
// rule that is in no cascade layer (it beats every layered rule, Tabler's too) and every rule of the new
// UI's layers (outside an @scope block) whose selector has no tw: class, or that is a layered @keyframes, @font-face or
// @property (they all beat Tabler's layer on the old pages). Used by scripts/check-built-css.js after `vite build`.
import { isUnprefixedUtility } from "./TailwindPrefix.js";

const TABLER_LAYER = "tabler";
const WHITESPACE = /\s+/gu;
const CLASS = /\.(?<name>(?:\\[0-9a-fA-F]{1,6} ?|\\.|[\w-])+)/gu;
const ESCAPE = /\\(?<hex>[0-9a-fA-F]{1,6}) ?|\\(?<char>.)/gu;

/**
 * Splits CSS into rules: { prelude, children } for a block, { prelude } for a statement or declaration. Comments are
 * dropped; strings and escapes are kept as they are, so a brace inside them does not count.
 *
 * @param {string} css
 * @returns {{ prelude: string, children?: object[] }[]}
 */
export const parseCss = (css) => {
	const root = [];
	const stack = [root];
	const clean = (text) => text.trim().replace(WHITESPACE, " ");
	let prelude = "";
	let i = 0;
	while (i < css.length) {
		const char = css[i];
		if (char === "/" && css[i + 1] === "*") {
			const end = css.indexOf("*/", i + 2);
			i = end === -1 ? css.length : end + 2;
		} else if (char === "\\") {
			prelude += css.slice(i, i + 2);
			i += 2;
		} else if (char === '"' || char === "'") {
			let j = i + 1;
			while (j < css.length && css[j] !== char) j += css[j] === "\\" ? 2 : 1;
			prelude += css.slice(i, j + 1);
			i = j + 1;
		} else {
			const current = stack.at(-1);
			if (char === "{") {
				const node = { prelude: clean(prelude), children: [] };
				current.push(node);
				stack.push(node.children);
				prelude = "";
			} else if (char === ";" || char === "}") {
				if (prelude.trim()) current.push({ prelude: clean(prelude) });
				prelude = "";
				if (char === "}" && stack.length > 1) stack.pop();
			} else {
				prelude += char;
			}
			i++;
		}
	}
	return root;
};

/** The class names of a selector, unescaped (`.tw\:flex` is `tw:flex`) */
export const classesOf = (selector) =>
	[...selector.matchAll(CLASS)].map((match) =>
		match.groups.name.replace(ESCAPE, (...args) => {
			const { hex, char } = args.at(-1);
			return hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char;
		}),
	);

/**
 * The last compound selector of each selector of a list (`.a > .b.c, .d` gives `.b.c` and `.d`): the element a rule
 * styles. Classes before a combinator only say where that element is.
 */
export const subjectsOf = (selectorList) => {
	const subjects = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i <= selectorList.length; i++) {
		const char = selectorList[i];
		if (char === "\\") {
			i++;
		} else if (char === "(" || char === "[") {
			depth++;
		} else if (char === ")" || char === "]") {
			depth--;
		} else if (depth === 0 && (char === " " || char === ">" || char === "+" || char === "~")) {
			start = i + 1;
		} else if (depth === 0 && (char === "," || char === undefined)) {
			subjects.push(selectorList.slice(start, i).trim());
			start = i + 1;
		}
	}
	return subjects.filter(Boolean);
};

/** The selectors of a selector list, split at the commas outside brackets and parentheses */
const splitSelectors = (selectorList) => {
	const selectors = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i <= selectorList.length; i++) {
		const char = selectorList[i];
		if (char === "\\") {
			i++;
		} else if (char === "(" || char === "[") {
			depth++;
		} else if (char === ")" || char === "]") {
			depth--;
		} else if (depth === 0 && (char === "," || char === undefined)) {
			selectors.push(selectorList.slice(start, i).trim());
			start = i + 1;
		}
	}
	return selectors.filter(Boolean);
};

// a rule reaches an old page's element when the element it styles needs no tw: class, only an unprefixed utility one
const leaks = (selectorList) =>
	subjectsOf(selectorList).some((subject) => {
		const names = classesOf(subject);
		return names.some(isUnprefixedUtility) && !names.some((name) => name.startsWith("tw:"));
	});

// at-rules whose block holds rules and that do not change the layer
const GROUPING = /^@(?:media|supports|container|scope|starting-style|document)\b/u;

/**
 * Every finding of a built stylesheet, one line each, in the order of the stylesheet, without repeats:
 * `unlayered: <context > selector or at-rule>`, `unprefixed: <layer>: <selector>` (a rule of a layer other than
 * Tabler's, outside an @scope block, with a selector that has no tw: class, or an unprefixed utility class as the
 * element it styles) and `layered: <layer>: <at-rule>` (@keyframes, @font-face, @property ... in such a layer)
 *
 * @param {string} css
 * @returns {string[]}
 */
export const cssFindings = (css) => {
	const findings = new Set();
	const hasPrefix = (selector) => classesOf(selector).some((name) => name.startsWith("tw:"));
	// a selector list needs a tw: class in each of its selectors: the others reach the elements of the old pages
	const denied = (selectorList) => splitSelectors(selectorList).some((selector) => !hasPrefix(selector));
	// `nested`: inside a style rule (`&:hover`, `@media`), whose own selector was already checked
	const walk = (nodes, layer, context, scoped, nested) => {
		// statements (`@layer a, b;`, `@import`) and declarations style nothing on their own
		for (const node of nodes.filter((child) => child.children)) {
			const where = [...context, node.prelude].join(" > ");
			const outside = layer && layer.split(".")[0] !== TABLER_LAYER;
			if (node.prelude.startsWith("@layer")) {
				const name = node.prelude.slice("@layer".length).trim() || "(anonymous)";
				walk(node.children, layer ? `${layer}.${name}` : name, context, scoped, nested);
			} else if (GROUPING.test(node.prelude)) {
				// outside the layers the rules inside are reported with their context (`@media (...) > .x`)
				const inScope = scoped || node.prelude.startsWith("@scope");
				walk(node.children, layer, layer ? context : [...context, node.prelude], inScope, nested);
			} else if (node.prelude.startsWith("@")) {
				// @keyframes, @font-face, @property, @page: a whole rule of its own. Tailwind registers its own custom
				// properties (--tw-*) outside the layers, one per utility in use; Tabler's are --tblr-* and --bs-*.
				if (!layer) {
					if (!node.prelude.startsWith("@property --tw-")) findings.add(`unlayered: ${where}`);
				} else if (outside) {
					findings.add(`layered: ${layer}: ${node.prelude}`);
				}
			} else if (layer) {
				if (outside && ((!(nested || scoped) && denied(node.prelude)) || leaks(node.prelude))) {
					findings.add(`unprefixed: ${layer}: ${node.prelude}`);
				}
				walk(node.children, layer, context, scoped, true);
			} else {
				findings.add(`unlayered: ${where}`);
			}
		}
	};
	walk(parseCss(css), "", [], false, false);
	return [...findings];
};

/**
 * Compares the findings with the allowlist (one finding per line, `#` starts a comment, blank lines ignored)
 *
 * @param {string[]} findings
 * @param {string} allowlist
 * @returns {{ added: string[], gone: string[] }} findings not in the list, and listed lines the build no longer has
 */
export const compareWithAllowlist = (findings, allowlist) => {
	const allowed = new Set(
		allowlist
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#")),
	);
	const found = new Set(findings);
	return {
		added: findings.filter((finding) => !allowed.has(finding)),
		gone: [...allowed].filter((line) => !found.has(line)),
	};
};
