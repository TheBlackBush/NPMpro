// What a table column does on small screens (spec 2026-10-28-mobile-tables-design): set as meta.mobile on a column.
// Cells marked title, title-end or title-below are rendered twice (the phone title block and their own cell, one
// copy always hidden), so their renderers must not use fixed element ids or one-time side effects.
export const MOBILE_ROLES = ["title", "title-end", "title-below", "summary", "hide", "hide-lg"];

const PHONE_HIDDEN = new Set(["title-end", "title-below", "summary", "hide"]);

export const mobileRole = (columnDef) => {
	const role = columnDef?.meta?.mobile;
	return MOBILE_ROLES.includes(role) ? role : null;
};

const hiddenClass = (columnDef) => {
	const role = mobileRole(columnDef);
	if (PHONE_HIDDEN.has(role)) return "d-none d-md-table-cell";
	if (role === "hide-lg") return "d-none d-lg-table-cell";
	return "";
};

export const cellClass = hiddenClass;
export const headerClass = hiddenClass;

// the title wraps inside the stacked card instead of pushing the menu off screen
export const titleClass = () => "flex-fill text-break";

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
