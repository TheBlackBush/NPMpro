/**
 * The page numbers to show: every page when there are few, otherwise the first, the last and the pages around the
 * current one, with null where pages are left out
 *
 * @param   {number} current  zero-based page index
 * @param   {number} count    number of pages
 * @returns {Array<number|null>}
 */
const pageNumbers = (current, count) => {
	if (count <= 7) return Array.from({ length: count }, (_, index) => index);
	const pages = new Set([0, count - 1, current - 1, current, current + 1]);
	const sorted = [...pages].filter((page) => page >= 0 && page < count).sort((a, b) => a - b);
	const out = [];
	for (const page of sorted) {
		if (out.length > 0 && page - out.at(-1) > 1) out.push(null);
		out.push(page);
	}
	return out;
};

export { pageNumbers };
