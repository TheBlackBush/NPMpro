import { createRequire } from "node:module";

// the nginxbeautifier module the image ships (pinned and checked by sha256 in the Dockerfile)
const BEAUTIFIER_MODULE = "/usr/local/bin/nginxbeautifier.js";
const INDENTATION = "  ";

// nginxbeautifier misreads braces, quotes, `$` patterns and escapes inside a quoted custom location path (crash,
// silent rewrite of the path); such configs are written unformatted
const BEAUTIFIER_UNSAFE_LOCATION = /^\s*location\s[^\n]*"[^\n]*[{}'$;#][^\n]*"/mu;

let loaded;

/**
 * Loads the beautifier module once; null when it is missing (outside the image) or cannot be loaded
 *
 * @param   {String} [file]
 * @returns {Object|null}
 */
const loadBeautifier = (file = BEAUTIFIER_MODULE) => {
	if (loaded !== undefined) return loaded;
	try {
		loaded = createRequire(import.meta.url)(file);
		loaded.modifyOptions({ INDENTATION });
	} catch {
		loaded = null;
	}
	return loaded;
};

/**
 * The same steps as `nginxbeautifier -s 2 <file>`, on a string and in this process; the text as it is when the
 * beautifier is missing, the config holds a path it misreads, or it fails
 *
 * @param   {Object|null} beautifier  the module (clean_lines, join_opening_bracket, perform_indentation)
 * @param   {String}      text
 * @returns {String}
 */
const beautifyWith = (beautifier, text) => {
	if (!beautifier || BEAUTIFIER_UNSAFE_LOCATION.test(text)) return text;
	try {
		let lines = beautifier.clean_lines(text);
		lines = beautifier.join_opening_bracket(lines);
		lines = beautifier.perform_indentation(lines);
		return lines.join("\n");
	} catch {
		return text;
	}
};

/**
 * @param   {String} text
 * @returns {String}
 */
const beautify = (text) => beautifyWith(loadBeautifier(), text);

export { BEAUTIFIER_UNSAFE_LOCATION, beautify, beautifyWith, loadBeautifier };
