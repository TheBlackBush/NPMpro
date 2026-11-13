import errs from "../error.js";
import { ssiProblems } from "./placeholders.js";
import { PLACES } from "./types.js";

// one custom page: at most 1 MiB in UTF-8, well-formed, no NUL, the SSI rules of placeholders.js
export const MAX_PAGE_BYTES = 1024 * 1024;

/**
 * @param   {string} html
 * @returns {string[]}  English sentences for the API error, empty when the page can be saved
 */
export const pageHtmlProblems = (html) => {
	if (typeof html !== "string" || html.trim() === "") return ["The page is empty."];
	const problems = [];
	if (Buffer.byteLength(html, "utf8") > MAX_PAGE_BYTES) problems.push("The page is larger than 1 MiB.");
	if (!html.isWellFormed()) problems.push("The page is not valid UTF-8.");
	if (html.includes("\u0000")) problems.push("The page holds a NUL character.");
	return [...problems, ...ssiProblems(html)];
};

/**
 * The page fields of a create or update payload: a custom choice needs a page (sent or saved), and any page sent is
 * checked. The schema already checked the choices.
 *
 * @param {"proxy_host"|"dead_host"|"access_list"} kind
 * @param {Object} data      the payload
 * @param {Object} existing  the saved row ({} for a create)
 */
export const assertPageFields = (kind, data, existing) => {
	for (const field of PLACES[kind].fields) {
		const htmlKey = `${field.column}_html`;
		const sent = Object.hasOwn(data, htmlKey) && data[htmlKey] !== "";
		const choice = data[field.column] ?? existing?.[field.column] ?? field.default;
		if (!(sent || choice === "custom")) continue;
		const problems = pageHtmlProblems(sent ? data[htmlKey] : (existing?.[htmlKey] ?? ""));
		if (problems.length > 0) throw new errs.ValidationError(`${htmlKey}: ${problems.join(" ")}`);
	}
};

/**
 * An empty page sent with the custom choice keeps the saved page (an update that does not touch the page). Any other
 * choice with an empty page clears it. Changes the payload in place.
 *
 * @param {"proxy_host"|"dead_host"|"access_list"} kind
 * @param {Object} data
 * @param {Object} existing  the saved row ({} for a create)
 */
export const keepSavedPages = (kind, data, existing) => {
	for (const field of PLACES[kind].fields) {
		const htmlKey = `${field.column}_html`;
		const choice = data[field.column] ?? existing?.[field.column] ?? field.default;
		if (data[htmlKey] === "" && choice === "custom") delete data[htmlKey];
	}
};
