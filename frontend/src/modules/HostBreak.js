const SEPARATORS = new Set([".", ":"]);

/**
 * Splits a host name after each dot and colon, keeping the separator on the part before it, so a line break can go
 * between the parts: "a.example.com:80" -> ["a.", "example.", "com:", "80"]
 *
 * @param {string} value
 * @returns {string[]}
 */
const hostParts = (value) => {
	const parts = [];
	let current = "";
	for (const char of value) {
		current += char;
		if (SEPARATORS.has(char)) {
			parts.push(current);
			current = "";
		}
	}
	if (current !== "") parts.push(current);
	return parts;
};

export { hostParts };
