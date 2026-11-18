import { useEffect, useState } from "react";

/**
 * The id of the section or article the reader is at: of the elements that enter the band under the header, the last
 * one wins. It only updates the nav; the address stays as it is.
 *
 * @param {string[]} ids  element ids (an id that is not in the page is skipped)
 * @returns {string | null}
 */
export function useScrollSpy(ids) {
	const [active, setActive] = useState(null);
	const key = ids.join("\n");

	// biome-ignore lint/correctness/useExhaustiveDependencies: key is the content of ids, a new array of the same ids must not restart the observer
	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				const entering = entries.filter((entry) => entry.isIntersecting);
				if (entering.length > 0) {
					setActive(entering[entering.length - 1].target.id);
				}
			},
			{ rootMargin: "-80px 0px -70% 0px" },
		);
		for (const id of ids) {
			const element = document.getElementById(id);
			if (element) {
				observer.observe(element);
			}
		}
		return () => observer.disconnect();
	}, [key]);

	return active;
}
