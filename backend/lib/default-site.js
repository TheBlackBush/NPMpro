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
 * Writes and loads the default site config of the next setting row before the row is saved. When nginx refuses it,
 * the previous row's config is put back (or, if that fails too, the default site config is removed, as nginx then
 * serves its built-in fallback) and a ValidationError is thrown, so the saved row and the running config stay the same.
 * Run it in the runtime settings queue.
 *
 * @param {{ generateConfig: Function, deleteConfig: Function, test: Function, reload: Function }} nginx  internal/nginx.js
 * @param {Object} next      the setting row to apply
 * @param {Object} previous  the saved setting row
 */
const applyDefaultSite = async (nginx, next, previous) => {
	try {
		await nginx.generateConfig("default", next);
		await nginx.test();
		await nginx.reload();
	} catch (err) {
		try {
			await nginx.generateConfig("default", previous);
			await nginx.test();
		} catch {
			await nginx.deleteConfig("default");
			await nginx.test();
		}
		await nginx.reload();
		throw new errs.ValidationError("Could not reconfigure Nginx. Please check logs.", undefined, { cause: err });
	}
};

export { applyDefaultSite, assertDefaultSiteMeta };
