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

// "Already on this instance": the items that match or clash with an instance row, and the linked items (they carry
// Include); plain adds without a choice are left out, in plan order
export const decisionItems = (plan) =>
	plan.items.filter((item) => item.linked || item.choices.length > 1 || (item.reason && item.choices.length > 0));

// the choice shown for an item: the local one when the item offers it, else the plan's action
export const currentChoice = (item, choice) => (item.choices.includes(choice) ? choice : item.action);

// a linked item is included unless unticked, locally or in the plan
export const isIncluded = (item, choice) => (choice === undefined ? !item.unticked : choice !== "unticked");

// the decision items whose label contains the text and, when given, with the reason
export const filterDecisions = (items, { search, reason } = {}) =>
	searchItems(items, search).filter((item) => !reason || item.reason === reason);

// the reasons of the items, in order of first appearance
export const decisionReasons = (items) => [...new Set(items.map((item) => item.reason).filter(Boolean))];

// the rows a group of the decisions list shows before "Show more"
export const DECISION_ROWS = 8;

/**
 * The decision items per type, in order of first appearance (the plan is in restore order).
 *
 * @param   {Object[]}  items
 * @param   {Object}    [options]
 * @param   {string[]}  [options.expanded]   the types whose rows are all shown ("Show more")
 * @param   {boolean}   [options.searching]  a search shows every match
 * @returns {Object[]}  [{ type, items, rows, more }]: rows are the shown items, more the hidden ones
 */
export const groupDecisions = (items, { expanded = [], searching = false } = {}) => {
	const groups = new Map();
	for (const item of items) {
		if (!groups.has(item.type)) groups.set(item.type, []);
		groups.get(item.type).push(item);
	}
	return [...groups.entries()].map(([type, list]) => {
		const rows = searching || expanded.includes(type) ? list : list.slice(0, DECISION_ROWS);
		return { type, items: list, rows, more: list.length - rows.length };
	});
};

// the choices of a group's items, in order of first appearance
export const groupChoices = (items) => [...new Set(items.flatMap((item) => item.choices))];

// [{ choice, count }] of a group: how many items show each of its choices
export const choiceSummary = (items, choices) =>
	groupChoices(items).map((choice) => ({
		choice,
		count: items.filter((item) => currentChoice(item, choices?.[item.key]) === choice).length,
	}));

// "Set all": the choice for every given item that offers it and is included
export const setAllChoices = (items, choice, choices) =>
	Object.fromEntries(
		items
			.filter((item) => item.choices.includes(choice) && isIncluded(item, choices?.[item.key]))
			.map((item) => [item.key, choice]),
	);

// the rows of the item picker: those matching the search and, with selectedOnly, the ticked ones
export const pickerItems = (items, selected, { search, selectedOnly = false } = {}) => {
	const ticked = new Set(selected.map(String));
	return searchItems(items, search).filter((item) => !selectedOnly || ticked.has(String(item.id)));
};

// "Select all" (on) or "None" over the shown rows: the ticked ids in the order of items
export const tickShown = (items, selected, shown, on) => {
	const ticked = new Set(selected.map(String));
	for (const item of shown) {
		if (on) ticked.add(String(item.id));
		else ticked.delete(String(item.id));
	}
	return items.filter((item) => ticked.has(String(item.id))).map((item) => item.id);
};

// a type name inside an English sentence ("Show 3 more proxy hosts"): the first letter lowercased unless the name
// starts with an acronym; other languages keep their casing
const CAPITALISED = /^\p{Lu}\p{Ll}/u;
export const inSentence = (text, locale) => {
	if (!String(locale ?? "").startsWith("en") || !CAPITALISED.test(text)) return text;
	return text.charAt(0).toLowerCase() + text.slice(1);
};
