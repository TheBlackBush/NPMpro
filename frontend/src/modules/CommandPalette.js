/**
 * The command palette (Ctrl+K): the pages and Settings sections of modules/Navigation.js, and the items of the list
 * endpoints (hosts, streams, certificates, access lists, users), each type only when the user may see its page. Plain
 * data and pure functions, so node --test checks them; the shell's CommandPalette.jsx renders them with cmdk.
 */

/**
 * The item types: the page that lists them (a type shows only when the user may see that page), the list query (key
 * and the api function's name in src/api/backend), the text an item is found and shown by, and what choosing it opens
 * (the window of src/modals, or the certificates list filtered by the name: certificates have no window).
 */
export const PALETTE_TYPES = [
	{
		id: "proxy-hosts",
		pageId: "proxy-hosts",
		titleKey: "proxy-hosts",
		icon: "Zap",
		queryKey: "proxy-hosts",
		fetch: "getProxyHosts",
		label: (row) => row.domainNames.join(", "),
		detail: (row) => `${row.forwardScheme}://${row.forwardHost}${row.forwardPort ? `:${row.forwardPort}` : ""}`,
		open: { modal: "showProxyHostModal" },
	},
	{
		id: "redirection-hosts",
		pageId: "redirection-hosts",
		titleKey: "redirection-hosts",
		icon: "Shuffle",
		queryKey: "redirection-hosts",
		fetch: "getRedirectionHosts",
		label: (row) => row.domainNames.join(", "),
		detail: (row) => `${row.forwardScheme}://${row.forwardDomainName}`,
		open: { modal: "showRedirectionHostModal" },
	},
	{
		id: "dead-hosts",
		pageId: "dead-hosts",
		titleKey: "dead-hosts",
		icon: "ZapOff",
		queryKey: "dead-hosts",
		fetch: "getDeadHosts",
		label: (row) => row.domainNames.join(", "),
		detail: () => "",
		open: { modal: "showDeadHostModal" },
	},
	{
		id: "streams",
		pageId: "streams",
		titleKey: "streams",
		icon: "Disc",
		queryKey: "streams",
		fetch: "getStreams",
		label: (row) => String(row.incomingPort),
		detail: (row) => `${row.forwardingHost}:${row.forwardingPort}`,
		open: { modal: "showStreamModal" },
	},
	{
		id: "certificates",
		pageId: "certificates",
		titleKey: "certificates",
		icon: "BadgeCheck",
		queryKey: "certificates",
		fetch: "getCertificates",
		label: (row) => row.niceName || row.domainNames.join(", "),
		detail: (row) => (row.niceName ? row.domainNames.join(", ") : ""),
		open: { route: (row) => `/certificates?q=${encodeURIComponent(row.niceName || row.domainNames[0] || "")}` },
	},
	{
		id: "access-lists",
		pageId: "access-lists",
		titleKey: "access-lists",
		icon: "Lock",
		queryKey: "access-lists",
		fetch: "getAccessLists",
		label: (row) => row.name,
		detail: () => "",
		open: { modal: "showAccessListModal" },
	},
	{
		id: "users",
		pageId: "users",
		titleKey: "users",
		icon: "Users",
		queryKey: "users",
		fetch: "getUsers",
		label: (row) => row.name,
		detail: (row) => row.email ?? "",
		open: { modal: "showUserModal", section: "users" },
	},
];

/**
 * The item types a user may see: those whose list page is among the visible groups' pages
 *
 * @param   {Object[]} groups  modules/Navigation.js visibleGroups
 * @returns {Object[]}
 */
export function paletteTypes(groups) {
	const visible = new Set(groups.flatMap((group) => group.pages.map((page) => page.id)));
	return PALETTE_TYPES.filter((type) => visible.has(type.pageId));
}

/**
 * The palette's items of one type: a unique value for cmdk, the row's id, the text it is shown and found by
 *
 * @param   {Object}   type  of PALETTE_TYPES
 * @param   {Object[]} rows  the list endpoint's rows (camelCase, as src/api/backend returns them)
 * @returns {Array<{ value: string, id: number, row: Object, label: string, detail: string, keywords: string[] }>}
 */
export function itemsOf(type, rows) {
	return (rows ?? []).map((row) => {
		const label = type.label(row);
		const detail = type.detail(row);
		return { value: `${type.id}:${row.id}`, id: row.id, row, label, detail, keywords: [label, detail] };
	});
}

/**
 * The palette's pages: every visible page with its group (to show and to search by)
 *
 * @param   {Object[]} groups  modules/Navigation.js visibleGroups
 * @returns {Array<{ value: string, page: Object, group: Object }>}
 */
export const pageItems = (groups) =>
	groups.flatMap((group) => group.pages.map((page) => ({ value: `page:${page.id}`, page, group })));

// text compared without case and accents: "Zertifikat" finds "zertifikat", "zoe" finds "Zoë"
const ACCENTS = /\p{Diacritic}/gu;
const WORDS = /\s+/u;
const normalize = (text) =>
	String(text ?? "")
		.normalize("NFD")
		.replace(ACCENTS, "")
		.toLowerCase();
// a separator inside a text: a word after it starts a part of a name (www.example.com: "example")
const SEPARATOR = /[./:,_@-]/u;

// how well a word fits a text: 1 at the start of the text or of a word, 0.75 after a separator, 0.5 anywhere, else 0
function wordScore(text, word) {
	let best = 0;
	for (let at = text.indexOf(word); at !== -1 && best < 1; at = text.indexOf(word, at + 1)) {
		const before = text[at - 1];
		const score = at === 0 || before === " " ? 1 : SEPARATOR.test(before) ? 0.75 : 0.5;
		best = Math.max(best, score);
	}
	return best;
}

/**
 * How well a search matches an item's texts, 0 (no match) to 1: every word of the search must be in one of the texts;
 * a word at the start of a text or of a word scores highest, after a separator next (www.example.com: "example"),
 * anywhere inside last. The palette's filter (cmdk's filter prop: value, search, keywords).
 *
 * @param   {string[]} texts
 * @param   {string}   search
 * @returns {number}
 */
export function matchScore(texts, search) {
	const words = normalize(search).split(WORDS).filter(Boolean);
	if (words.length === 0) return 1;
	const haystack = texts.map(normalize).filter(Boolean);
	let total = 0;
	for (const word of words) {
		const best = Math.max(0, ...haystack.map((text) => wordScore(text, word)));
		if (best === 0) return 0;
		total += best;
	}
	return total / words.length;
}

/** cmdk's filter: the item's keywords (its texts), or its value without them */
export const paletteFilter = (value, search, keywords) => matchScore(keywords?.length ? keywords : [value], search);
