import { createHash } from "node:crypto";
import nodeFs from "node:fs/promises";
import path from "node:path";
import { CROWDSEC_CONF_PATH, parseConfLines } from "../crowdsec/config.js";
import { rooted } from "../paths.js";
import { pageHtmlProblems } from "./html.js";

// The ban and captcha pages from before Landing pages: the bouncer read them from BAN_TEMPLATE_PATH and
// CAPTCHA_TEMPLATE_PATH (default /data/crowdsec/ban.html and captcha.html, copies of the image's stock pages). Once,
// at the first start after the update (and after a restore of an older backup's CrowdSec files): a stock page is
// removed, a hand-edited one becomes the custom page and is kept as <file>.before-pages.

export const LEGACY_PAGES = {
	ban: {
		file: "/data/crowdsec/ban.html",
		stock: "/etc/ban.html.original",
		key: "ban_template_path",
		line: "BAN_TEMPLATE_PATH",
	},
	captcha: {
		file: "/data/crowdsec/captcha.html",
		stock: "/etc/captcha.html.original",
		key: "captcha_template_path",
		line: "CAPTCHA_TEMPLATE_PATH",
	},
};
const NPMPRO = { choice: "npmpro", html: "" };

const underData = (value) =>
	typeof value === "string" &&
	value.startsWith("/data/") &&
	path.posix.normalize(value) === value &&
	!value.endsWith("/");

/**
 * @param   {Object} sources
 * @param   {Object|null} sources.stored  the item 30 crowdsec row's meta (null without a row)
 * @param   {Record<string, string>|null} sources.lines  the old crowdsec.conf (parseConfLines)
 * @returns {{ ban: string, captcha: string }}  each page's file; anything not a plain path under /data/ is the default
 */
export const legacyPagePaths = ({ stored, lines }) =>
	Object.fromEntries(
		Object.entries(LEGACY_PAGES).map(([type, legacy]) => {
			const raw = stored ? stored[legacy.key] : lines?.[legacy.line];
			const value = typeof raw === "string" ? raw.trim() : "";
			return [type, underData(value) ? value : legacy.file];
		}),
	);

// the crowdsec store opens the database on import: loaded on first use, so the pure parts run without one
const readStoredCrowdsec = async () => (await import("../crowdsec/store.js")).readStoredCrowdsec();

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const freeName = async (fs, full) => {
	for (let number = 1; ; number += 1) {
		const name = number === 1 ? `${full}.before-pages` : `${full}.before-pages-${number}`;
		if (!(await fs.lstat(name).catch(() => null))) return name;
	}
};

/**
 * @param   {"ban"|"captcha"} type
 * @param   {string} file  container path
 * @param   {Object} [deps]
 * @param   {Object} [deps.fs]
 * @param   {Object} deps.log
 * @param   {Function} [deps.at]       (container path) => real path, rooted by default
 * @param   {Function} [deps.stockOf]  (type) => container path of the stock page
 * @returns {Promise<{ choice: string, html: string }>}
 */
export const importLegacyPage = async (
	type,
	file,
	{ fs = nodeFs, log, at = rooted, stockOf = (name) => LEGACY_PAGES[name].stock } = {},
) => {
	const full = at(file);
	const info = await fs.lstat(full).catch(() => null);
	// missing, a folder or a link (never followed)
	if (!info?.isFile()) return NPMPRO;
	const html = await fs.readFile(full, "utf8");
	const stock = await fs.readFile(at(stockOf(type)), "utf8").catch(() => null);
	if (stock !== null && sha256(stock) === sha256(html)) {
		await fs.rm(full, { force: true });
		log.info(`Landing pages: ${file} was the stock ${type} page, the NPMpro page takes its place`);
		return NPMPRO;
	}
	const kept = await freeName(fs, full);
	await fs.rename(full, kept);
	const shown = kept.slice(full.length - file.length);
	const problems = pageHtmlProblems(html);
	if (problems.length > 0) {
		log.warn(
			`Landing pages: ${file} could not become the custom ${type} page (${problems.join(" ")}); it is kept as ${shown} and the NPMpro page is shown`,
		);
		return NPMPRO;
	}
	log.info(
		`Landing pages: ${file} is now the custom ${type} page (Settings, Landing pages), the file is kept as ${shown}`,
	);
	return { choice: "custom", html };
};

/**
 * The one import at the first start: the old paths from the item 30 row or the old crowdsec.conf
 *
 * @param   {Object} deps
 * @returns {Promise<{ pages: Object, imported_on: string }>}  the meta of a new landing_pages row
 */
export const importLegacyPages = async ({
	fs = nodeFs,
	log,
	readCrowdsec = readStoredCrowdsec,
	now = () => new Date(),
}) => {
	const stored = await readCrowdsec();
	const hasRow = Object.keys(stored ?? {}).length > 0;
	const lines = hasRow ? null : parseConfLines(await fs.readFile(rooted(CROWDSEC_CONF_PATH), "utf8").catch(() => ""));
	const paths = legacyPagePaths({ stored: hasRow ? stored : null, lines });
	const pages = {};
	for (const type of Object.keys(LEGACY_PAGES)) pages[type] = await importLegacyPage(type, paths[type], { fs, log });
	return { pages, imported_on: now().toISOString() };
};
