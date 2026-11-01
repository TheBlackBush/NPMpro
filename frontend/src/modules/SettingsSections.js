/**
 * The categories of the Settings menu (pages/Settings/sections.js): every section names one, the menu shows them in
 * this order with the category's subheader (and an optgroup in the phone select). Pure, so node --test checks them.
 */
export const SETTINGS_CATEGORIES = [
	{ id: "sites", labelKey: "settings.category.sites" },
	{ id: "security", labelKey: "settings.category.security" },
	{ id: "monitoring", labelKey: "settings.category.monitoring" },
	{ id: "data", labelKey: "settings.category.data" },
	{ id: "system", labelKey: "settings.category.system" },
];

/**
 * The sections grouped by category: categories in SETTINGS_CATEGORIES order, sections in their own order inside each
 * category, categories without a section left out. A section without a known category is a mistake in sections.js:
 * it throws, naming the section, so it never silently drops out of the menu.
 *
 * @param   {Array<{ id: string, category: string }>} sections
 * @param   {Array<{ id: string, labelKey: string }>} [categories]
 * @returns {Array<{ id: string, labelKey: string, sections: Object[] }>}
 */
export function groupSections(sections, categories = SETTINGS_CATEGORIES) {
	const known = new Set(categories.map(({ id }) => id));
	const stray = sections.find((section) => !known.has(section.category));
	if (stray) throw new Error(`Settings section "${stray.id}" has no known category: "${stray.category}"`);
	return categories
		.map((category) => ({ ...category, sections: sections.filter((section) => section.category === category.id) }))
		.filter((category) => category.sections.length > 0);
}

/**
 * The help document of a Settings section (translations/help/<language>/<name>.md): "Settings" and the section id in
 * PascalCase, for example default-site: SettingsDefaultSite. The section heading's "?" opens it (SettingsHeading).
 *
 * @param   {string} id  the section id of sections.js
 * @returns {string}
 */
export const settingsHelpDoc = (id) =>
	`Settings${id
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("")}`;
