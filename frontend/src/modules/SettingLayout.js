/**
 * Rules of the Settings layout (components/Form/SettingLine.jsx and pages/Settings/SettingsCard.jsx): the classes of
 * a setting line per layout, the classes of a card, and when a collapsed card opens by itself. Pure, so node --test
 * checks them without a DOM. The classes are written out whole so Tailwind finds them.
 */
import { cn } from "../lib/utils.js";
import { errorPaths } from "./HookForm.js";

/** inline: control on the right; block: field under the name; switch: always a row; value: a read-only value */
export const LINE_LAYOUTS = Object.freeze(["inline", "block", "switch", "value"]);

const TITLE = "text-sm font-semibold";
const HINT = "mt-0.5 text-[0.8rem] text-muted-foreground";

// the line stacks (text, then the control at full width) while its container is under the lg width (32rem)
const ROWS = {
	inline: "flex flex-col gap-2 px-4 py-3 @lg:flex-row @lg:items-center @lg:gap-4",
	block: "flex flex-col gap-2 px-4 py-3",
	switch: "flex items-start justify-between gap-4 px-4 py-3 has-[:disabled]:opacity-50",
	value: "flex flex-col gap-1 px-4 py-3 @lg:flex-row @lg:items-center @lg:gap-4",
};

// the box around the control and the things beside it (a Preview icon, a button)
const WRAPS = {
	inline: "flex items-center gap-2 @lg:shrink-0",
	block: "flex items-start gap-2",
	switch: "flex shrink-0",
	value: "flex min-w-0 @lg:max-w-1/2 @lg:shrink-0 @lg:justify-end",
};

const CONTROLS = {
	inline: "min-w-0 flex-1 @lg:w-56 @lg:flex-none",
	block: "min-w-0 flex-1",
	switch: "shrink-0 pt-0.5",
	value: "min-w-0 text-sm break-words @lg:text-right",
};

/**
 * The classes of one setting line
 *
 * @param   {"inline"|"block"|"switch"|"value"} [layout]
 * @returns {{ container: string, row: string, text: string, titleRow: string, title: string, hint: string,
 *   wrap: string, control: string }}
 */
export function settingLineClass(layout = "inline") {
	if (!LINE_LAYOUTS.includes(layout)) throw new TypeError(`unknown setting line layout "${layout}"`);
	return {
		container: "@container",
		row: ROWS[layout],
		text: "min-w-0 flex-1",
		titleRow: "flex flex-wrap items-center gap-x-2 gap-y-1",
		title: TITLE,
		hint: HINT,
		wrap: WRAPS[layout],
		control: CONTROLS[layout],
	};
}

/**
 * The classes of a Settings card: the title bar (a divider under it while the body shows), the collapse trigger
 * stretched over the bar, and the body (padded, or lines edge to edge with hairlines). Lines and a collapsible title
 * bar clip to the rounded corners (the hover background of the bar, the hairlines)
 *
 * @param   {Object}  [options]
 * @param   {boolean} [options.lines]
 * @param   {boolean} [options.open]
 * @param   {boolean} [options.collapsible]
 * @returns {{ card: string, header: string, trigger: string, body: string }}
 */
export function settingsCardClass({ lines = false, open = true, collapsible = false } = {}) {
	return {
		card: cn("rounded-lg border bg-card text-card-foreground", (lines || collapsible) && "overflow-hidden"),
		header: cn(
			"relative flex flex-wrap items-center gap-2 px-4 py-3",
			open && "border-b",
			collapsible && "hover:bg-muted/50",
		),
		trigger:
			"text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset",
		body: lines ? "divide-y" : "space-y-4 p-4",
	};
}

/**
 * Whether one of the errors belongs to one of the fields (the field itself, a nested field or a list item)
 *
 * @param   {*}        errors  React Hook Form's errors
 * @param   {string[]} names
 * @returns {boolean}
 */
export function hasErrorIn(errors, names) {
	return errorPaths(errors ?? {}).some((path) =>
		names.some((name) => path === name || path.startsWith(`${name}.`) || path.startsWith(`${name}[`)),
	);
}

/**
 * A collapsed card's state after a render: a new save that was refused with an error in one of its fields opens it;
 * the user may close it again, and it stays closed until the next save. The same object when nothing changes, so a
 * caller that sets state during render stops after one round.
 *
 * @param   {{ open: boolean, seenSubmits: number }} state
 * @param   {Object}   form
 * @param   {number}   form.submitCount
 * @param   {*}        form.errors
 * @param   {string[]} form.names
 * @returns {{ open: boolean, seenSubmits: number }}
 */
export function openOnRefusedSave(state, { submitCount, errors, names }) {
	if (submitCount === state.seenSubmits) return state;
	return { open: state.open || hasErrorIn(errors, names), seenSubmits: submitCount };
}
