import { pageHtmlProblems } from "./html.js";
import { LANDING_ID } from "./store.js";
import { PLACES } from "./types.js";

// A restore or merge brings page HTML in from a backup file: every page passes the checks of the API (pageHtmlProblems)
// before its row is written. A page that fails is not kept: its place falls back to the global page (a custom choice
// without HTML), the Settings page back to the NPMpro page. The log names the row and the field, never the content.

const PLACE_TABLES = {
	proxy_host: "proxy_host",
	dead_host: "dead_host",
	access_list: "access_list",
};

const parseMeta = (meta) => {
	if (meta !== null && typeof meta === "object") return meta;
	try {
		return JSON.parse(meta);
	} catch {
		return null;
	}
};

const checked = (html) => typeof html === "string" && html !== "" && pageHtmlProblems(html).length > 0;

const placeRow = (kind, table, row, log) => {
	let out = row;
	for (const field of PLACES[kind].fields) {
		const key = `${field.column}_html`;
		if (!checked(row[key])) continue;
		log.warn(
			`Backup: ${table} #${row.id} ${key} is not a valid page, it is not restored (the global page is shown)`,
		);
		out = { ...out, [key]: null };
	}
	return out;
};

const settingRow = (row, log) => {
	if (row?.id !== LANDING_ID) return row;
	const meta = parseMeta(row.meta);
	if (!(meta && typeof meta === "object" && meta.pages && typeof meta.pages === "object")) return row;
	let changed = false;
	const pages = Object.fromEntries(
		Object.entries(meta.pages).map(([type, page]) => {
			if (!checked(page?.html)) return [type, page];
			log.warn(`Backup: setting ${LANDING_ID} pages.${type}.html is not a valid page, it is not restored`);
			changed = true;
			return [type, { ...page, choice: "npmpro", html: "" }];
		}),
	);
	return changed ? { ...row, meta: { ...meta, pages } } : row;
};

/**
 * @param   {Object<string, Object[]>} rowsByTable  the rows of one backup type, as read from the archive
 * @param   {{ warn: Function }}       log
 * @returns {Object<string, Object[]>}  the same rows with the pages that fail the API's checks left out
 */
export const withValidPages = (rowsByTable, log) => {
	const out = { ...rowsByTable };
	for (const [kind, table] of Object.entries(PLACE_TABLES)) {
		if (Array.isArray(out[table])) out[table] = out[table].map((row) => placeRow(kind, table, row, log));
	}
	if (Array.isArray(out.setting)) out.setting = out.setting.map((row) => settingRow(row, log));
	return out;
};
