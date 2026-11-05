/**
 * Label shown above a cell when a table stacks on small screens (the stacked mobile layout)
 *
 * @param {{ header?: unknown } | undefined} columnDef
 * @returns {string | undefined}
 */
const cellLabel = (columnDef) =>
	typeof columnDef?.header === "string" && columnDef.header !== "" ? columnDef.header : undefined;

export { cellLabel };
