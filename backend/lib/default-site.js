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

export { assertDefaultSiteMeta };
