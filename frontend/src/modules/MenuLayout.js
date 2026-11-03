// Which main menu the top bar shows at a window width, matching the Tailwind breakpoints used in shell/TopBar.jsx and
// shell/NavLinks.jsx (lg = 1024, xl = 1280). Below lg the row does not fit (nine items, longer in German), so the phone
// menu takes over; from lg to xl the row drops its icons and tightens its padding. Pure, so node --test checks it.

export const MENU_ROW_FROM = "lg";
export const MENU_ICONS_FROM = "xl";

export function menuLayout(width) {
	if (width < 1024) return "phone";
	if (width < 1280) return "row-compact";
	return "row";
}
