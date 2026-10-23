import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getAuditLogsPage } from "src/api/backend";
import { mergePages, nextOffset } from "src/modules/AuditPages";

const PAGE_SIZE = 50;

const useAuditLogs = (expand, { query, objectType, action, userId } = {}) => {
	const result = useInfiniteQuery({
		queryKey: ["audit-logs", { expand, query, objectType, action, userId }],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			getAuditLogsPage(expand, {
				limit: PAGE_SIZE,
				offset: pageParam,
				query: query || undefined,
				object_type: objectType || undefined,
				action: action || undefined,
				user_id: userId || undefined,
			}),
		getNextPageParam: nextOffset,
		placeholderData: keepPreviousData,
		staleTime: 10 * 1000,
	});

	const rows = useMemo(() => mergePages(result.data?.pages), [result.data]);
	const pages = result.data?.pages;
	const total = pages?.length ? pages[pages.length - 1].total : null;

	return { ...result, rows, total };
};

export { useAuditLogs };
