// What a table column does on small screens (spec 2026-10-28-mobile-tables-design): set as meta.mobile on a column.
// Cells marked title, title-end or title-below are rendered twice (the phone title block and their own cell, one
// copy always hidden), so their renderers must not use fixed element ids or one-time side effects.
export const MOBILE_ROLES = ["title", "title-end", "title-below", "summary", "hide", "hide-lg"];

const PHONE_HIDDEN = new Set(["title-end", "title-below", "summary", "hide"]);

export const mobileRole = (columnDef) => {
	const role = columnDef?.meta?.mobile;
	return MOBILE_ROLES.includes(role) ? role : null;
};

// a cell hidden on phones, where its content shows in the phone title block
export const PHONE_HIDDEN_CELL = "hidden md:table-cell";

// hidden is the class a phone-hidden cell gets: PHONE_HIDDEN_CELL, or the container variant of a table that stacks by its width
const hiddenClass = (columnDef, hidden = PHONE_HIDDEN_CELL) => {
	const role = mobileRole(columnDef);
	if (PHONE_HIDDEN.has(role)) return hidden;
	if (role === "hide-lg") return "hidden lg:table-cell";
	return "";
};

export const cellClass = hiddenClass;
export const headerClass = hiddenClass;

// the title wraps inside the stacked card instead of pushing the menu off screen
export const titleClass = () => "min-w-0 flex-1 break-words";

export const summaryText = (columns, row) =>
	columns
		.filter((column) => mobileRole(column) === "summary" && typeof column.meta?.summaryText === "function")
		.map((column) => column.meta.summaryText(row))
		.filter((text) => typeof text === "string" && text !== "")
		.join(" · ");

export const phoneParts = (columns) => ({
	end: columns.filter((column) => mobileRole(column) === "title-end"),
	below: columns.filter((column) => mobileRole(column) === "title-below"),
	summary: columns.filter((column) => mobileRole(column) === "summary"),
});

export const sortOptions = (columns) =>
	columns
		.filter((column) => column.enableSorting !== false && typeof column.header === "string" && column.header !== "")
		.map((column) => ({ id: column.id, label: column.header }));

export const sortSelectValue = (sorting) =>
	Array.isArray(sorting) && sorting.length > 0
		? { id: sorting[0].id, desc: Boolean(sorting[0].desc) }
		: { id: null, desc: false };
