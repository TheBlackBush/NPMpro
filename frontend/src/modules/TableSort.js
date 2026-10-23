/**
 * aria-sort value for a column header from TanStack's sort state
 *
 * @param {false|"asc"|"desc"} sorted
 * @returns {"ascending"|"descending"|"none"}
 */
const ariaSort = (sorted) => (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none");

export { ariaSort };
