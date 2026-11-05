// When a stacked table turns its rows into cards. "viewport" (the default) follows the window: cards below md.
// "container" follows the width the table has: cards below 42rem, so a table in the narrow section column next to the
// sidebar stacks while the same table at the same window width without the sidebar stays a table. The class strings
// are whole literals so Tailwind finds them; the table's container carries `@container` (see TableLayout).
export const STACK_MODES = {
	viewport: {
		table: "max-md:block max-md:[&>tbody]:block",
		tableBody: "max-md:[&_tr:last-child]:border!",
		headerHidden: "max-md:hidden",
		cardRow: "max-md:mb-3 max-md:flex max-md:flex-col max-md:gap-1 max-md:rounded-lg max-md:border max-md:p-3",
		cardCell:
			"max-md:px-0 max-md:py-1 max-md:data-label:before:block max-md:data-label:before:text-xs max-md:data-label:before:text-muted-foreground max-md:data-label:before:content-[attr(data-label)]",
		groupRow: "max-md:border-0 max-md:block",
		groupHead: "max-md:block max-md:w-full",
		emptyRow: "max-md:block max-md:w-full",
		emptyCell: "max-md:block max-md:w-full",
		phoneOnly: "md:hidden",
		wideOnly: "hidden md:block",
		hiddenCell: "hidden md:table-cell",
	},
	container: {
		table: "@max-2xl:block @max-2xl:[&>tbody]:block",
		tableBody: "@max-2xl:[&_tr:last-child]:border!",
		headerHidden: "@max-2xl:hidden",
		cardRow:
			"@max-2xl:mb-3 @max-2xl:flex @max-2xl:flex-col @max-2xl:gap-1 @max-2xl:rounded-lg @max-2xl:border @max-2xl:p-3",
		cardCell:
			"@max-2xl:px-0 @max-2xl:py-1 @max-2xl:data-label:before:block @max-2xl:data-label:before:text-xs @max-2xl:data-label:before:text-muted-foreground @max-2xl:data-label:before:content-[attr(data-label)]",
		groupRow: "@max-2xl:border-0 @max-2xl:block",
		groupHead: "@max-2xl:block @max-2xl:w-full",
		emptyRow: "@max-2xl:block @max-2xl:w-full",
		emptyCell: "@max-2xl:block @max-2xl:w-full",
		phoneOnly: "@2xl:hidden",
		wideOnly: "hidden @2xl:block",
		hiddenCell: "hidden @2xl:table-cell",
	},
};
