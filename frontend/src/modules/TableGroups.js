/**
 * Rows grouped for a grouped list (the host lists' Group): the groups in name order, the rows without a group last,
 * the rows of a group in the order they came in
 *
 * @param   {Array} rows
 * @param   {(item) => string} keyOf  the group of a row ("" for none)
 * @returns {Array<[string, Array]>}
 */
export function groupRows(rows, keyOf) {
	const groups = new Map();
	for (const row of rows) {
		const key = keyOf(row);
		const bucket = groups.get(key);
		if (bucket) bucket.push(row);
		else groups.set(key, [row]);
	}
	return [...groups.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
}

/**
 * One page of grouped rows: the rows of all groups in display order are cut into pages, and each page keeps the
 * groups it touches (a group that spans pages shows on each of them)
 *
 * @param   {Array<[string, Array]>} groups  from groupRows
 * @param   {number} pageIndex
 * @param   {number} pageSize
 * @returns {Array<[string, Array]>}
 */
export function pageGroups(groups, pageIndex, pageSize) {
	const start = pageIndex * pageSize;
	const end = start + pageSize;
	const out = [];
	let seen = 0;
	for (const [key, rows] of groups) {
		const part = rows.slice(Math.max(0, start - seen), Math.max(0, end - seen));
		if (part.length > 0) out.push([key, part]);
		seen += rows.length;
	}
	return out;
}
