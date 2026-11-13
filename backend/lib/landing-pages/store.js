import { GLOBAL_CHOICES, PAGE_TYPES } from "./types.js";

// The landing_pages settings row: meta.pages holds { choice, html } per type, meta.imported_on the time of the one
// import of the old CrowdSec pages. No row means the first start after the update (migrations insert no rows), and a
// missing row reads as the defaults. The model loads on first use: importing it opens the database, and the pure
// functions here are used (and tested) without one.

const settingModel = async () => (await import("../../models/setting.js")).default;

export const LANDING_ID = "landing_pages";
const NPMPRO = { choice: "npmpro", html: "" };

/**
 * @param   {Object|null} stored  the row's meta
 * @returns {Record<string, { choice: string, html: string }>}  every type; a custom choice without a page is the NPMpro page
 */
export const effectivePages = (stored) =>
	Object.fromEntries(
		PAGE_TYPES.map((type) => {
			const page = stored?.pages?.[type] ?? {};
			const html = typeof page.html === "string" ? page.html : "";
			const valid = GLOBAL_CHOICES.includes(page.choice) && !(page.choice === "custom" && html === "");
			return [type, valid ? { choice: page.choice, html } : { ...NPMPRO, html }];
		}),
	);

/**
 * @param   {Object|null} stored
 * @param   {Object}      changes  { [type]: { choice?, html? } } (validated by the schema)
 * @returns {Object}  the new meta; unknown types are ignored, a page is kept when only the choice changes
 */
export const applyPagesUpdate = (stored, changes) => {
	const pages = { ...(stored?.pages ?? {}) };
	for (const [type, change] of Object.entries(changes ?? {})) {
		if (PAGE_TYPES.includes(type)) pages[type] = { ...NPMPRO, ...pages[type], ...change };
	}
	return { ...stored, pages };
};

/**
 * @param   {Object} before  effectivePages
 * @param   {Object} after
 * @returns {string[]}  the types whose choice or page changed, in PAGE_TYPES order
 */
export const changedPageTypes = (before, after) =>
	PAGE_TYPES.filter((type) => before[type].choice !== after[type].choice || before[type].html !== after[type].html);

/** @returns {Promise<Object|null>} the row's meta, null without a row */
export const readStoredLandingPages = async () =>
	(await (await settingModel()).query().where("id", LANDING_ID).first())?.meta ?? null;

/** @param {Object} meta */
export const saveStoredLandingPages = async (meta) => {
	const model = await settingModel();
	if (await model.query().where("id", LANDING_ID).first()) {
		await model.query().where("id", LANDING_ID).patch({ meta });
		return;
	}
	await model
		.query()
		.insert({ id: LANDING_ID, name: "Landing pages", description: "Landing pages", value: LANDING_ID, meta });
};
