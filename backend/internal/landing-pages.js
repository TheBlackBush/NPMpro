import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { applyDefaultSite, assertDefaultSiteMeta } from "../lib/default-site.js";
import errs from "../lib/error.js";
import { globalPageFiles, makeReadable, writePlacePages } from "../lib/landing-pages/files.js";
import { pageHtmlProblems } from "../lib/landing-pages/html.js";
import { importLegacyPage, importLegacyPages, LEGACY_PAGES } from "../lib/landing-pages/legacy.js";
import { previewHtml } from "../lib/landing-pages/preview.js";
import {
	applyPagesUpdate,
	changedPageTypes,
	effectivePages,
	readStoredLandingPages,
	saveStoredLandingPages,
} from "../lib/landing-pages/store.js";
import { BUILTIN_DIR, GLOBAL_DIR, PAGE_FILES, PAGE_TYPES, PAGES_DIR, PLACES } from "../lib/landing-pages/types.js";
import { rooted } from "../lib/paths.js";
import { withFiles } from "../lib/runtime-apply.js";
import { global as logger } from "../logger.js";
import accessListModel from "../models/access_list.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import internalNginx from "./nginx.js";
import { runtimeExclusive } from "./runtime-queue.js";

// Settings, Landing pages: the seven global pages (the landing_pages row) and the Default page (the default-site row,
// which keeps its own route). The global files under /data/public/pages/global/ are written from the row at every
// start and save; host configs and crowdsec.conf point at them, so a change needs only a reload.

const DEFAULT_SITE_ID = "default-site";
const readDefaultSite = () => settingModel.query().where("id", DEFAULT_SITE_ID).first();

const viewOf = async () => {
	const site = await readDefaultSite();
	return {
		default_site: { value: site?.value ?? "congratulations", meta: site?.meta ?? {} },
		pages: effectivePages(await readStoredLandingPages()),
	};
};

/**
 * Writes the seven global files, runs fn and puts the previous files back when fn throws. For code in the runtime
 * queue (a save, the start, a restore).
 *
 * @param   {Object}   pages  effectivePages
 * @param   {Function} [fn]
 * @returns {Promise<*>}
 */
const writeGlobalPages = async (pages, fn = async () => {}) => {
	await mkdir(rooted(GLOBAL_DIR), { recursive: true, mode: 0o755 });
	const files = await globalPageFiles(pages);
	return await withFiles(files, async (written) => {
		await makeReadable(written);
		return await fn(written);
	});
};

const assertPages = (pages) => {
	for (const [type, page] of Object.entries(pages ?? {})) {
		if (typeof page?.html !== "string" || page.html === "") continue;
		const problems = pageHtmlProblems(page.html);
		if (problems.length > 0) throw new errs.ValidationError(`pages.${type}.html: ${problems.join(" ")}`);
	}
};

// A client cannot clear a page by sending "" for its html while keeping the custom choice (the rule of
// keepSavedPages for the hosts): the saved page stays. Another choice with "" clears it.
const keepSavedHtml = (stored, changes) =>
	Object.fromEntries(
		Object.entries(changes).map(([type, change]) => {
			const choice = change.choice ?? stored?.pages?.[type]?.choice ?? "npmpro";
			if (change.html !== "" || choice !== "custom") return [type, change];
			const { html: _kept, ...rest } = change;
			return [type, rest];
		}),
	);

const assertDefaultSite = (site) => {
	if (!site) return;
	assertDefaultSiteMeta(site.meta ?? {});
	if (["html", "redirect"].includes(site.value) && !String(site.meta?.[site.value] ?? "").trim()) {
		throw new errs.ValidationError(`default_site.meta.${site.value} is required for ${site.value}`);
	}
};

const internalLandingPages = {
	/**
	 * @param   {Access} access
	 * @returns {Promise<Object>}
	 */
	get: async (access) => {
		access.canAdmin();
		return await viewOf();
	},

	/**
	 * In the runtime queue: the global files of the new pages, then the default site (its own apply: config, nginx -t,
	 * its HTML, reload, its row) or nginx -t, then the row and a reload (the bouncer reads its pages when nginx loads).
	 * A failure puts the files back and saves nothing.
	 *
	 * @param   {Access} access
	 * @param   {Object} body  validated against the PUT schema
	 * @returns {Promise<Object>}  the same as get()
	 */
	update: async (access, body) => {
		access.canAdmin();
		const changes = body?.pages ?? {};
		const site = body?.default_site;
		assertPages(changes);
		assertDefaultSite(site);
		const changed = await runtimeExclusive(async () => {
			const stored = (await readStoredLandingPages()) ?? {};
			const before = effectivePages(stored);
			const nextStored = applyPagesUpdate(stored, keepSavedHtml(stored, changes));
			const after = effectivePages(nextStored);
			for (const [type, change] of Object.entries(changes)) {
				if (change.choice === "custom" && after[type]?.choice !== "custom") {
					throw new errs.ValidationError(`pages.${type}.html is required for a custom page`);
				}
			}
			const existingSite = (await readDefaultSite()) ?? {
				id: DEFAULT_SITE_ID,
				value: "congratulations",
				meta: {},
			};
			await writeGlobalPages(after, async () => {
				// the row first, then one test and one reload (the default site's own apply reloads); a failure puts the
				// row back, the files are put back by writeGlobalPages and the default site by applyDefaultSite
				await saveStoredLandingPages(nextStored);
				try {
					if (site) {
						const next = { ...existingSite, value: site.value, meta: site.meta ?? existingSite.meta };
						await applyDefaultSite(internalNginx, next, existingSite, {
							writeHtml: (html) =>
								writeFile(rooted("/data/public/html/index.html"), html, { encoding: "utf8" }),
							save: () =>
								settingModel
									.query()
									.where({ id: DEFAULT_SITE_ID })
									.patch({ value: next.value, meta: next.meta }),
						});
					} else {
						try {
							await internalNginx.test();
							await internalNginx.reload();
						} catch (err) {
							throw new errs.ValidationError(err.message || "nginx config test failed", undefined, {
								cause: err,
							});
						}
					}
				} catch (err) {
					await saveStoredLandingPages(stored).catch((restoreErr) =>
						logger.error(`Landing pages: the settings could not be put back: ${restoreErr.message}`),
					);
					throw err;
				}
			});
			return [...changedPageTypes(before, after), ...(site ? ["default_site"] : [])];
		});
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: { id: "landing_pages", changed },
		});
		return await viewOf();
	},

	/**
	 * The page a place shows, as saved, with sample values; ItemNotFoundError when it shows no page of its own
	 * (upstream, plain, a redirect or 444 default site, an unknown type or id)
	 *
	 * @param   {Access} access
	 * @param   {{ source: string, type?: string, id?: number }} what  source: global, npmpro, proxy-host, dead-host,
	 *          access-list
	 * @returns {Promise<string>}
	 */
	preview: async (access, { source, type, id }) => {
		access.canAdmin();
		const notFound = () => new errs.ItemNotFoundError(type ?? source);
		const builtin = (name) => readFile(rooted(`${BUILTIN_DIR}/${PAGE_FILES[name]}`), "utf8");
		const global = async (pageType) => {
			if (pageType === "default_site") {
				const site = await readDefaultSite();
				switch (site?.value ?? "congratulations") {
					case "congratulations":
						return await builtin("default_site");
					case "404":
						return await global("not_found");
					case "html":
						return String(site.meta?.html ?? "");
					default:
						throw notFound();
				}
			}
			const page = effectivePages(await readStoredLandingPages())[pageType];
			return page.choice === "custom" ? page.html : await builtin(pageType);
		};
		const ofPlace = async (kind, model, pageType) => {
			const field = PLACES[kind].fields.find((item) => item.type === pageType);
			if (!(field && Number.isSafeInteger(id) && id >= 1)) throw notFound();
			const row = await model.query().findById(id);
			if (!row) throw notFound();
			switch (row[field.column]) {
				case "global":
					return await global(pageType);
				case "npmpro":
					return await builtin(pageType);
				case "custom":
					// no html saved: nginx serves the global page (wiring.js), so the preview does too
					return row[`${field.column}_html`] ? String(row[`${field.column}_html`]) : await global(pageType);
				default:
					throw notFound();
			}
		};
		const known = [...PAGE_TYPES, "default_site"].includes(type);
		let shown = type;
		let html;
		if (source === "global" && known) html = await global(type);
		else if (source === "npmpro" && known) html = await builtin(type);
		else if (source === "proxy-host") html = await ofPlace("proxy_host", proxyHostModel, type);
		else if (source === "dead-host") {
			shown = "not_found";
			html = await ofPlace("dead_host", deadHostModel, shown);
		} else if (source === "access-list") {
			shown = "denied";
			html = await ofPlace("access_list", accessListModel, shown);
		} else throw notFound();
		return previewHtml(html, shown);
	},
};

/**
 * At every start, before the CrowdSec start (crowdsec.conf points at the global files): the one import of the old
 * CrowdSec pages when there is no row yet, then the global files. Never throws.
 *
 * @param   {Object} [deps]
 * @returns {Promise<void>}
 */
const startLandingPages = async ({ log = logger } = {}) => {
	try {
		let stored = await readStoredLandingPages();
		if (stored === null) {
			stored = await importLegacyPages({ log, save: saveStoredLandingPages });
		}
		await runtimeExclusive(() => writeGlobalPages(effectivePages(stored)));
	} catch (err) {
		log.error(
			`Landing pages: could not write the global pages at startup, the CrowdSec ban and captcha pages are unavailable until the files are written (the bouncer turns captcha off): ${err.message}`,
		);
	}
};

// the tables of the places that hold custom pages, by the backup type that restores them
const PLACE_TYPES = {
	proxy_hosts: ["proxy_host", proxyHostModel],
	dead_hosts: ["dead_host", deadHostModel],
	access_lists: ["access_list", accessListModel],
};

// the custom pages of every restored host and access list (also the disabled ones, whose configs a restore does not
// write) and no folder of a row that is gone. The columns come as the database holds them (null without a page).
const writeRestoredPlacePages = async (kind, model) => {
	const columns = PLACES[kind].fields.flatMap(({ column }) => [column, `${column}_html`]);
	const rows = await model.query().select("id", ...columns);
	const ids = new Set();
	for (const row of rows) {
		const id = Number(row.id);
		if (!Number.isSafeInteger(id) || id < 1) continue;
		ids.add(id);
		const full = { ...row, id };
		for (const { column } of PLACES[kind].fields) full[`${column}_html`] ??= "";
		await writePlacePages(kind, full);
	}
	const folder = new RegExp(`^${PLACES[kind].dir}-([1-9][0-9]*)$`, "u");
	for (const name of await readdir(rooted(PAGES_DIR)).catch(() => [])) {
		const match = folder.exec(name);
		if (match && !ids.has(Number(match[1])))
			await rm(rooted(`${PAGES_DIR}/${name}`), { recursive: true, force: true });
	}
};

/**
 * After a restore or merge: the page files of the restored hosts and access lists, and for the landing pages row or an
 * older backup's CrowdSec pages the global files. An older backup's hand-edited ban or captcha page becomes the custom
 * page (as the start does). A missing landing_pages row reads as the defaults. Runs inside the restore's queue job,
 * which tests and reloads nginx afterwards.
 *
 * @param   {string[]} types  the restored types
 * @returns {Promise<void>}
 */
const reloadLandingPagesAfterRestore = async (types = []) => {
	for (const [typeId, [kind, model]] of Object.entries(PLACE_TYPES)) {
		if (types.includes(typeId)) await writeRestoredPlacePages(kind, model);
	}
	if (!(types.includes("settings_landing_pages") || types.includes("crowdsec_files"))) return;
	let stored = (await readStoredLandingPages()) ?? {};
	if (types.includes("crowdsec_files")) {
		let taken = false;
		for (const [type, legacy] of Object.entries(LEGACY_PAGES)) {
			const page = await importLegacyPage(type, legacy.file, { log: logger });
			if (page.choice === "custom") {
				stored = applyPagesUpdate(stored, { [type]: page });
				taken = true;
			}
		}
		if (taken) await saveStoredLandingPages(stored);
	}
	await writeGlobalPages(effectivePages(stored));
};

export { reloadLandingPagesAfterRestore, startLandingPages, writeGlobalPages };
export default internalLandingPages;
