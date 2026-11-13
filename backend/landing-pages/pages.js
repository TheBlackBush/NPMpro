// The eight built-in landing pages (Settings, Landing pages). build.js renders each with page-template.html and the
// texts of texts/<code>.json into rootfs/usr/local/nginx/html/npmpro/<file>. status: the code line shows the status
// nginx answers with (SSI), with this value as its default; null shows no code. fixedStatus: the code line shows status
// as written, without SSI (nginx answers an error_page 495 with 400, so $status would show 400). chips: the visitor's
// IP and the time.
// footer: the key of the line under the card.

export const TONES = {
	red: { accent: "#dc2626", tint: "#fef2f2", accentDark: "#f87171", tintDark: "rgba(248,113,113,.14)" },
	amber: { accent: "#d97706", tint: "#fffbeb", accentDark: "#fbbf24", tintDark: "rgba(251,191,36,.14)" },
	neutral: { accent: "#52525b", tint: "#f4f4f5", accentDark: "#a1a1aa", tintDark: "rgba(161,161,170,.14)" },
	blue: { accent: "#2563eb", tint: "#eff6ff", accentDark: "#60a5fa", tintDark: "rgba(96,165,250,.14)" },
};

const svg = (paths) =>
	`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const ICONS = {
	shieldOff: svg(
		'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m4.243 5.21 14.39 12.472"/>',
	),
	puzzle: svg(
		'<path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>',
	),
	unplug: svg(
		'<path d="m19 5 3-3"/><path d="m2 22 3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"/>',
	),
	lock: svg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
	searchMinus: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>'),
	wrench: svg(
		'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
	),
	triangleAlert: svg(
		'<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
	),
	house: svg(
		'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	),
};

export const PAGES = [
	{
		id: "ban",
		file: "ban.html",
		tone: "red",
		icon: "shieldOff",
		status: 403,
		chips: true,
		footer: "crowdsec",
		captcha: false,
	},
	{
		id: "captcha",
		file: "captcha.html",
		tone: "amber",
		icon: "puzzle",
		status: null,
		chips: true,
		footer: "crowdsec",
		captcha: true,
	},
	{
		id: "upstream_error",
		file: "upstream-error.html",
		tone: "red",
		icon: "unplug",
		status: 502,
		chips: true,
		footer: "npmpro",
		captcha: false,
	},
	{
		id: "denied",
		file: "denied.html",
		tone: "red",
		icon: "lock",
		status: 403,
		chips: true,
		footer: "npmpro",
		captcha: false,
	},
	{
		id: "not_found",
		file: "404.html",
		tone: "neutral",
		icon: "searchMinus",
		status: 404,
		chips: false,
		footer: "npmpro",
		captcha: false,
	},
	{
		id: "maintenance",
		file: "maintenance.html",
		tone: "amber",
		icon: "wrench",
		status: 503,
		chips: false,
		footer: "npmpro",
		captcha: false,
	},
	{
		id: "certificate",
		file: "certificate.html",
		tone: "amber",
		icon: "triangleAlert",
		status: 495,
		fixedStatus: true,
		chips: false,
		footer: "npmpro",
		captcha: false,
	},
	{
		id: "default_site",
		file: "default.html",
		tone: "blue",
		icon: "house",
		status: null,
		chips: false,
		footer: "npmpro",
		captcha: false,
	},
];
