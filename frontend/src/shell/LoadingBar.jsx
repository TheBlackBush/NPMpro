import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/** A thin gradient bar along the bottom edge of the header while any request is running */
export function LoadingBar() {
	const busy = useIsFetching() + useIsMutating() > 0;
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden">
			{busy ? (
				<div className="h-full w-2/5 animate-[npmpro-loader_1.2s_ease-in-out_infinite] rounded-full bg-[image:var(--brand-gradient)] motion-reduce:animate-none" />
			) : null}
		</div>
	);
}
