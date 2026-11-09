import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { Progress } from "src/components/ui/progress";

/**
 * The indeterminate Progress bar of the login page and the restore window, along the top edge of the page (the top of
 * the sticky header) while any request is running, 2px high (login and restore use 6px), which is lighter at the page
 * edge. It floats over the header, so nothing shifts, and is hidden from screen readers
 * and pointers: the pages announce their own loading states.
 */
export function LoadingBar() {
	const busy = useIsFetching() + useIsMutating() > 0;
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0">
			{busy ? <Progress className="h-0.5" /> : null}
		</div>
	);
}
