/**
 * Focus handler for a tooltip trigger: lets only keyboard focus open the tooltip. A window opened with the mouse moves
 * focus to its first focusable element, which is not keyboard focus (`:focus-visible` does not match); preventing the
 * event's default there stops Radix from opening the tooltip, which would otherwise stay open over that element.
 *
 * @param {{ currentTarget: { matches?: (selector: string) => boolean } | null, preventDefault: () => void }} event
 */
export function keyboardFocusOnly(event) {
	const target = event.currentTarget;
	if (typeof target?.matches === "function" && !target.matches(":focus-visible")) {
		event.preventDefault();
	}
}
