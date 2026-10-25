/**
 * Wraps a value in double quotes for an nginx config argument. nginx unescapes \\ and \" (and \t, \r, \n) in every
 * argument, so escaping backslashes first keeps a regex such as `\d{3}` unchanged after nginx reads it, and a value
 * cannot end the string early.
 *
 * @param   {String} value
 * @returns {String}
 */
const quoteNginxString = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * The location type and path of a custom location as rendered after `location `: the path is always quoted, so
 * braces, semicolons or quotes in it cannot leave the location block. A named location (`@`) quotes the whole name.
 *
 * @param   {Object} location
 * @param   {String} [location.location_type]  "", "@", "= ", "~ ", "~* " or "^~ "
 * @param   {String} location.path
 * @returns {{location_type: String, path: String}}
 */
const quoteLocation = ({ location_type: type, path }) =>
	type === "@"
		? { location_type: "", path: quoteNginxString(`@${path}`) }
		: { location_type: type ?? "", path: quoteNginxString(path) };

export { quoteLocation, quoteNginxString };
