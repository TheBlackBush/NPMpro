import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { MAIL_LANGUAGES } from "../lib/mail/settings-rules.js";
import test from "./templates/test.js";

const TEMPLATES = { test };
const FALLBACK = "en";
const PLACEHOLDER = /\{(?<name>\w+)\}/gu;
const SUBJECT_STRIP = /[\p{Cc}\u2028\u2029\u0085]+/gu;
const TEXT_BREAKS = /[\r\n\u2028\u2029\u0085]+/gu;
const SUBJECT_MAX = 200;
const WEB_PROTOCOLS = new Set(["https:", "http:"]);
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const HTML_SPECIALS = /[&<>"']/gu;

const FONT = "font-family:Arial,Helvetica,sans-serif;color:#1f2933;";
const CELL = `${FONT}font-size:15px;line-height:1.5;padding:0 0 12px 0;`;

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

/**
 * A translate function: the language's string for the key, else English's, else the key; `{name}` is replaced
 * by the value (plain text, escaping is the renderer's job)
 *
 * @param   {string}  language
 * @param   {Object}  tables    language code to key to string table
 * @returns {Function}
 */
const makeT =
	(language, tables) =>
	(key, values = {}) => {
		const text = tables[language]?.[key] ?? tables[FALLBACK]?.[key] ?? key;
		return text.replace(PLACEHOLDER, (whole, ...rest) => {
			const { name } = rest.at(-1);
			return Object.hasOwn(values, name) ? String(values[name]) : whole;
		});
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

const htmlPart = (model, language) => {
	const rows = model.lines.map((line) => `<tr><td style="${CELL}">${escapeHtml(line)}</td></tr>`);
	if (model.button) {
		rows.push(
			`<tr><td style="${CELL}"><a href="${escapeHtml(model.button.url)}" style="display:inline-block;padding:10px 20px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">${escapeHtml(model.button.label)}</a></td></tr>`,
		);
	}
	if (model.list?.length) {
		const items = model.list
			.map(
				(item) =>
					`<li>${escapeHtml(item.text)}${item.note ? ` <span style="color:#6b7280;">(${escapeHtml(item.note)})</span>` : ""}</li>`,
			)
			.join("");
		rows.push(`<tr><td style="${CELL}"><ul style="margin:0;padding-left:20px;">${items}</ul></td></tr>`);
	}
	for (const line of model.footer ?? []) {
		rows.push(
			`<tr><td style="${FONT}font-size:13px;line-height:1.5;color:#6b7280;padding:0 0 4px 0;">${escapeHtml(line)}</td></tr>`,
		);
	}
	return `<!DOCTYPE html><html lang="${escapeHtml(language)}"><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;background:#f3f4f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;"><tr><td style="padding:24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr></table></body></html>`;
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
 * @returns {{subject: string, text: string, html: string}}
 */
const renderMail = (templateId, { language = FALLBACK, data = {}, instance } = {}, tables = loadDictionaries()) => {
	const template = TEMPLATES[templateId];
	if (!template) throw new Error(`Unknown mail template ${templateId}`);
	const name = instance || hostname();
	const model = template({ t: makeT(language, tables), data, instance: name });
	const subject = `[NPMpro ${name}] ${model.subject}`.replace(SUBJECT_STRIP, " ").slice(0, SUBJECT_MAX);
	if (model.button) checkButtonUrl(model.button.url);
	return { subject, text: textPart(model), html: htmlPart(model, tables[language] ? language : FALLBACK) };
};

export { escapeHtml, loadDictionaries, makeT, renderMail, TEMPLATES };
