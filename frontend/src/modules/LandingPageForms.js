/**
 * The rules of the landing page fields: Settings, Landing pages, the proxy host's Pages tab, the 404 host's Page field
 * and the access list's Denied page. Pure, so node --test checks them without a DOM. The checks are the backend's
 * (backend/lib/landing-pages/html.js and placeholders.js): keep them equal.
 */
import { defaultSitePayload, defaultSiteValidate, defaultSiteValues } from "./SettingsForms.js";

export const MAX_PAGE_BYTES = 1024 * 1024;

// the global types as the API names them (camelized), in the order Settings shows them
export const PAGE_TYPES = Object.freeze([
	{
		key: "notFound",
		api: "not_found",
		labelId: "landing-pages.type.not-found",
	},
	{
		key: "upstreamError",
		api: "upstream_error",
		labelId: "landing-pages.type.upstream-error",
	},
	{ key: "denied", api: "denied", labelId: "landing-pages.type.denied" },
	{
		key: "maintenance",
		api: "maintenance",
		labelId: "landing-pages.type.maintenance",
	},
	{
		key: "certificate",
		api: "certificate",
		labelId: "landing-pages.type.certificate",
	},
	{ key: "ban", api: "ban", labelId: "landing-pages.type.ban" },
	{
		key: "captcha",
		api: "captcha",
		labelId: "landing-pages.type.captcha",
	},
]);
export const DEFAULT_PAGE = Object.freeze({
	key: "defaultSite",
	api: "default_site",
	labelId: "landing-pages.type.default-site",
});

// the page fields of each place (backend PLACES), the choices in the order the dropdown shows them
export const PLACE_FIELDS = Object.freeze({
	proxyHost: [
		{
			name: "npmproPageNotFound",
			api: "not_found",
			choices: ["global", "npmpro", "custom", "upstream"],
			default: "upstream",
			labelId: "landing-pages.field.not-found",
		},
		{
			name: "npmproPageUpstream",
			api: "upstream_error",
			choices: ["global", "npmpro", "custom", "upstream"],
			default: "global",
			labelId: "landing-pages.field.upstream-error",
		},
		{
			name: "npmproPageMaintenance",
			api: "maintenance",
			choices: ["global", "npmpro", "custom"],
			default: "global",
			labelId: "landing-pages.field.maintenance",
		},
	],
	deadHost: [
		{
			name: "npmproPage",
			api: "not_found",
			choices: ["global", "npmpro", "custom"],
			default: "global",
			labelId: "landing-pages.field.page",
		},
	],
	accessList: [
		{
			name: "npmproDeniedPage",
			api: "denied",
			choices: ["global", "npmpro", "custom", "plain"],
			default: "global",
			labelId: "landing-pages.field.denied",
		},
	],
});

/** @param {string} name a choice field @returns {string} its HTML field */
export const htmlName = (name) => `${name}Html`;

/**
 * @param   {{ api: string }} field
 * @param   {string} choice
 * @returns {string}  the label id of a choice ("upstream" reads differently for 404 and for the upstream error)
 */
export const choiceLabelId = (field, choice) => {
	if (choice === "upstream") {
		return field.api === "not_found" ? "landing-pages.choice.upstream-site" : "landing-pages.choice.upstream-error";
	}
	return `landing-pages.choice.${choice}`;
};

const COMMAND = /<!--#\s*([a-z]+)((?:\s+[a-z]+="[^"]*")*)\s*-->/gu;
const ATTRIBUTE = /([a-z]+)="([^"]*)"/gu;
const OPENER = /<!--#/gu;
const SPECIFIER = /%(.)/gsu;
const ECHO_VARS = new Set(["remote_addr", "date_gmt", "date_local", "status", "host"]);
const ECHO_ATTRIBUTES = new Set(["var", "default", "encoding"]);
const TIME_LETTERS = new Set(["Y", "m", "d", "H", "M", "S", "Z", "A", "b", "%"]);

/**
 * @param   {string} html
 * @returns {boolean}  every SSI command is one the backend allows
 */
export function ssiAllowed(html) {
	const commands = [...html.matchAll(COMMAND)];
	if (commands.length !== [...html.matchAll(OPENER)].length) return false;
	return commands.every(([, command, raw]) => {
		const attributes = Object.fromEntries([...raw.matchAll(ATTRIBUTE)].map(([, name, value]) => [name, value]));
		const names = Object.keys(attributes);
		if (command === "echo") {
			return (
				ECHO_VARS.has(attributes.var) &&
				names.every((name) => ECHO_ATTRIBUTES.has(name)) &&
				(attributes.encoding === undefined || attributes.encoding === "entity")
			);
		}
		if (command === "config") {
			return (
				names.length === 1 &&
				names[0] === "timefmt" &&
				[...attributes.timefmt.matchAll(SPECIFIER)].every(([, letter]) => TIME_LETTERS.has(letter))
			);
		}
		return false;
	});
}

/**
 * @param   {string} html
 * @returns {string|null}  the message id of what is wrong, null when the page can be saved
 */
export function pageHtmlError(html) {
	const text = String(html ?? "");
	if (text.trim() === "") return "error.required";
	if (new TextEncoder().encode(text).length > MAX_PAGE_BYTES) return "landing-pages.error.too-large";
	if (!text.isWellFormed() || text.includes("\u0000")) return "landing-pages.error.not-utf8";
	if (!ssiAllowed(text)) return "landing-pages.error.ssi";
	return null;
}

/**
 * @param   {Uint8Array} bytes  an uploaded file
 * @returns {{ html: string } | { error: string }}
 */
export function readPageFile(bytes) {
	if (bytes.length > MAX_PAGE_BYTES) return { error: "landing-pages.error.too-large" };
	try {
		return { html: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
	} catch {
		return { error: "landing-pages.error.not-utf8" };
	}
}

/**
 * @param   {"proxyHost"|"deadHost"|"accessList"} kind
 * @param   {Object} data  the loaded row (camelized), {} for a new one
 * @returns {Object}  the form values of the place's page fields
 */
export const placeDefaults = (kind, data) =>
	Object.fromEntries(
		PLACE_FIELDS[kind].flatMap((field) => [
			[field.name, data?.[field.name] ?? field.default],
			[htmlName(field.name), data?.[htmlName(field.name)] ?? ""],
		]),
	);

/**
 * @param   {"proxyHost"|"deadHost"|"accessList"} kind
 * @param   {Object} values  the form's values
 * @returns {Object}  the values for the request: the html of a place only with a custom choice (with another choice
 *                    the backend keeps the saved custom page)
 */
export const placePayload = (kind, values) => {
	const body = { ...values };
	for (const { name } of PLACE_FIELDS[kind]) {
		if (body[name] !== "custom") delete body[htmlName(name)];
	}
	return body;
};

/**
 * @param   {Object} rules  createValidations(intl)
 * @param   {"proxyHost"|"deadHost"|"accessList"} kind
 * @param   {Object} values
 * @returns {Object}  { [html field]: message } for each custom choice whose page cannot be saved
 */
export const placeErrors = (rules, kind, values) =>
	Object.fromEntries(
		PLACE_FIELDS[kind]
			.filter((field) => values[field.name] === "custom")
			.map((field) => [htmlName(field.name), pageHtmlError(values[htmlName(field.name)])])
			.filter(([, id]) => id !== null)
			.map(([name, id]) => [name, rules.message(id)]),
	);

/**
 * @param   {{ source: string, type?: string, id?: number }} what
 * @returns {string}  the preview URL (admins; nginx serves it sandboxed)
 */
export const previewPath = ({ source, type, id }) => {
	const base = "/api/settings/landing-pages/preview";
	if (source === "proxy-host") return `${base}/proxy-host/${id}/${type}`;
	if (source === "dead-host" || source === "access-list") return `${base}/${source}/${id}`;
	return `${base}/${source}/${type}`;
};

/**
 * @param   {Object} data  GET /settings/landing-pages, camelized
 * @returns {Object}  { defaultSite: the default site's form values, pages: { [key]: { choice, html } } }
 */
export const landingValues = (data) => ({
	defaultSite: { ...defaultSiteValues(data.defaultSite), meta: data.defaultSite?.meta ?? {} },
	pages: Object.fromEntries(
		PAGE_TYPES.map(({ key }) => [
			key,
			{ choice: data.pages?.[key]?.choice ?? "npmpro", html: data.pages?.[key]?.html ?? "" },
		]),
	),
});

/**
 * @param   {Object} rules
 * @returns {Function}  (values) => nested errors (defaultSite.*, pages.<key>.html)
 */
export const landingValidate = (rules) => {
	const site = defaultSiteValidate(rules);
	return (values) => {
		const errors = {};
		const siteErrors = site(values.defaultSite);
		if (Object.keys(siteErrors).length > 0) errors.defaultSite = siteErrors;
		for (const { key } of PAGE_TYPES) {
			const page = values.pages[key];
			// only a custom page is checked: another choice does not send its html (landingPayload)
			const id = page.choice === "custom" ? pageHtmlError(page.html) : null;
			if (id) {
				errors.pages ??= {};
				errors.pages[key] = { html: rules.message(id) };
			}
		}
		return errors;
	};
};

/**
 * @param   {Object} values  the form's values
 * @param   {Object} saved   the values it started from (formState.defaultValues after resetToSaved)
 * @returns {Object}  the PUT body: the default site when it changed, the pages that changed
 */
export const landingPayload = (values, saved) => {
	const body = {};
	const { meta: _meta, ...site } = values.defaultSite;
	const { meta: savedMeta, ...savedSite } = saved.defaultSite;
	if (JSON.stringify(site) !== JSON.stringify(savedSite)) {
		const { id: _id, ...payload } = defaultSitePayload(values.defaultSite, { meta: savedMeta ?? {} });
		body.defaultSite = payload;
	}
	const pages = Object.fromEntries(
		PAGE_TYPES.filter(
			({ key }) =>
				values.pages[key].choice !== saved.pages[key].choice ||
				(values.pages[key].choice === "custom" && values.pages[key].html !== saved.pages[key].html),
		).map(({ key }) => {
			const { choice, html } = values.pages[key];
			// html only with a custom page: with another choice the backend keeps the saved custom page
			return [key, choice === "custom" ? { choice, html } : { choice }];
		}),
	);
	if (Object.keys(pages).length > 0) body.pages = pages;
	return body;
};
