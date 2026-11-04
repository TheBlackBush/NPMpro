/**
 * Whether a setting's badges fit on the label's line: the label's natural width, the gap and the badges' natural
 * width must add up to at most the row's width. Pure, so node --test checks it; the measuring is in
 * components/Form/useBadgesFit.js.
 *
 * @param   {number} labelWidth   natural width of the label
 * @param   {number} badgesWidth  natural width of the badges (all in one line)
 * @param   {number} gap          space between the two
 * @param   {number} rowWidth     width of the row they share
 * @returns {boolean}
 */
export function fits(labelWidth, badgesWidth, gap, rowWidth) {
	const widths = [labelWidth, badgesWidth, gap, rowWidth];
	if (!widths.every((width) => Number.isFinite(width)) || rowWidth <= 0) return false;
	return labelWidth + gap + badgesWidth <= rowWidth;
}
