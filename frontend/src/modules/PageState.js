import { clampPage } from "./Pagination.js";

/**
 * The page of a list after a render: back to the first page when what the list shows changed (search, filters,
 * sort, rows per page: the signature), else the page kept, or the last page that exists when the rows no longer reach
 * it. total null (not known yet) keeps the page.
 *
 * @param   {{index: number, signature: string}} state
 * @param   {string} signature  what the list shows now
 * @param   {number|null} total  rows in all pages
 * @param   {number} size       rows per page
 * @returns {{index: number, signature: string}} the same object when nothing changed
 */
export function settlePage(state, signature, total, size) {
	if (state.signature !== signature) return { index: 0, signature };
	if (total === null || total === undefined) return state;
	const index = clampPage(state.index, total, size);
	return index === state.index ? state : { index, signature };
}
