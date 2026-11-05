import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { fits } from "src/modules/BadgesFit";

// the gap of the label row (gap-2)
const BADGES_GAP = 8;

// Natural width of an element: the width it takes with these classes added for a moment (whole literal classes, no
// inline style), read in the same task so nothing is painted. Independent of where the element sits.
function naturalWidth(element, classes) {
	element.classList.add(...classes);
	const width = element.getBoundingClientRect().width;
	element.classList.remove(...classes);
	return width;
}

/**
 * Decides where a setting's badges go: true when they fit on the label's line (INLINE), false when they go to the
 * bottom of the setting after the hint (BOTTOM, also before the first measurement). It measures the label's and the
 * badges' natural widths against the row's width, so the answer does not depend on the current placement and cannot
 * oscillate; it observes the row's size and re-measures when the row resizes, when fonts load and after every render
 * (a new locale or label text changes the widths without resizing the row).
 *
 * @param   {Object}   options
 * @param   {boolean}  options.enabled       the field has badges
 * @param   {Function} [options.getRowWidth] (row) => width the label and badges share; the row's width by default
 * @returns {{ inline: boolean, rowRef: Function, labelRef: Function, badgesRef: Function }} refs to attach
 */
export function useBadgesFit({ enabled, getRowWidth = (row) => row.getBoundingClientRect().width }) {
	const [inline, setInline] = useState(false);
	const row = useRef(null);
	const label = useRef(null);
	const badges = useRef(null);
	const getWidth = useRef(getRowWidth);
	getWidth.current = getRowWidth;

	const measure = useCallback(() => {
		if (!(row.current && label.current && badges.current)) return;
		const next = fits(
			naturalWidth(label.current, ["w-max!", "whitespace-nowrap"]),
			naturalWidth(badges.current, ["w-max!"]),
			BADGES_GAP,
			getWidth.current(row.current),
		);
		setInline(next);
	}, []);

	// every render: a changed text or locale is measured before it is painted
	useLayoutEffect(() => {
		if (enabled) measure();
	});

	useLayoutEffect(() => {
		if (!(enabled && row.current && label.current)) return;
		const observer = new ResizeObserver(measure);
		observer.observe(row.current);
		let live = true;
		document.fonts?.ready.then(() => {
			if (live) measure();
		});
		return () => {
			live = false;
			observer.disconnect();
		};
	}, [enabled, measure]);

	return {
		inline: enabled && inline,
		rowRef: row,
		labelRef: label,
		badgesRef: badges,
	};
}
