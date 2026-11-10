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

// with this many rows or fewer a list has no pager (the smallest rows-per-page choice)
const PAGER_MIN_ROWS = 10;

/** @returns {number} the number of pages (at least 1) */
const pageCount = (total, size) => Math.max(1, Math.ceil(total / size));

/** @returns {number} the page index kept inside 0 to the last page that exists */
const clampPage = (index, total, size) => Math.min(Math.max(0, index), pageCount(total, size) - 1);

/** @returns {{from: number, to: number}} the one-based first and last row of a page (0 and 0 without rows) */
const pageRange = (index, size, total) => {
	if (total <= 0) return { from: 0, to: 0 };
	const from = index * size + 1;
	return { from, to: Math.min(total, from + size - 1) };
};

/** @returns {boolean} whether a list with this many rows shows its pager bars */
const showPager = (total) => total > PAGER_MIN_ROWS;

export { clampPage, PAGER_MIN_ROWS, pageCount, pageNumbers, pageRange, showPager };
