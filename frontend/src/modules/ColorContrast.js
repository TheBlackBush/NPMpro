/**
 * WCAG contrast of Tabler's colours, read from its CSS (oklch values): for the readable button labels of
 * SectionColors.js, whose test measures the installed Tabler CSS. Pure, so node --test runs it.
 */

const OKLCH = /^oklch\((?<l>[\d.]+)%\s+(?<c>[\d.]+)\s+(?<h>[\d.]+)deg\)$/u;

/**
 * An oklch() value as Tabler writes its colours ("oklch(70.99% 0.1897 131.53deg)")
 *
 * @param   {string} text
 * @returns {{ l: number, c: number, h: number }|null}  lightness 0 to 1, chroma, hue in degrees
 */
export function parseOklch(text) {
	const match = OKLCH.exec(String(text).trim());
	if (!match) return null;
	return { l: Number(match.groups.l) / 100, c: Number(match.groups.c), h: Number(match.groups.h) };
}

/**
 * The value of a colour variable in a stylesheet: its first definition (--tblr-lime: oklch(...);)
 *
 * @param   {string} css
 * @param   {string} name  without the prefix: "lime", "light"
 * @returns {{ l: number, c: number, h: number }|null}
 */
export function cssColor(css, name) {
	const match = new RegExp(`--tblr-${name}:\\s*(oklch\\([^)]*\\))`, "u").exec(css);
	return match ? parseOklch(match[1]) : null;
}

const clamp = (value) => Math.min(1, Math.max(0, value));

/**
 * The linear sRGB channels (0 to 1) of an oklch colour (Björn Ottosson's OKLab matrices), clipped to the sRGB gamut
 *
 * @param   {{ l: number, c: number, h: number }} color
 * @returns {number[]}  [r, g, b]
 */
export function linearRgb({ l, c, h }) {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const lms = [
		l + 0.396_337_777_4 * a + 0.215_803_757_3 * b,
		l - 0.105_561_345_8 * a - 0.063_854_172_8 * b,
		l - 0.089_484_177_5 * a - 1.291_485_548 * b,
	].map((value) => value ** 3);
	const [lc, mc, sc] = lms;
	return [
		4.076_741_662_1 * lc - 3.307_711_591_3 * mc + 0.230_969_929_2 * sc,
		-1.268_438_004_6 * lc + 2.609_757_401_1 * mc - 0.341_319_396_5 * sc,
		-0.004_196_086_3 * lc - 0.703_418_614_7 * mc + 1.707_614_701 * sc,
	].map(clamp);
}

/**
 * The 8-bit sRGB channels of an oklch colour (as Tabler's --tblr-*-rgb variables)
 *
 * @param   {{ l: number, c: number, h: number }} color
 * @returns {number[]}
 */
export function srgb(color) {
	return linearRgb(color).map((value) =>
		Math.round(255 * (value <= 0.003_130_8 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055)),
	);
}

/**
 * WCAG relative luminance
 *
 * @param   {{ l: number, c: number, h: number }} color
 * @returns {number}
 */
export function luminance(color) {
	const [r, g, b] = linearRgb(color);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio of two colours (1 to 21)
 *
 * @param   {{ l: number, c: number, h: number }} first
 * @param   {{ l: number, c: number, h: number }} second
 * @returns {number}
 */
export function contrastRatio(first, second) {
	const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

/**
 * A #rrggbb colour as oklch (Björn Ottosson's matrices), for contrast checks of the hex tokens
 *
 * @param   {string} text
 * @returns {{ l: number, c: number, h: number }|null}
 */
export function parseHex(text) {
	if (!/^#[\da-f]{6}$/iu.test(text)) return null;
	const [r, g, b] = [1, 3, 5].map((index) => {
		const channel = Number.parseInt(text.slice(index, index + 2), 16) / 255;
		return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
	const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
	const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);
	const a = 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s;
	const bb = 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s;
	return {
		l: 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
		c: Math.hypot(a, bb),
		h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
	};
}
