/**
 * Selection helpers for the backup type tree. A category is { id, types: string[] } as returned by
 * GET /api/backups/types, `selected` is the array of selected type ids. Every helper returns a new array.
 */

export function categoryState(category, selected) {
	const count = category.types.filter((id) => selected.includes(id)).length;
	if (count === 0) return "none";
	return count === category.types.length ? "all" : "some";
}

// a category that is not fully selected becomes fully selected, otherwise it is cleared
export function toggleCategory(category, selected) {
	if (categoryState(category, selected) === "all") {
		return selected.filter((id) => !category.types.includes(id));
	}
	return [...selected, ...category.types.filter((id) => !selected.includes(id))];
}

export function toggleType(typeId, selected) {
	return selected.includes(typeId) ? selected.filter((id) => id !== typeId) : [...selected, typeId];
}

export function DEFAULT_SELECTED(categories) {
	return categories.flatMap((category) => category.types);
}
