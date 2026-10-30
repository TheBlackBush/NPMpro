/**
 * The accent colour of each section of the app (Tabler colour names): the list page stripes, the Add buttons, the
 * Save of the section's windows and the Settings Save bar, the Export and Import buttons of a list page. Windows
 * without a section keep primary; destructive actions stay danger. Pure, so node --test checks it.
 */

const SECTION_COLORS = Object.freeze({
	proxyHosts: "lime",
	redirectionHosts: "yellow",
	deadHosts: "red",
	streams: "blue",
	accessLists: "cyan",
	certificates: "pink",
	dnsCredentials: "pink",
	users: "orange",
	auditLog: "purple",
	settings: "teal",
});

// the export and import kinds of the list pages (ImportExportButtons) and their sections
const KIND_SECTIONS = Object.freeze({
	proxy_hosts: "proxyHosts",
	redirection_hosts: "redirectionHosts",
	dead_hosts: "deadHosts",
	streams: "streams",
	access_lists: "accessLists",
	certificates: "certificates",
	dns_credentials: "dnsCredentials",
});

/**
 * The Tabler colours whose button label is dark: Tabler's white label is below 4.5:1 on them and its dark text
 * (--tblr-dark) reads better, measured from the installed Tabler CSS (SectionColors.test.js)
 */
const DARK_LABEL_COLORS = Object.freeze([
	"azure",
	"cyan",
	"green",
	"info",
	"lime",
	"orange",
	"success",
	"teal",
	"warning",
	"yellow",
]);

/**
 * The colour of a section; primary for a window without one
 *
 * @param   {string} [section]  a key of SECTION_COLORS
 * @returns {string}
 */
function sectionColor(section) {
	return SECTION_COLORS[section] ?? "primary";
}

/**
 * The colour of a list page's export or import kind (proxy_hosts, certificates, ...)
 *
 * @param   {string} kind
 * @returns {string}
 */
function kindColor(kind) {
	return sectionColor(KIND_SECTIONS[kind]);
}

/**
 * The stripe on top of a section's card
 *
 * @param   {string} section
 * @returns {string}
 */
function stripeClass(section) {
	return `card-status-top bg-${sectionColor(section)}`;
}

/**
 * The style of a button of this colour: a dark label where Tabler's white one is hard to read (Tabler's own
 * variable for the label of a coloured button, so hover, active, disabled and the loading spinner follow it)
 *
 * @param   {string} [color]
 * @returns {Object|undefined}
 */
function buttonLabelStyle(color) {
	return DARK_LABEL_COLORS.includes(color) ? { "--tblr-btn-variant-fg": "var(--tblr-dark)" } : undefined;
}

export { buttonLabelStyle, DARK_LABEL_COLORS, KIND_SECTIONS, kindColor, SECTION_COLORS, sectionColor, stripeClass };
