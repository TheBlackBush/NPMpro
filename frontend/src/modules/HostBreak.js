// a host name and port break after a dot or colon, an e-mail address also after the @
const HOST_SEPARATORS = ".:@";

/**
 * Splits a value after each separator, keeping the separator on the part before it, so a line break can go between
 * the parts: "a.example.com:80" -> ["a.", "example.", "com:", "80"]
 *
 * @param {string} value
 * @param {string} [separators]  the characters to split after, by default dot, colon and @
 * @returns {string[]}
 */
const hostParts = (value, separators = HOST_SEPARATORS) => {
	const parts = [];
	let current = "";
	for (const char of value) {
		current += char;
		if (separators.includes(char)) {
			parts.push(current);
			current = "";
		}
	}
	if (current !== "") parts.push(current);
	return parts;
};

export { hostParts };
