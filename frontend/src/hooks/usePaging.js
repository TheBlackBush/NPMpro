import { useCallback, useState } from "react";
import { usePreferences } from "src/context/PreferencesContext";
import { settlePage } from "src/modules/PageState";

/**
 * The page state of a paged list: the page, kept while the list is saved or toggled, and the rows per page, kept per
 * list in this browser (PreferencesContext). Back to the first page when the signature changes (search, filters,
 * sort) or the rows per page change; to the last page that exists when the rows no longer reach the page.
 *
 * @param {Object} options
 * @param {string} options.list       a key of PAGED_LISTS (modules/Preferences.js)
 * @param {number|null} options.total  rows in all pages, null while not known
 * @param {string} [options.signature]  what the list shows: when it changes the list starts on the first page
 * @returns {{pageIndex: number, pageSize: number, setPageIndex: (index: number) => void,
 *   setPageSize: (size: number) => void}}
 */
export function usePaging({ list, total, signature = "" }) {
	const { pageSizes, setPageSize: storeSize } = usePreferences();
	const pageSize = pageSizes[list];
	const key = `${pageSize}|${signature}`;
	const [state, setState] = useState({ index: 0, signature: key });
	// settled while rendering, so the first render after a change already shows the right page
	const settled = settlePage(state, key, total, pageSize);
	if (settled !== state) setState(settled);
	const setPageIndex = useCallback((index) => setState((current) => ({ ...current, index })), []);
	const setPageSize = useCallback((size) => storeSize(list, size), [list, storeSize]);
	return { pageIndex: settled.index, pageSize, setPageIndex, setPageSize };
}
