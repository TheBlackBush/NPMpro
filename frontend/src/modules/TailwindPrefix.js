// Finds Tailwind utility classes without the tw: prefix in the new UI's source files (scripts/check-tw-prefix.js) and
// in the built stylesheet (CssLayers.js). Tailwind only generates tw: classes, so an unprefixed one styles nothing
// or, worse, hits the Bootstrap or Tabler class of the same name (hidden, border, rounded, shadow, container).
//
// The source is read with a real parser (@babel/parser): string and template literals are found wherever they are
// (className, cn(), cva(), nested templates), comments and JSX text never are. TailwindPrefix.classes.test.js checks
// the utility lists below against Tailwind's own class list, so a Tailwind upgrade cannot open a gap unnoticed.
import { parse } from "@babel/parser";

// utilities that are a whole class on their own (flex, hidden, border, rounded...); a modifier (`/name`) may follow
const BARE = new Set(
	"@container absolute antialiased block blur border capitalize collapse container contents fixed flex grayscale grid grow hidden inline invert invisible isolate italic lowercase ordinal outline overline paused relative resize ring rounded running sepia shadow shimmer shrink static sticky table transform transition truncate underline uppercase visible".split(
		" ",
	),
);
// first word of the utilities that continue after a dash (px-2, shrink-0, fade-in-0, divide-y, -mt-1...)
const ROOTS = new Set(
	"@container accent align animate animation appearance aspect auto backdrop backface basis bg block blur border bottom box break brightness caption caret clear col columns contain content contrast cursor decoration delay diagonal direction divide drop duration ease end fade field fill flex float flow font forced from gap grayscale grid grow h hue hyphens indent inline inset invert isolation items justify leading left line lining list m mask max mb mbe mbs me min mix ml mr ms mt mx my no normal not object oldstyle opacity order origin outline overflow overscroll p pb pbe pbs pe perspective pl place placeholder play pointer pr proportional ps pt px py repeat resize right ring rotate rounded row saturate scale scheme scroll scrollbar select self sepia shadow shimmer shrink size skew slashed slide snap space spin sr stacked start stroke subpixel tab table tabular text to top touch tracking transform transition translate underline via w whitespace will wrap z zoom".split(
		" ",
	),
);
// an arbitrary property: [mask-type:alpha]
const ARBITRARY_PROPERTY = /^\[[\w-]+:\S+\]$/u;
const WHITESPACE = /\s+/u;
const LEADING_BANG = /^!/u;
const TRAILING_BANG = /!$/u;
const LEADING_DASH = /^-/u;
// paths, imports and URLs are not class lists
const NOT_CLASSES = /^(?:\.|\/|src\/|node:|https?:)/u;
// attribute values such as data-sidebar="group-label", type="hidden" or variant="outline" or align="inline-start" are names, not classes
const NAME_ATTRIBUTE = /^(?:(?:data|aria)-[\w-]+|id|name|type|role|htmlFor|key|variant|align)$/u;
const IMPORT_NODE = /^(?:Import|Export\w*)Declaration$/u;
const IGNORE_COMMENT = "tw-prefix-ignore";
const SKIPPED_KEYS = new Set(["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"]);

/**
 * The parts of a class name between its variants (`:` outside brackets): hover:data-[a=b]:flex -> three parts
 *
 * @param {string} token
 * @returns {string[]}
 */
const splitVariants = (token) => {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < token.length; i++) {
		const char = token[i];
		if (char === "[" || char === "(") depth++;
		else if (char === "]" || char === ")") depth--;
		else if (char === ":" && depth === 0) {
			parts.push(token.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(token.slice(start));
	return parts;
};

/**
 * Whether a class name is a Tailwind utility without the tw: prefix. The prefix must come first, before every variant
 * (Tailwind v4); `!` (important) and `-` (negative) are read on the utility, after the variants.
 *
 * @param {string} token
 * @returns {boolean}
 */
export const isUnprefixedUtility = (token) => {
	const parts = splitVariants(token);
	if (parts.length > 1 && parts[0].replace(LEADING_BANG, "") === "tw") return false;
	const utility = parts.at(-1).replace(LEADING_BANG, "").replace(TRAILING_BANG, "").replace(LEADING_DASH, "");
	if (BARE.has(utility.split("/")[0]) || ARBITRARY_PROPERTY.test(utility)) return true;
	const dash = utility.indexOf("-");
	return dash > 0 && dash < utility.length - 1 && ROOTS.has(utility.slice(0, dash));
};

/**
 * @param {{ type: string, name?: string, value?: unknown }} key
 * @returns {string}
 */
const propertyName = (key) => (key.type === "Identifier" ? key.name : String(key.value));

/**
 * { variant: "outline" } or { type: "hidden" }: a name, as the attribute of the same name is. An object or a template
 * under that key (cva's `align: { "inline-start": "..." }`) is read.
 *
 * @param {{ type: string, computed?: boolean, key?: { type: string, name?: string, value?: unknown }, value?: { type: string } }} node
 * @returns {boolean}
 */
const isNameProperty = ({ type, computed, key, value }) =>
	type === "ObjectProperty" && !computed && value.type === "StringLiteral" && NAME_ATTRIBUTE.test(propertyName(key));

/**
 * A default parameter such as `align = "inline-start"` or `variant = "default"` in a component's props.
 *
 * @param {{ type: string, left?: { type: string, name?: string }, right?: { type: string } }} node
 * @returns {boolean}
 */
const isNameDefault = ({ type, left, right }) =>
	type === "AssignmentPattern" &&
	left.type === "Identifier" &&
	right.type === "StringLiteral" &&
	NAME_ATTRIBUTE.test(left.name);

/**
 * A quoted key whose value is a class string names a variant (cva: `"inline-start": "tw:order-first"`); one whose value
 * is a condition is a class list (clsx: `{ "px-2": open }`) and is read.
 *
 * @param {{ computed: boolean, key: { type: string }, value: { type: string } }} property
 * @returns {boolean}
 */
const isVariantMapEntry = ({ computed, key, value }) =>
	!computed && key.type === "StringLiteral" && (value.type === "StringLiteral" || value.type === "TemplateLiteral");

/**
 * Each whitespace separated word of a text with the line it is on (the text starts on `firstLine`). With `partial`,
 * a first or last word that touches a template substitution is left out: it is only a piece of a class name.
 *
 * @param {string} text
 * @param {number} firstLine
 * @param {number} firstColumn
 * @param {{ skipFirst?: boolean, skipLast?: boolean }} partial
 * @returns {{ line: number, column: number, token: string }[]}
 */
const wordsOf = (text, firstLine, firstColumn, { skipFirst = false, skipLast = false } = {}) => {
	const words = [];
	for (const match of text.matchAll(/\S+/gu)) {
		const before = text.slice(0, match.index).split("\n");
		words.push({
			line: firstLine + before.length - 1,
			column: before.at(-1).length + (before.length === 1 ? firstColumn : 0),
			token: match[0],
		});
	}
	if (skipFirst && words.length > 0 && text.length > 0 && !WHITESPACE.test(text[0])) words.shift();
	if (skipLast && words.length > 0 && !WHITESPACE.test(text.at(-1))) words.pop();
	return words;
};

/**
 * Every unprefixed Tailwind class in a source file's string and template literals (className, cn() and cva() alike).
 * Strings in code that are no class lists rarely name a utility; one that does (position = "fixed") is reported too:
 * a comment that reads tw-prefix-ignore (a line comment, or a block comment inside braces in JSX) on the line above
 * leaves the next line out.
 *
 * @param {string} source
 * @returns {{ line: number, token: string }[]}
 */
export const unprefixedClasses = (source) => {
	const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
	const ignored = new Set(
		ast.comments
			.filter((comment) => comment.value.trim() === IGNORE_COMMENT)
			.map((comment) => comment.loc.end.line + 1),
	);
	const found = [];
	const report = (words) => {
		for (const { line, column, token } of words) {
			if (!ignored.has(line) && isUnprefixedUtility(token)) found.push({ line, column, token });
		}
	};
	const visit = (node) => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
		} else if (node && typeof node.type === "string") {
			if (node.type === "StringLiteral") {
				if (!NOT_CLASSES.test(node.value))
					report(wordsOf(node.value, node.loc.start.line, node.loc.start.column + 1));
			} else if (node.type === "TemplateLiteral") {
				node.quasis.forEach((quasi, index) => {
					report(
						wordsOf(quasi.value.raw, quasi.loc.start.line, quasi.loc.start.column, {
							skipFirst: index > 0,
							skipLast: index < node.quasis.length - 1,
						}),
					);
				});
				visit(node.expressions);
			} else if (node.type === "JSXAttribute") {
				if (!(node.name.type === "JSXIdentifier" && NAME_ATTRIBUTE.test(node.name.name))) visit(node.value);
			} else if (isNameProperty(node) || isNameDefault(node)) {
				// { variant: "outline" } names a variant, as the variant attribute does
			} else if (node.type === "ObjectProperty" && isVariantMapEntry(node)) {
				visit(node.value);
			} else {
				const isImport = IMPORT_NODE.test(node.type);
				const isRequire =
					node.type === "CallExpression" &&
					(node.callee.type === "Import" ||
						(node.callee.type === "Identifier" && node.callee.name === "require"));
				for (const [key, child] of Object.entries(node)) {
					const skipped =
						SKIPPED_KEYS.has(key) ||
						(isImport && (key === "source" || key === "attributes")) ||
						(isRequire && key === "arguments");
					if (!skipped) visit(child);
				}
			}
		}
	};
	visit(ast.program);
	return found.sort((a, b) => a.line - b.line || a.column - b.column).map(({ line, token }) => ({ line, token }));
};
