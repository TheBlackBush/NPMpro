import { nginx as nginxLogger } from "../logger.js";
import errs from "./error.js";

// default.conf renders these into `return 302 <redirect>;` and `return <status>;`: an absolute http(s) URL without
// whitespace or nginx syntax characters (nginx variables such as $request_uri stay allowed), and an HTTP status code
const REDIRECT_PATTERN = /^https?:\/\/[^\s;{}"'\\#]+$/u;
const STATUS_PATTERN = /^[1-5]\d\d$/u;
const assertDefaultSiteMeta = (meta) => {
	if (meta.redirect !== undefined && meta.redirect !== "" && !REDIRECT_PATTERN.test(String(meta.redirect))) {
		throw new errs.ValidationError(
			"The redirect must be an absolute http or https URL without spaces, quotes or ; { } #",
		);
	}
	if (
		meta.status !== undefined &&
		meta.status !== "" &&
		meta.status !== null &&
		!STATUS_PATTERN.test(String(meta.status))
	) {
		throw new errs.ValidationError("The status must be an HTTP status code from 100 to 599");
	}
};

/**
 * Puts the saved row's default site back after a failed save: its HTML page (when the save had replaced it) and its
 * config. When nginx refuses that config too, the default site config is removed (nginx then serves its built-in
 * fallback). Every step is logged on failure and none of them throws.
 */
const restoreDefaultSite = async (nginx, previous, { wroteHtml, writeHtml, logger }) => {
	if (wroteHtml && previous.value === "html") {
		try {
			await writeHtml(previous.meta?.html ?? "");
		} catch (err) {
			logger.error(`Could not restore the HTML page of the default site: ${err.message}`);
		}
	}
	try {
		await nginx.generateConfig("default", previous);
		await nginx.test();
		logger.warn("The default site change was refused, the saved default site config is restored");
	} catch (err) {
		logger.error(
			`The saved default site config fails too, so the default site config is removed and nginx serves its built-in default: ${err.message}`,
		);
		try {
			await nginx.deleteConfig("default");
			await nginx.test();
		} catch (deleteErr) {
			logger.error(`nginx still fails after removing the default site config: ${deleteErr.message}`);
		}
	}
	try {
		await nginx.reload();
	} catch (err) {
		logger.error(`Could not reload nginx after restoring the default site: ${err.message}`);
	}
};

/**
 * Changes the default site in this order: write and test the next row's config, write its HTML page (html mode),
 * reload nginx, save the row. When a step fails, the saved row's page and config are put back (restoreDefaultSite)
 * and a ValidationError is thrown with the failure as its cause, so the saved row and the running config stay the
 * same. Run it in the runtime settings queue, so the row is saved before the next queued change starts.
 *
 * @param {{ generateConfig: Function, deleteConfig: Function, test: Function, reload: Function }} nginx  internal/nginx.js
 * @param {Object}   next                  the setting row to apply
 * @param {Object}   previous              the saved setting row
 * @param {Object}   [steps]
 * @param {Function} [steps.writeHtml]     writes the HTML page of the html mode
 * @param {Function} [steps.save]          saves the next row
 * @param {Object}   [steps.logger]
 */
const applyDefaultSite = async (
	nginx,
	next,
	previous,
	{ writeHtml = async () => {}, save = async () => {}, logger = nginxLogger } = {},
) => {
	let wroteHtml = false;
	try {
		await nginx.generateConfig("default", next);
		await nginx.test();
		if (next.value === "html") {
			wroteHtml = true;
			await writeHtml(next.meta.html);
		}
		await nginx.reload();
		await save();
	} catch (err) {
		logger.error(`The default site change failed: ${err.message}`);
		await restoreDefaultSite(nginx, previous, { wroteHtml, writeHtml, logger });
		throw new errs.ValidationError("Could not reconfigure Nginx. Please check logs.", undefined, { cause: err });
	}
};

export { applyDefaultSite, assertDefaultSiteMeta };
