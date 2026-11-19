/**
 * Rules of the code box (components/CodeBox.jsx): how a one-line command wraps and the classes of the box. Pure, so
 * node --test checks them without a DOM. The classes are written out whole so Tailwind finds them.
 */
import { cn } from "../lib/utils.js";

/** A word longer than this (characters) may break inside; about the width of a 390 px phone line in the box */
export const LONG_WORD = 32;

/** words: a one-line command that wraps only between its words; scroll: text that keeps its lines (JSON) */
export const CODE_WRAPS = Object.freeze(["words", "scroll"]);

/**
 * The pieces of a one-line text: its words and the spaces between them, keyed by their offset
 *
 * @param   {string} text
 * @param   {number} [longAt]
 * @returns {{ key: number, text: string, kind: "word"|"long"|"space" }[]}
 */
export const codeWords = (text, longAt = LONG_WORD) => {
	const pieces = [];
	let offset = 0;
	for (const [index, word] of text.split(" ").entries()) {
		if (index > 0) {
			pieces.push({ key: offset, text: " ", kind: "space" });
			offset += 1;
		}
		if (word !== "") pieces.push({ key: offset, text: word, kind: word.length > longAt ? "long" : "word" });
		offset += word.length;
	}
	return pieces;
};

/**
 * The classes of a code box: the muted box, the text (room on the right for the copy button), the copy button in the
 * top right corner, and per piece of a words box
 *
 * @param   {"words"|"scroll"} [wrap]
 * @returns {{ box: string, pre: string, copy: string, piece: { word: string, long: string, space: string } }}
 */
export function codeBoxClass(wrap = "words") {
	if (!CODE_WRAPS.includes(wrap)) throw new TypeError(`unknown code wrap "${wrap}"`);
	return {
		box: "relative min-w-0 rounded-lg border bg-muted",
		pre: cn(
			"m-0 py-2 ps-3 pe-11 font-mono text-[12.5px] leading-relaxed [font-variant-ligatures:none]",
			wrap === "scroll" ? "overflow-x-auto whitespace-pre" : "whitespace-pre-wrap",
		),
		copy: "absolute top-1 right-1",
		piece: { word: "whitespace-nowrap", long: "[overflow-wrap:anywhere]", space: "" },
	};
}
