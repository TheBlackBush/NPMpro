import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAuditLogsPage } from "src/api/backend";

/**
 * One page of the audit log, asked from the server (limit and offset; the total comes back in X-Total-Count). The
 * previous page stays on screen while the next one loads.
 *
 * @param {string[]} expand
 * @param {Object} options
 * @param {number} options.page  zero-based page
 * @param {number} options.size  rows per page
 */
const useAuditLogs = (expand, { query, objectType, action, userId, page = 0, size = 25 } = {}) => {
	const result = useQuery({
		queryKey: ["audit-logs", { expand, query, objectType, action, userId, page, size }],
		queryFn: () =>
			getAuditLogsPage(expand, {
				limit: size,
				offset: page * size,
				query: query || undefined,
				object_type: objectType || undefined,
				action: action || undefined,
				user_id: userId || undefined,
			}),
		placeholderData: keepPreviousData,
		staleTime: 10 * 1000,
	});
	return { ...result, rows: result.data?.data ?? [], total: result.data?.total ?? null };
};

export { useAuditLogs };
