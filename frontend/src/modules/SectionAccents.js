import { SECTION_COLORS } from "./SectionColors.js";

/**
 * The brand-gradient accent of each list section (tokens --accent-<name> in globals.css, registered as
 * section-<name> colours). It marks the page: title icon, count badge, empty-state icon and the active link of the
 * menu. Buttons stay primary. Class names are written out in full so Tailwind finds them. Pure, so node --test
 * checks it. The section keys are the ones of SectionColors.js.
 *
 * text: icon and dot colour; bg: tinted fill (text on it stays text-foreground); border: tinted edge;
 * underline: active link underline of the top bar; marker: active link marker of the sidebar
 */
const PRIMARY_ACCENT = Object.freeze({
	text: "text-primary",
	bg: "bg-primary/15",
	border: "border-primary/40",
	underline: "after:bg-[image:var(--brand-gradient)]",
	marker: "data-[active=true]:before:bg-primary",
});

const PROXY = Object.freeze({
	text: "text-section-proxy",
	bg: "bg-section-proxy/15",
	border: "border-section-proxy/40",
	underline: "after:bg-section-proxy",
	marker: "data-[active=true]:before:bg-section-proxy",
});
const REDIRECTION = Object.freeze({
	text: "text-section-redirection",
	bg: "bg-section-redirection/15",
	border: "border-section-redirection/40",
	underline: "after:bg-section-redirection",
	marker: "data-[active=true]:before:bg-section-redirection",
});
const DEAD = Object.freeze({
	text: "text-section-dead",
	bg: "bg-section-dead/15",
	border: "border-section-dead/40",
	underline: "after:bg-section-dead",
	marker: "data-[active=true]:before:bg-section-dead",
});
const STREAMS = Object.freeze({
	text: "text-section-streams",
	bg: "bg-section-streams/15",
	border: "border-section-streams/40",
	underline: "after:bg-section-streams",
	marker: "data-[active=true]:before:bg-section-streams",
});
const CERTIFICATES = Object.freeze({
	text: "text-section-certificates",
	bg: "bg-section-certificates/15",
	border: "border-section-certificates/40",
	underline: "after:bg-section-certificates",
	marker: "data-[active=true]:before:bg-section-certificates",
});
const ACCESS = Object.freeze({
	text: "text-section-access",
	bg: "bg-section-access/15",
	border: "border-section-access/40",
	underline: "after:bg-section-access",
	marker: "data-[active=true]:before:bg-section-access",
});
const USERS = Object.freeze({
	text: "text-section-users",
	bg: "bg-section-users/15",
	border: "border-section-users/40",
	underline: "after:bg-section-users",
	marker: "data-[active=true]:before:bg-section-users",
});

// settings has none: it keeps the primary look
const SECTION_ACCENTS = Object.freeze({
	proxyHosts: PROXY,
	redirectionHosts: REDIRECTION,
	deadHosts: DEAD,
	streams: STREAMS,
	certificates: CERTIFICATES,
	dnsCredentials: CERTIFICATES,
	accessLists: ACCESS,
	users: USERS,
	auditLog: USERS,
});

// the main nav links (Navigation.js ids) that belong to a section
const NAV_SECTIONS = Object.freeze({
	"proxy-hosts": "proxyHosts",
	"redirection-hosts": "redirectionHosts",
	"dead-hosts": "deadHosts",
	streams: "streams",
	certificates: "certificates",
	"access-lists": "accessLists",
});

/**
 * The accent classes of a section; the primary look for a page without one
 *
 * @param   {string} [section]  a key of SECTION_COLORS
 * @returns {{ text: string, bg: string, border: string, underline: string, marker: string }}
 */
function sectionAccent(section) {
	return Object.hasOwn(SECTION_COLORS, section) ? (SECTION_ACCENTS[section] ?? PRIMARY_ACCENT) : PRIMARY_ACCENT;
}

/**
 * The accent classes of a main nav link (Navigation.js id); dashboard, monitoring and settings keep the primary look
 *
 * @param   {string} [navId]
 * @returns {{ text: string, bg: string, border: string, underline: string, marker: string }}
 */
function navAccent(navId) {
	return sectionAccent(NAV_SECTIONS[navId]);
}

/**
 * The accent for a Tabler colour name as SectionColors.js gives it (older callers still pass color={sectionColor(..)}):
 * the first section with that colour, so pink (certificates and dnsCredentials) is the certificates accent; the
 * primary look for primary, settings' teal or an unknown colour
 *
 * @param   {string} [color]
 * @returns {{ text: string, bg: string, border: string, underline: string, marker: string }}
 */
function colorAccent(color) {
	const section = Object.keys(SECTION_COLORS).find((key) => SECTION_COLORS[key] === color);
	return sectionAccent(section);
}

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

/** The section of an export kind (proxy_hosts -> proxyHosts); undefined for an unknown kind */
function kindSection(kind) {
	return KIND_SECTIONS[kind];
}

export { colorAccent, kindSection, NAV_SECTIONS, navAccent, PRIMARY_ACCENT, SECTION_ACCENTS, sectionAccent };
