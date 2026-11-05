import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept up to date. The first render already reads it, so a window that matches
 * never paints a frame in the other variant.
 *
 * @param   {string} query  for example "(max-width: 1023px)"
 * @returns {boolean}
 */
export function useMediaQuery(query) {
	const subscribe = useCallback(
		(onChange) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		[query],
	);
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(query).matches,
		() => false,
	);
}
