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
 * How much darker than the button a dark-label button gets on hover and active. Tabler darkens by 0.06 of the
 * lightness (--tblr-<colour>-darken), which takes the dark label below 4.5:1 on teal, azure, cyan, info and orange;
 * this step keeps every DARK_LABEL_COLORS colour at 4.5:1 or more (SectionColors.test.js measures it).
 */
const DARK_LABEL_DARKEN = 0.015;

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
 * variable for the label of a coloured button, so hover, active, disabled and the loading spinner follow it) and a
 * gentler hover and active background (Tabler's --tblr-btn-variant-darken, which both states use, in Tabler's own
 * oklch formula with a smaller step), so the dark label keeps 4.5:1 in every state
 *
 * @param   {string} [color]
 * @returns {Object|undefined}
 */
function buttonLabelStyle(color) {
	return DARK_LABEL_COLORS.includes(color)
		? {
				"--tblr-btn-variant-fg": "var(--tblr-dark)",
				"--tblr-btn-variant-darken": `oklch(from var(--tblr-${color}) calc(l - ${DARK_LABEL_DARKEN}) c h)`,
				// the light darkening keeps the label readable but is a faint cue: hover and press also get Tabler's
				// darker edge, which carries no text
				"--tblr-btn-hover-border-color": `var(--tblr-${color}-darken)`,
				"--tblr-btn-active-border-color": `var(--tblr-${color}-darken)`,
			}
		: undefined;
}

export {
	buttonLabelStyle,
	DARK_LABEL_COLORS,
	DARK_LABEL_DARKEN,
	KIND_SECTIONS,
	kindColor,
	SECTION_COLORS,
	sectionColor,
	stripeClass,
};
