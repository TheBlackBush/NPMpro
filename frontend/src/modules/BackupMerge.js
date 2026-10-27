export const ACTIONS = ["add", "replace", "take", "existing", "skip", "keep"];

// the items of the backup's selection that offer more than one choice, in plan order
export const needsChoice = (plan) => plan.items.filter((item) => !item.linked && item.choices.length > 1);

// the linked items (they come along with the items that need them and can be left out), in plan order
export const linkedItems = (plan) => plan.items.filter((item) => item.linked);

// { action: items[] } in ACTIONS order, empty actions left out
export const byAction = (plan) => {
	const groups = {};
	for (const action of ACTIONS) {
		const items = plan.items.filter((item) => item.action === action);
		if (items.length > 0) groups[action] = items;
	}
	return groups;
};

// a choices object with only the choices that differ from each item's default
export const changedChoices = (plan, choices) => {
	const changed = {};
	for (const item of plan.items) {
		const choice = choices?.[item.key];
		if (choice !== undefined && choice !== item.default) changed[item.key] = choice;
	}
	return changed;
};

// the items whose label contains the text, case-insensitive; empty text returns all
export const searchItems = (items, text) => {
	const needle = (text ?? "").trim().toLowerCase();
	if (needle === "") return items;
	return items.filter((item) =>
		String(item.label ?? "")
			.toLowerCase()
			.includes(needle),
	);
};

// the types whose rows can be chosen one by one ("Choose items")
export const ITEM_TYPES = [
	"proxy_hosts",
	"redirection_hosts",
	"dead_hosts",
	"streams",
	"certificates",
	"access_lists",
	"dns_credentials",
	"users",
];

/**
 * The items of the file per type, for "Choose items": the catalogue so far with the items of a plan added. Only
 * items chosen through their type count (linked items are not), so a subset chosen later does not shrink it.
 *
 * @returns {Object} { [typeId]: [{ id, label }] } ordered by id
 */
export const mergeCatalogue = (catalogue, plan) => {
	const next = { ...catalogue };
	const own = plan.items.filter((item) => !item.linked && ITEM_TYPES.includes(item.type));
	for (const item of own) {
		const list = next[item.type] ?? [];
		if (!list.some((known) => String(known.id) === String(item.id))) {
			next[item.type] = [...list, { id: item.id, label: item.label }].sort(
				(a, b) => Number(a.id) - Number(b.id) || String(a.id).localeCompare(String(b.id)),
			);
		}
	}
	return next;
};

// the items request: the chosen subsets of the selected types, undefined when there are none
export const requestItems = (items, types) => {
	const chosen = Object.entries(items ?? {}).filter(([typeId]) => types.includes(typeId));
	return chosen.length > 0 ? Object.fromEntries(chosen) : undefined;
};

// a subset of a type's items: undefined (the whole type) when every item is chosen
export const chooseItems = (items, typeId, ids, total) => {
	const next = { ...items };
	if (ids.length === total) delete next[typeId];
	else next[typeId] = ids;
	return next;
};

// the default choice of every item seen in a plan so far, so a choice survives its item leaving the plan
export const mergeDefaults = (defaults, plan) => ({
	...defaults,
	...Object.fromEntries(plan.items.map((item) => [item.key, item.default])),
});

// the local choices that differ from their item's known default (the server ignores keys and choices it does not
// know for the current selection)
export const sentChoices = (choices, defaults) =>
	Object.fromEntries(Object.entries(choices ?? {}).filter(([key, choice]) => choice !== defaults?.[key]));

// a selected type whose item list was emptied in Choose items, null when there is none
export const emptyItemType = (items, types) =>
	types.find((typeId) => Array.isArray(items?.[typeId]) && items[typeId].length === 0) ?? null;
