import {
	createColumnHelper,
	createPaginatedRowModel,
	createSortedRowModel,
	rowPaginationFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_datetime,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";

const sortFns = { alphanumeric: sortFn_alphanumeric, datetime: sortFn_datetime, text: sortFn_text };

// sorting with the three sort functions of the lists
export const APP_FEATURES = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns });
// the same with pages (the stored backups)
export const PAGED_FEATURES = tableFeatures({
	rowSortingFeature,
	rowPaginationFeature,
	sortedRowModel: createSortedRowModel(),
	paginatedRowModel: createPaginatedRowModel(),
	sortFns,
});
// no registered sort function: TanStack then compares every column with its basic sort (the monitoring tables)
export const PLAIN_SORT_FEATURES = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });

// the column helper keeps no state, so the shared builders use one
export const appColumnHelper = createColumnHelper();

const idOf = (row) => `${row.id}`;

/**
 * useTable with the defaults of the lists: their features, rows keyed by id, and a sorted column that never returns
 * to unsorted. An option given wins.
 */
export function useAppTable({ features = APP_FEATURES, getRowId = idOf, enableSortingRemoval = false, ...options }) {
	return useTable({ features, getRowId, enableSortingRemoval, ...options });
}
