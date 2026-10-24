const OIDC_ERROR_CODES = [
	"not_configured",
	"provider_error",
	"no_email",
	"email_not_verified",
	"no_user",
	"domain_not_allowed",
	"user_disabled",
];

const OIDC_BUILTIN_ICONS = [
	"key",
	"lock",
	"login",
	"shield-lock",
	"user-circle",
	"brand-google",
	"brand-github",
	"brand-gitlab",
	"brand-windows",
	"cloud",
];

// Light theme root values of --tblr-<name> in tabler.css (converted from oklch). "dark" is a slate grey
// instead of --tblr-dark, so that the button still stands out on the dark theme's card background.
const OIDC_COLOR_PRESETS = [
	{ name: "blue", value: "#066fd1" },
	{ name: "azure", value: "#4299e1" },
	{ name: "indigo", value: "#4263eb" },
	{ name: "purple", value: "#ae3ec9" },
	{ name: "red", value: "#d63939" },
	{ name: "orange", value: "#f76707" },
	{ name: "green", value: "#2fb344" },
	{ name: "dark", value: "#3d4757" },
];

const OIDC_ICON_MAX_BYTES = 256 * 1024;

const EDITABLE_KEYS = [
	"enabled",
	"issuerUrl",
	"clientId",
	"clientSecret",
	"redirectDomain",
	"scopes",
	"requireVerifiedEmail",
	"skipMfa",
	"disablePassword",
	"autoCreate",
	"button",
];

const camel = (s) => s.replaceAll(/_(?<c>[a-z])/gu, (...m) => m.at(-1).c.toUpperCase());

/**
 * Black or white, whichever has the higher WCAG contrast against the hex background
 */
const contrastText = (hex) => {
	const channels = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	const l = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
	return 1.05 / (l + 0.05) > (l + 0.05) / 0.05 ? "#ffffff" : "#000000";
};

const DEFAULT_OIDC_COLOR = "#206bc4";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

const isOidcColor = (hex) => HEX_COLOR.test(hex ?? "");

const validOidcColor = (hex) => (isOidcColor(hex) ? hex : DEFAULT_OIDC_COLOR);

/**
 * Public url of the uploaded icon; the version busts the cache when the file changes
 */
const oidcIconUrl = (updatedOn) => `/api/oidc/icon?v=${encodeURIComponent(updatedOn ?? "")}`;

/**
 * Hex colour darkened by amount (0 to 1)
 */
const shade = (hex, amount) =>
	`#${[1, 3, 5]
		.map((i) =>
			Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

const oidcErrorKey = (code) => `login.oidc-error.${OIDC_ERROR_CODES.includes(code) ? code : "provider_error"}`;

/**
 * Pure part of takeOidcError: the error code and the url without the parameter
 */
const readOidcError = (href) => {
	const url = new URL(href);
	const code = url.searchParams.get("oidc_error");
	if (code === null) return { code: null, url: href };
	url.searchParams.delete("oidc_error");
	return { code, url: url.toString() };
};

/**
 * Reads ?oidc_error= from the current location and removes it from the address bar
 */
let takenOidcError;
const takeOidcError = () => {
	// Cached so that a second call in the same page load (React StrictMode) gets the same code
	if (takenOidcError !== undefined) return takenOidcError;
	const { code, url } = readOidcError(window.location.href);
	if (code !== null) window.history.replaceState(null, "", url);
	takenOidcError = code;
	return code;
};

/**
 * Forgets the cached error, so that a later login page (after a sign-in and a logout) starts clean
 */
const clearOidcError = () => {
	takenOidcError = undefined;
};

const withoutFileIcon = (button) => {
	if (button?.icon?.type !== "file") return button;
	const { icon: _icon, ...rest } = button;
	return rest;
};

/**
 * Only the editable keys, without locked ones and without an empty client secret.
 * An uploaded file icon is never sent (the API only accepts built-in icons in a save, files have their own endpoints).
 */
const oidcSettingsPayload = (values) => {
	const locked = new Set((values.locked ?? []).map(camel));
	const payload = {};
	for (const key of EDITABLE_KEYS) {
		const skip = locked.has(key) || values[key] === undefined || (key === "clientSecret" && !values[key]);
		if (!skip) payload[key] = key === "button" ? withoutFileIcon(values.button) : values[key];
	}
	return payload;
};

const OIDC_MAX_DOMAINS = 100;

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/u;

/**
 * Comma separated text to trimmed, lower-case, de-duplicated entries
 */
const parseDomains = (text) => [
	...new Set(
		(text ?? "")
			.split(",")
			.map((domain) => domain.trim().toLowerCase())
			.filter(Boolean),
	),
];

const isOidcDomain = (domain) => DOMAIN_PATTERN.test(domain);

export {
	camel,
	clearOidcError,
	contrastText,
	DEFAULT_OIDC_COLOR,
	isOidcColor,
	isOidcDomain,
	OIDC_BUILTIN_ICONS,
	OIDC_COLOR_PRESETS,
	OIDC_ICON_MAX_BYTES,
	OIDC_MAX_DOMAINS,
	oidcErrorKey,
	oidcIconUrl,
	oidcSettingsPayload,
	parseDomains,
	readOidcError,
	shade,
	takeOidcError,
	validOidcColor,
};
