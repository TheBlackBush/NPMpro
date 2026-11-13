// Builds the eight built-in landing pages into rootfs/usr/local/nginx/html/npmpro/ from page-template.html, pages.js,
// page-script.js, texts/<code>.json and the brand logos. The pages are committed; test/landing-pages-build.test.js
// fails when they differ from a fresh build.
// Usage (from backend/): node landing-pages/build.js          writes the pages and prints the script's CSP hash
//                        node landing-pages/build.js --check  exits 1 when a committed page is stale
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { ICONS, PAGES, TONES } from "./pages.js";

const HERE = import.meta.dirname;
const REPO = path.join(HERE, "../..");
export const OUT_DIR = path.join(REPO, "rootfs/usr/local/nginx/html/npmpro");
// the UI's languages (frontend/translations/ui), English first: the HTML holds its texts, the script the others
export const LANGUAGES = ["en", "de", "zh", "fr", "es", "pt", "ru", "it", "nl", "pl", "ja", "ko", "uk"];

const PLACEHOLDER = /@@([A-Z_]+)@@/gu;
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const SPECIAL = /[&<>"']/gu;
const CHIPS =
	'<div class="chips"><span class="chip">IP <!--# echo var="remote_addr" --></span><span class="chip" data-npmpro-time><!--# config timefmt="%Y-%m-%d %H:%M UTC" --><!--# echo var="date_gmt" --></span></div>';
const CAPTCHA_HEAD = '<script src="{{captcha_frontend_js}}" async defer></script>';
const CAPTCHA_FORM =
	'<form action="" method="POST" id="captcha-form" class="captcha"><div id="captcha" class="{{captcha_frontend_key}}" data-sitekey="{{captcha_site_key}}" data-callback="captchaCallback"></div></form>';

const read = (rel) => readFileSync(path.join(HERE, rel), "utf8");
const escapeHtml = (text) => text.replace(SPECIAL, (char) => ESCAPES[char]);
const logo = (name) =>
	`data:image/svg+xml;base64,${readFileSync(path.join(REPO, ".github/images/brand", name)).toString("base64")}`;

/** @returns {Record<string, Record<string, string>>} the texts by language code */
export const loadTexts = () =>
	Object.fromEntries(LANGUAGES.map((code) => [code, JSON.parse(read(`texts/${code}.json`))]));

/** @returns {string} the inline script, as every page holds it */
export const pageScript = () => read("page-script.js").trim();

/** @returns {string} the CSP source of the inline script, "sha256-<base64>" */
export const scriptHash = () => `sha256-${createHash("sha256").update(pageScript()).digest("base64")}`;

const textsOf = (page, texts) =>
	Object.fromEntries(
		LANGUAGES.map((code) => {
			const own = {
				title: texts[code][`${page.id}.title`],
				text: texts[code][`${page.id}.text`],
				witty: texts[code][`${page.id}.witty`],
				footer: texts[code][`footer.${page.footer}`],
			};
			for (const [key, value] of Object.entries(own)) {
				if (typeof value !== "string" || value.trim() === "")
					throw new Error(`${code}: the ${key} of ${page.id} is missing`);
			}
			return [code, own];
		}),
	);

const codeLine = (page) =>
	page.status === null
		? '<div class="gap"></div>'
		: `<div class="code"><!--# echo var="status" default="${page.status}" --></div>`;

/**
 * @param   {Object} page   an entry of PAGES
 * @param   {Object} texts  loadTexts()
 * @returns {string}  the page's HTML
 */
export const renderPage = (page, texts) => {
	const own = textsOf(page, texts);
	const tone = TONES[page.tone];
	const values = {
		ACCENT: tone.accent,
		TINT: tone.tint,
		ACCENT_DARK: tone.accentDark,
		TINT_DARK: tone.tintDark,
		HEAD_EXTRA: page.captcha ? CAPTCHA_HEAD : "",
		LOGO_LIGHT: logo("npmpro-horizontal-light.svg"),
		LOGO_DARK: logo("npmpro-horizontal-dark.svg"),
		ICON: ICONS[page.icon],
		TITLE: escapeHtml(own.en.title),
		CODE: codeLine(page),
		TEXT: escapeHtml(own.en.text),
		WITTY: escapeHtml(own.en.witty),
		CAPTCHA: page.captcha ? CAPTCHA_FORM : "",
		CHIPS: page.chips ? CHIPS : "",
		FOOTER: escapeHtml(own.en.footer),
		// inside <script>, so no "</script>" can end it early
		TEXTS: JSON.stringify(own).replaceAll("<", "\\u003c"),
		SCRIPT: pageScript(),
	};
	return read("page-template.html").replace(PLACEHOLDER, (whole, name) => {
		if (!Object.hasOwn(values, name)) throw new Error(`page-template.html: unknown placeholder ${whole}`);
		return values[name];
	});
};

/** @returns {{ file: string, html: string }[]} the eight pages, in the order of PAGES */
export const buildAll = () => {
	const texts = loadTexts();
	return PAGES.map((page) => ({ file: page.file, html: renderPage(page, texts) }));
};

if (process.argv[1] === import.meta.filename) {
	const pages = buildAll();
	if (process.argv.includes("--check")) {
		const stale = pages.filter(({ file, html }) => {
			try {
				return readFileSync(path.join(OUT_DIR, file), "utf8") !== html;
			} catch {
				return true;
			}
		});
		for (const { file } of stale) console.error(`stale: ${file}`);
		process.exitCode = stale.length > 0 ? 1 : 0;
	} else {
		mkdirSync(OUT_DIR, { recursive: true });
		for (const { file, html } of pages) writeFileSync(path.join(OUT_DIR, file), html);
		console.log(`wrote ${pages.length} pages to ${OUT_DIR}, script ${scriptHash()}`);
	}
}
