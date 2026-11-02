// Finds Tailwind utility classes without the tw: prefix in the new UI's source files (scripts/check-tw-prefix.js) and
// in the built stylesheet (CssLayers.js). Tailwind only generates tw: classes, so an unprefixed one styles nothing
// or, worse, hits the Bootstrap or Tabler class of the same name (hidden, border, rounded, shadow, container).

// a token that looks like a Tailwind utility, with any variants in front (hover:, data-[state=open]:, md:)
const UTILITY =
	/^-?(?:[^\s:]+:)*(?:flex|grid|hidden|block|inline|contents|absolute|relative|fixed|sticky|truncate|underline|uppercase|italic|sr-only|grow|shrink|(?:inline-)?(?:flex|grid|block)|(?:flex|grid|bg|text|border|rounded|shadow|ring|outline|font|leading|tracking|p[xytrblse]?|m[xytrblse]?|w|h|size|min-w|min-h|max-w|max-h|gap|gap-x|gap-y|space-x|space-y|items|justify|self|content|place|top|right|bottom|left|inset|inset-x|inset-y|start|end|z|opacity|cursor|overflow|overflow-x|overflow-y|translate-x|translate-y|scale|rotate|transition|duration|ease|animate|fill|stroke|col-span|row-span|grid-cols|grid-rows|order|basis|aspect|object|whitespace|break|line-clamp|select|pointer-events)-[^\s"'`]+)!?$/u;
// the prefix comes first, before every variant (Tailwind v4); `!` in front is the old important modifier
const PREFIXED = /^!?tw:/u;
// string and template literals; a template literal may span lines
const LITERAL = /"(?<double>(?:[^"\\\n]|\\.)*)"|'(?<single>(?:[^'\\\n]|\\.)*)'|`(?<template>(?:[^`\\]|\\.)*)`/gu;
const WHITESPACE = /\s+/u;
// paths, imports and URLs are not class lists
const NOT_CLASSES = /^(?:\.|\/|src\/|@|node:|https?:)/u;
// attribute values such as data-sidebar="group-label" or type="hidden" are names, not classes
const NAME_ATTRIBUTE = /\b(?:(?:data|aria)-[\w-]+|id|name|type|role|htmlFor|key)=\{?$/u;

/**
 * Whether a class name is a Tailwind utility without the tw: prefix
 *
 * @param {string} token
 * @returns {boolean}
 */
export const isUnprefixedUtility = (token) => !PREFIXED.test(token) && UTILITY.test(token);

/**
 * A template literal's text without its substitutions, and the substitutions' code (read as code of their own: the
 * strings inside `${open ? "tw:block" : "hidden"}` are class lists too)
 *
 * @param {string} template
 * @returns {{ text: string, code: string[] }}
 */
const splitTemplate = (template) => {
	let text = "";
	const code = [];
	let i = 0;
	while (i < template.length) {
		if (template[i] === "\\") {
			text += template.slice(i, i + 2);
			i += 2;
		} else if (template.startsWith("${", i)) {
			let depth = 1;
			let j = i + 2;
			while (j < template.length && depth > 0) {
				if (template[j] === "{") depth++;
				if (template[j] === "}") depth--;
				j++;
			}
			code.push(template.slice(i + 2, j - 1));
			text += " ";
			i = j;
		} else {
			text += template[i];
			i++;
		}
	}
	return { text, code };
};

/**
 * Every unprefixed Tailwind class in a source file's string and template literals (className, cn() and cva() alike).
 * Strings in code that are no class lists rarely name a utility; one that does (position = "fixed") is reported too.
 *
 * @param {string} source
 * @returns {{ line: number, token: string }[]}
 */
export const unprefixedClasses = (source) => {
	const found = [];
	for (const match of source.matchAll(LITERAL)) {
		const line = source.slice(0, match.index).split("\n").length;
		const { double, single, template } = match.groups;
		let value = double ?? single;
		if (value === undefined) {
			const { text, code } = splitTemplate(template);
			value = text;
			for (const part of code) {
				for (const inner of unprefixedClasses(part))
					found.push({ line: line + inner.line - 1, token: inner.token });
			}
		}
		// a one-word string that names a utility (open && "hidden") counts as a class list
		const names =
			NOT_CLASSES.test(value) || NAME_ATTRIBUTE.test(source.slice(Math.max(0, match.index - 40), match.index));
		for (const token of names ? [] : value.split(WHITESPACE)) {
			if (token && isUnprefixedUtility(token)) found.push({ line, token });
		}
	}
	return found.sort((a, b) => a.line - b.line);
};
