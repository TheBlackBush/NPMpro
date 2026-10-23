// Merge infinite query pages of audit log rows, dropping duplicates by id (new rows can shift offsets)
export function mergePages(pages) {
	const seen = new Set();
	const rows = [];
	for (const page of pages ?? []) {
		for (const row of page?.data ?? []) {
			if (!seen.has(row.id)) {
				seen.add(row.id);
				rows.push(row);
			}
		}
	}
	return rows;
}

// Offset of the next page, or undefined when everything is loaded or the total is unknown
export function nextOffset(lastPage, allPages) {
	const total = lastPage?.total;
	if (total === null || total === undefined || !lastPage?.data?.length) return;
	const loaded = allPages.reduce((sum, page) => sum + (page?.data?.length ?? 0), 0);
	return loaded < total ? loaded : undefined;
}
