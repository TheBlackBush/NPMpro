import { fillPlaceholders } from "./placeholders.js";
import { SAMPLE_STATUS } from "./types.js";

// What a preview shows: the page with sample values, and the bouncer's captcha placeholders (filled by the bouncer for
// visitors) replaced so the page loads no provider script.
const SAMPLE = { remote_addr: "203.0.113.7", host: "example.com" };
const CAPTCHA = {
	"{{captcha_frontend_js}}": "data:,",
	"{{captcha_frontend_key}}": "npmpro-captcha-preview",
	"{{captcha_site_key}}": "",
};

/**
 * @param   {string} html
 * @param   {string} type
 * @param   {Object} [options]
 * @param   {Date}   [options.now]
 * @returns {string}
 */
export const previewHtml = (html, type, { now = new Date() } = {}) => {
	let page = fillPlaceholders(html, { ...SAMPLE, status: SAMPLE_STATUS[type], now });
	for (const [placeholder, value] of Object.entries(CAPTCHA)) page = page.replaceAll(placeholder, value);
	return page;
};
