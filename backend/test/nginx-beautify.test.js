import assert from "node:assert/strict";
import { it } from "node:test";
import { beautifyWith } from "../lib/nginx-beautify.js";

// a stand-in with the module's three steps: trims lines, indents by brace depth
const fake = {
	clean_lines: (text) => text.split("\n").map((line) => line.trim()),
	join_opening_bracket: (lines) => lines,
	perform_indentation: (lines) => {
		let depth = 0;
		return lines.map((line) => {
			if (line.startsWith("}")) depth--;
			const out = `${"  ".repeat(Math.max(depth, 0))}${line}`;
			if (line.endsWith("{")) depth++;
			return out;
		});
	},
};

it("formats a config in process with the module's steps", () => {
	assert.equal(beautifyWith(fake, "server {\nlisten 80;\n}"), "server {\n  listen 80;\n}");
});

it("returns the text as it is when the module is missing or fails", () => {
	assert.equal(beautifyWith(null, "server {\nlisten 80;\n}"), "server {\nlisten 80;\n}");
	const broken = {
		...fake,
		perform_indentation: () => {
			throw new TypeError("x");
		},
	};
	assert.equal(beautifyWith(broken, "a {\nb;\n}"), "a {\nb;\n}");
});

it("leaves configs with a quoted location path it would misread unformatted", () => {
	const text = 'server {\nlocation ~ "^/api/\\\\d{3}$" {\nreturn 200;\n}\n}';
	assert.equal(beautifyWith(fake, text), text);
});
