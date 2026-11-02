import { useMemo } from "react";
import { useLocation } from "react-router";
import { useHostReport, useUser } from "src/hooks";
import { locate, visibleGroups } from "src/modules/Navigation";

// the badges refresh every few minutes (and after every host change, which invalidates the report)
const BADGE_REFRESH = 5 * 60 * 1000;

/**
 * The navigation for the signed-in user: the groups and pages they may see, where the route is (group and page, null
 * on a route of no page) and the host report for the badges (undefined while it loads or when it failed: no badges);
 * loading while the user is not known yet (the shell shows placeholders then)
 */
export function useNavigation() {
	const { data: user, isPending } = useUser("me");
	const { pathname } = useLocation();
	const { data: report } = useHostReport({ refetchInterval: BADGE_REFRESH, retry: 1 });
	const groups = useMemo(() => visibleGroups(user), [user]);
	const current = locate(pathname, groups);
	return { user, loading: isPending, groups, current, report, pathname };
}
