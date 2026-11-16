import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { parseFilters } from "src/modules/ListFilters";

const FILTER_KEYS = ["q", "status", "tls", "group", "tag", "expiry"];

const useListFilters = (allowedGroups = [], allowedTags = []) => {
	const [searchParams, setSearchParams] = useSearchParams();
	const filters = parseFilters(searchParams, { groups: allowedGroups, tags: allowedTags });

	const setFilter = useCallback(
		(key, value) => {
			setSearchParams(
				(prev) => {
					const next = new URLSearchParams(prev);
					if (Array.isArray(value)) {
						next.delete(key);
						for (const item of value) next.append(key, item);
					} else if (value === "all" || value === "" || value === null || value === undefined) {
						next.delete(key);
					} else {
						next.set(key, value);
					}
					return next;
				},
				{ replace: key === "q" },
			);
		},
		[setSearchParams],
	);

	const clear = useCallback(() => {
		setSearchParams(
			(prev) => {
				const next = new URLSearchParams(prev);
				for (const key of FILTER_KEYS) next.delete(key);
				return next;
			},
			{ replace: true },
		);
	}, [setSearchParams]);

	return { filters, setFilter, clear };
};

export { useListFilters };
