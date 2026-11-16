// Dev check, not part of CI: the contrast of every tag tone's text on its badge background, light and dark, base and
// hover, computed from the tokens and the color-mix() percentages of src/styles/globals.css (oklab mixes).
// Usage: node scripts/tag-contrast.js   (exit 1 when a ratio is below 4.5)
import { readFileSync } from "node:fs";
import process from "node:process";

const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const TONES = 10;
const MIN = 4.5;
const CARD = { light: 1, dark: 0.205 }; // --card: oklch(L 0 0), a neutral grey

const hex = (value) => [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (c) => Math.min(1, Math.max(0, c));

function toOklab([r, g, b]) {
	const [lr, lg, lb] = [r, g, b].map(toLinear);
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function fromOklab([L, a, b]) {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	].map((c) => clamp(fromLinear(clamp(c))));
}

// color-mix(in oklab, from percent%, to)
const mix = (from, percent, to) => {
	const [x, y] = [toOklab(from), toOklab(to)];
	return fromOklab(x.map((v, i) => v * (percent / 100) + y[i] * (1 - percent / 100)));
};

const luminance = (rgb) => {
	const [r, g, b] = rgb.map(toLinear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

const block = (selector) => css.slice(css.indexOf(`\n${selector} {`)).split("\n}\n")[0];
const tokens = (text) =>
	Object.fromEntries(
		[...text.matchAll(/--tag-(?<tone>\d): (?<color>#[0-9a-f]{6})/gu)].map((m) => [m.groups.tone, m.groups.color]),
	);
const light = tokens(block(":root"));
const dark = { ...light, ...tokens(block(".dark")) };

// per-tone text overrides of globals.css (light hover): tone -> text percent
const LIGHT_HOVER_TEXT = { 0: 55 };

const grey = (l) => [l, l, l].map((v) => fromOklab([v, 0, 0])[0]);
const rows = [];
let failed = false;
for (const [theme, set] of [
	["light", light],
	["dark", dark],
]) {
	const card = grey(CARD[theme]);
	// [background %, text %, text mixed with]
	const states = {
		base: theme === "light" ? [12, 62, [0, 0, 0]] : [20, 55, [1, 1, 1]],
		hover: theme === "light" ? [24, 62, [0, 0, 0]] : [36, 35, [1, 1, 1]],
	};
	for (let n = 0; n < TONES; n++) {
		const hue = hex(set[n]);
		const out = { theme, tone: n };
		for (const [state, [bgPercent, basePercent, end]] of Object.entries(states)) {
			const textPercent =
				theme === "light" && state === "hover" ? (LIGHT_HOVER_TEXT[n] ?? basePercent) : basePercent;
			out[state] = ratio(mix(hue, textPercent, end), mix(hue, bgPercent, card));
			if (out[state] < MIN) failed = true;
		}
		rows.push(out);
	}
}
for (const row of rows) {
	console.log(`${row.theme} tone ${row.tone}: base ${row.base.toFixed(2)}  hover ${row.hover.toFixed(2)}`);
}
if (failed) {
	console.log(`some ratio is below ${MIN}`);
	process.exit(1);
}
