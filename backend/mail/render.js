import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { MAIL_LANGUAGES } from "../lib/mail/settings-rules.js";
import alerts from "./templates/alerts.js";
import invite from "./templates/invite.js";
import passwordReset from "./templates/password-reset.js";
import resetLink from "./templates/reset-link.js";
import test from "./templates/test.js";

const TEMPLATES = { alerts, invite, "password-reset": passwordReset, "reset-link": resetLink, test };
const FALLBACK = "en";
const PLACEHOLDER = /\{(?<name>\w+)\}/gu;
const SUBJECT_STRIP = /[\p{Cc}\u2028\u2029\u0085]+/gu;
const TEXT_BREAKS = /[\r\n\u2028\u2029\u0085]+/gu;
const SUBJECT_MAX = 200;
const WEB_PROTOCOLS = new Set(["https:", "http:"]);
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const HTML_SPECIALS = /[&<>"']/gu;

const LOGO_CID = "logo@npmpro";
const LOGO_FILE = new URL("./logo.png", import.meta.url);
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
// the header colour also as a one-colour gradient: the Gmail app in dark mode recolours background colours but leaves
// gradients alone, so the white logo keeps its dark band (clients without gradients use the background colour)
const NAVY = "#0b1020";
const HEADER_FILL = `linear-gradient(${NAVY},${NAVY})`;
// the 4 px line under the header: a spacer cell whose font size and exact line height equal its height, since Outlook
// on Windows grows a cell to the line height of its text and ignores font-size:0
const GRADIENT = "linear-gradient(90deg,#ff8a00,#ff2d55 30%,#d91aff 60%,#7a3bff 85%,#00d1ff)";
// dark mode and phone rules: the one style block, the rest of the layout is inline
const DARK_RULES = [
	["bg", "background", "#0b1020"],
	["card", "background", "#141b2e"],
	["tx", "color", "#e6e8ee"],
	["mt", "color", "#9aa3b5"],
	["ln", "border-color", "#26304a"],
	["lk", "color", "#b99cff"],
]
	.map(([name, property, color]) => `.${name}{${property}:${color}!important}`)
	.join("");
const PHONE_RULES = [
	["pad", "padding", "24px 20px"],
	["hd", "padding", "20px"],
]
	.map(([name, property, size]) => `.${name}{${property}:${size}!important}`)
	.join("");
const STYLES = `@media (prefers-color-scheme: dark){${DARK_RULES}}@media (max-width:620px){${PHONE_RULES}}`;
// pads the hidden preheader so an inbox snippet stops after it instead of reading on into the heading
const PREHEADER_FILLER = "&zwnj;&nbsp;".repeat(100);
// Outlook on Windows ignores max-width: a fixed 600 px table only it reads keeps the card at that width there
const MSO_OPEN =
	// biome-ignore lint/security/noSecrets: markup, not a secret
	'<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->';
// biome-ignore lint/security/noSecrets: markup, not a secret
const MSO_CLOSE = "<!--[if mso]></td></tr></table><![endif]-->";
// a long host name in the heading, a line, a list item or the link breaks instead of widening the card on a phone
const WRAP = "overflow-wrap:anywhere;word-break:break-word;";
// the logo's alt text reads white on the header when a client hides images
const LOGO_ALT = `color:#ffffff;${FONT}font-size:20px;font-weight:700;`;
const PARAGRAPH = `${FONT}margin:0 0 14px;font-size:16px;line-height:1.6;color:#1f2933;`;
const MUTED = "font-size:13px;line-height:1.5;color:#6b7280;";

const escapeHtml = (value) => String(value).replace(HTML_SPECIALS, (char) => HTML_ESCAPES[char]);

let dictionaries = null;

/**
 * Every language file, read once
 *
 * @returns {Object} language code to its key to string table
 */
const loadDictionaries = () => {
	if (!dictionaries) {
		dictionaries = {};
		for (const code of MAIL_LANGUAGES) {
			dictionaries[code] = JSON.parse(
				readFileSync(new URL(`./translations/${code}.json`, import.meta.url), "utf8"),
			);
		}
	}
	return dictionaries;
};

const fill = (text, values) =>
	text.replace(PLACEHOLDER, (whole, ...rest) => {
		const { name } = rest.at(-1);
		return Object.hasOwn(values, name) ? String(values[name]) : whole;
	});

// the plural category of a count in a language (zero, one, two, few, many, other); other for a code Intl rejects
const categoryOf = (language, count) => {
	try {
		return new Intl.PluralRules(language).select(count);
	} catch {
		return "other";
	}
};

/**
 * A translate function: the language's string for the key, else English's, else the key; `{name}` is replaced
 * by the value (plain text, escaping is the renderer's job). `t.plural(key, count, values)` picks the string
 * `key.<category>` of the count's plural category in the language (`one`, `few`, `many`, `other` and so on: each
 * language file holds the categories its language uses), else `key.other`, each in the language and then in English;
 * `{count}` is filled in. `t.language` is the language in use (English for an unknown code).
 *
 * @param   {string}  language
 * @param   {Object}  tables    language code to key to string table
 * @returns {Function}
 */
const makeT = (language, tables) => {
	const find = (key) => tables[language]?.[key] ?? tables[FALLBACK]?.[key];
	const t = (key, values = {}) => fill(find(key) ?? key, values);
	t.language = tables[language] ? language : FALLBACK;
	t.plural = (key, count, values = {}) => {
		const category = categoryOf(language, count);
		const text =
			tables[language]?.[`${key}.${category}`] ??
			tables[language]?.[`${key}.other`] ??
			tables[FALLBACK]?.[`${key}.${category}`] ??
			tables[FALLBACK]?.[`${key}.other`] ??
			`${key}.other`;
		return fill(text, { ...values, count });
	};
	return t;
};

const oneLine = (text) => String(text).replace(TEXT_BREAKS, " ");

/**
 * A button link must be an absolute http or https URL: anything else is a caller bug
 *
 * @param {string} url
 */
const checkButtonUrl = (url) => {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("A mail button needs an absolute https or http URL");
	}
	if (!WEB_PROTOCOLS.has(parsed.protocol)) throw new Error("A mail button needs an absolute https or http URL");
};

const textPart = (model) => {
	const blocks = [...model.lines];
	if (model.button) blocks.push(`${model.button.label}: ${model.button.url}`);
	if (model.list?.length) {
		blocks.push(
			model.list
				.map((item) => `- ${oneLine(item.text)}${item.note ? ` (${oneLine(item.note)})` : ""}`)
				.join("\n"),
		);
	}
	if (model.footer?.length) blocks.push(`-- \n${model.footer.join("\n")}`);
	return `${blocks.join("\n\n")}\n`;
};

let logo = null;

// the logo of the layout, read once: an inline attachment the HTML points at with cid:
const logoAttachment = () => {
	logo ??= readFileSync(LOGO_FILE);
	return {
		filename: "npmpro-logo.png",
		cid: LOGO_CID,
		content: logo,
		contentType: "image/png",
		contentDisposition: "inline",
	};
};

const buttonHtml = (button, fallback) =>
	`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;"><tr><td style="border-radius:8px;background:#7c3aed;padding:13px 26px;"><a href="${escapeHtml(button.url)}" style="${FONT}font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(button.label)}</a></td></tr></table><p class="mt" style="${FONT}margin:14px 0 0;${MUTED}">${escapeHtml(fallback)}<br><a class="lk" href="${escapeHtml(button.url)}" style="color:#6d28d9;word-break:break-all;">${escapeHtml(button.url)}</a></p>`;

const listHtml = (list) => {
	const items = list
		.map(
			(item) =>
				`<li class="tx" style="margin:0 0 6px;">${escapeHtml(item.text)}${item.note ? ` <span class="mt" style="color:#6b7280;">(${escapeHtml(item.note)})</span>` : ""}</li>`,
		)
		.join("");
	return `<ul style="${FONT}margin:0 0 14px;padding-left:22px;font-size:16px;line-height:1.6;color:#1f2933;">${items}</ul>`;
};

const htmlPart = (model, language, t) => {
	const paragraphs = model.lines.map((line) => `<p class="tx" style="${PARAGRAPH}">${escapeHtml(line)}</p>`).join("");
	const button = model.button ? buttonHtml(model.button, t("button.fallback")) : "";
	const list = model.list?.length ? listHtml(model.list) : "";
	const footer =
		model.footer?.length > 0
			? `<p class="mt ln" style="${FONT}margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;${MUTED}">${model.footer.map(escapeHtml).join("<br>")}</p>`
			: "";
	const preheader = escapeHtml(model.lines[0] ?? "");
	const heading = escapeHtml(model.subject);
	return `<!DOCTYPE html><html lang="${escapeHtml(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${heading}</title><style>${STYLES}</style></head><body class="bg" style="margin:0;padding:0;background:#f4f5f8;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;font-size:1px;line-height:1px;">${preheader}${PREHEADER_FILLER}</div><table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;"><tr><td align="center" style="padding:32px 12px;">${MSO_OPEN}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td class="hd" style="background:#0b1020;background-image:${HEADER_FILL};padding:24px 32px;border-radius:12px 12px 0 0;"><img src="cid:${LOGO_CID}" width="168" height="69" alt="NPMpro" style="display:block;border:0;width:168px;height:auto;${LOGO_ALT}"></td></tr><tr><td height="4" style="height:4px;mso-line-height-rule:exactly;line-height:4px;font-size:4px;background:#d91aff;background-image:${GRADIENT};">&nbsp;</td></tr><tr><td class="card pad" style="background:#ffffff;padding:32px;border-radius:0 0 12px 12px;${WRAP}"><h1 class="tx" style="${FONT}margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827;font-weight:700;">${heading}</h1>${paragraphs}${list}${button}${footer}</td></tr></table>${MSO_CLOSE}</td></tr></table></body></html>`;
};

/**
 * Render a mail template into its subject, plain text and HTML parts
 *
 * @param   {string}  templateId
 * @param   {Object}  input
 * @param   {string}  [input.language]  a mail language code, else English
 * @param   {Object}  [input.data]      the template's values
 * @param   {string}  [input.instance]  the instance name (public host or container host name)
 * @param   {Object}  [tables]          language tables, for tests
 * @returns {{subject: string, text: string, html: string, attachments: Object[]}}  the attachments hold the inline
 *          logo the HTML points at (cid), for both the direct and the queued send
 */
const renderMail = (templateId, { language = FALLBACK, data = {}, instance } = {}, tables = loadDictionaries()) => {
	const template = TEMPLATES[templateId];
	if (!template) throw new Error(`Unknown mail template ${templateId}`);
	const name = instance || hostname();
	const t = makeT(language, tables);
	const model = template({ t, data, instance: name });
	const subject = `[NPMpro ${name}] ${model.subject}`.replace(SUBJECT_STRIP, " ").slice(0, SUBJECT_MAX);
	if (model.button) checkButtonUrl(model.button.url);
	return {
		subject,
		text: textPart(model),
		html: htmlPart(model, tables[language] ? language : FALLBACK, t),
		attachments: [logoAttachment()],
	};
};

export { escapeHtml, loadDictionaries, makeT, renderMail, TEMPLATES };
