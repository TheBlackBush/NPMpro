import { mkdir, writeFile } from "node:fs/promises";
import { applyDefaultSite, assertDefaultSiteMeta } from "../lib/default-site.js";
import errs from "../lib/error.js";
import { globalPageFiles, makeReadable } from "../lib/landing-pages/files.js";
import { pageHtmlProblems } from "../lib/landing-pages/html.js";
import { importLegacyPages } from "../lib/landing-pages/legacy.js";
import {
	applyPagesUpdate,
	changedPageTypes,
	effectivePages,
	readStoredLandingPages,
	saveStoredLandingPages,
} from "../lib/landing-pages/store.js";
import { GLOBAL_DIR } from "../lib/landing-pages/types.js";
import { rooted } from "../lib/paths.js";
import { withFiles } from "../lib/runtime-apply.js";
import { global as logger } from "../logger.js";
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
			const existingSite = await readDefaultSite();
			await writeGlobalPages(after, async () => {
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
					} catch (err) {
						throw new errs.ValidationError(err.message || "nginx config test failed", undefined, {
							cause: err,
						});
					}
				}
				await saveStoredLandingPages(nextStored);
				try {
					await internalNginx.reload();
				} catch (err) {
					await saveStoredLandingPages(stored).catch((restoreErr) =>
						logger.error(`Landing pages: the settings could not be put back: ${restoreErr.message}`),
					);
					throw new errs.ValidationError(err.message || "nginx reload failed", undefined, { cause: err });
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
			stored = await importLegacyPages({ log });
			await saveStoredLandingPages(stored);
		}
		await runtimeExclusive(() => writeGlobalPages(effectivePages(stored)));
	} catch (err) {
		log.error(`Landing pages: could not write the global pages at startup: ${err.message}`);
	}
};

export { startLandingPages, writeGlobalPages };
export default internalLandingPages;
