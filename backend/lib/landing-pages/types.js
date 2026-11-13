// The landing page types, their files and the page fields of each place: Settings, Landing pages (the global pages),
// the proxy host's Pages tab, the 404 host's Page field and the access list's Denied page. Pure.

export const BUILTIN_DIR = "/usr/local/nginx/html/npmpro";
// read by the nginx workers (npmpro-worker), so under /data/public and not /data/npmpro (700/600, data-setup.sh)
export const PAGES_DIR = "/data/public/pages";
export const GLOBAL_DIR = `${PAGES_DIR}/global`;

// the types of the landing_pages row; the Default page is the default-site row
export const PAGE_TYPES = ["not_found", "upstream_error", "denied", "maintenance", "certificate", "ban", "captcha"];
export const PAGE_FILES = {
	not_found: "404.html",
	upstream_error: "upstream-error.html",
	denied: "denied.html",
	maintenance: "maintenance.html",
	certificate: "certificate.html",
	ban: "ban.html",
	captcha: "captcha.html",
	default_site: "default.html",
};
// the status code of a type's preview
export const SAMPLE_STATUS = {
	not_found: 404,
	upstream_error: 502,
	denied: 403,
	maintenance: 503,
	certificate: 495,
	ban: 403,
	captcha: 200,
	default_site: 200,
};
export const GLOBAL_CHOICES = ["npmpro", "custom"];

// each field's HTML is the column <column>_html. upstream: the upstream's own answer, plain: nginx's plain page
export const PLACES = {
	proxy_host: {
		dir: "proxy-host",
		fields: [
			{
				column: "npmpro_page_not_found",
				type: "not_found",
				choices: ["global", "npmpro", "custom", "upstream"],
				default: "upstream",
			},
			{
				column: "npmpro_page_upstream",
				type: "upstream_error",
				choices: ["global", "npmpro", "custom", "upstream"],
				default: "global",
			},
			{
				column: "npmpro_page_maintenance",
				type: "maintenance",
				choices: ["global", "npmpro", "custom"],
				default: "global",
			},
		],
	},
	dead_host: {
		dir: "dead-host",
		fields: [
			{ column: "npmpro_page", type: "not_found", choices: ["global", "npmpro", "custom"], default: "global" },
		],
	},
	access_list: {
		dir: "access-list",
		fields: [
			{
				column: "npmpro_denied_page",
				type: "denied",
				choices: ["global", "npmpro", "custom", "plain"],
				default: "global",
			},
		],
	},
};
export const PAGE_HTML_FIELDS = Object.values(PLACES).flatMap(({ fields }) =>
	fields.map(({ column }) => `${column}_html`),
);

/**
 * @param   {"proxy_host"|"dead_host"|"access_list"} kind
 * @param   {number} id
 * @returns {string}  the folder of the place's custom pages
 */
export const placeDir = (kind, id) => `${PAGES_DIR}/${PLACES[kind].dir}-${id}`;

/**
 * @param   {string} type
 * @param   {string} choice  global, npmpro, custom, upstream or plain
 * @param   {string} kind
 * @param   {number} id
 * @returns {string}  the file nginx serves, "" when nothing replaces the answer (upstream, plain)
 */
export const pageFile = (type, choice, kind, id) => {
	switch (choice) {
		case "global":
			return `${GLOBAL_DIR}/${PAGE_FILES[type]}`;
		case "npmpro":
			return `${BUILTIN_DIR}/${PAGE_FILES[type]}`;
		case "custom":
			return `${placeDir(kind, id)}/${PAGE_FILES[type]}`;
		default:
			return "";
	}
};

// the relations a list can expand that hold rows with page HTML of their own
const RELATIONS = ["access_lists", "locations", "proxy_hosts"];

/**
 * @param   {Object} row  a host or access list row (a model instance too), changed in place
 * @returns {Object}  the row without its page HTML, also in its expanded relations (lists: one page can be 1 MiB)
 */
export const withoutPageHtml = (row) => {
	if (!row || typeof row !== "object") return row;
	for (const field of PAGE_HTML_FIELDS) delete row[field];
	for (const key of RELATIONS) if (Array.isArray(row[key])) row[key].forEach(withoutPageHtml);
	return row;
};

/**
 * @param   {Object} row
 * @returns {Object}  a copy for the audit log: each page as its size
 */
export const auditPageHtml = (row) => ({
	...row,
	...Object.fromEntries(
		PAGE_HTML_FIELDS.filter((field) => typeof row?.[field] === "string" && row[field] !== "").map((field) => [
			field,
			`(${Buffer.byteLength(row[field], "utf8")} bytes)`,
		]),
	),
});
