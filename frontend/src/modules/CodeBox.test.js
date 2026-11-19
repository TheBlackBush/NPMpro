import assert from "node:assert/strict";
import { it } from "node:test";
import { CODE_WRAPS, codeBoxClass, codeWords, LONG_WORD } from "./CodeBox.js";

const WORDS_PRE = /whitespace-pre-wrap/u;
const SCROLL_PRE = /overflow-x-auto whitespace-pre/u;

it("codeWords splits at spaces and keeps the spaces as their own pieces", () => {
	assert.deepEqual(codeWords("claude mcp add"), [
		{ key: 0, text: "claude", kind: "word" },
		{ key: 6, text: " ", kind: "space" },
		{ key: 7, text: "mcp", kind: "word" },
		{ key: 10, text: " ", kind: "space" },
		{ key: 11, text: "add", kind: "word" },
	]);
});

it("a word longer than LONG_WORD may break, a shorter one never does", () => {
	const token = `npmpro_${"a".repeat(60)}`;
	assert.equal(LONG_WORD, 32);
	assert.deepEqual(
		codeWords(`Bearer ${token}`).map((piece) => piece.kind),
		["word", "space", "long"],
	);
	assert.equal(codeWords("x".repeat(32))[0].kind, "word");
	assert.equal(codeWords("x".repeat(33))[0].kind, "long");
	assert.equal(codeWords("abcd", 3)[0].kind, "long");
});

it("double spaces stay, keys stay unique", () => {
	const pieces = codeWords("a  b");
	assert.equal(pieces.map((piece) => piece.text).join(""), "a  b");
	assert.equal(new Set(pieces.map((piece) => piece.key)).size, pieces.length);
	assert.deepEqual(codeWords(""), []);
});

it("codeBoxClass: words wrap, scroll scrolls; an unknown wrap throws", () => {
	assert.deepEqual(CODE_WRAPS, ["words", "scroll"]);
	assert.match(codeBoxClass("words").pre, WORDS_PRE);
	assert.match(codeBoxClass().pre, WORDS_PRE);
	assert.match(codeBoxClass("scroll").pre, SCROLL_PRE);
	assert.equal(codeBoxClass("words").piece.word, "whitespace-nowrap");
	assert.equal(codeBoxClass("words").piece.long, "[overflow-wrap:anywhere]");
	assert.throws(() => codeBoxClass("wrap"), TypeError);
});
