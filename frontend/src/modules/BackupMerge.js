export const ACTIONS = ["add", "replace", "take", "existing", "skip", "keep"];

// the items that offer more than one choice, in plan order
export const needsChoice = (plan) => plan.items.filter((item) => item.choices.length > 1);

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
