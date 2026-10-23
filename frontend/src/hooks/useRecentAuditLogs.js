import { useQuery } from "@tanstack/react-query";
import { getAuditLogs } from "src/api/backend";

const useRecentAuditLogs = (enabled) =>
	useQuery({
		queryKey: ["audit-logs", "recent"],
		queryFn: () => getAuditLogs(["user"], { limit: 5 }),
		enabled: Boolean(enabled),
		retry: false,
		staleTime: 10 * 1000,
	});

export { useRecentAuditLogs };
