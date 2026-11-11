import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { Progress } from "src/components/ui/progress";

/**
 * Indeterminate bar along the top edge of the page (over the sticky header, so nothing shifts) while any request
 * runs, 2px high (login and restore use 6px). Hidden from screen readers and pointers: pages announce their own
 * loading.
 */
export function LoadingBar() {
	const busy = useIsFetching() + useIsMutating() > 0;
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0">
			{busy ? <Progress className="h-0.5" /> : null}
		</div>
	);
}
