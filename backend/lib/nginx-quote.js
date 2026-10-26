import { domainToASCII } from "node:url";

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
 * Removes one pair of matching outer quotes. Paths with braces used to pass `nginx -t` only when quoted by hand, so
 * stored paths such as `"^/api/\d{3}$"` must keep their meaning now that every path is quoted.
 *
 * @param   {String} value
 * @returns {String}
 */
const unquote = (value) => {
	const text = String(value ?? "");
	const first = text[0];
	return text.length >= 2 && (first === '"' || first === "'") && text.at(-1) === first ? text.slice(1, -1) : text;
};

/**
 * The server_name arguments of a host: each name in its ASCII (punycode) form, quoted, so a regular expression name
 * with { } ; or backslashes stays one argument with its original value
 *
 * @param   {string[]} domainNames
 * @returns {string[]}
 */
const serverNames = (domainNames) =>
	domainNames.map((name) => {
		// a name the user quoted by hand (once the only way to write a regex with { }) keeps its meaning
		const bare = unquote(name);
		return quoteNginxString(domainToASCII(bare) || bare);
	});

/**
 * The location type and path of a custom location as rendered after `location `: the path is always quoted, so
 * braces, semicolons or quotes in it cannot leave the location block. A named location (`@`) quotes the whole name.
 * A path the user quoted already is unquoted first.
 *
 * @param   {Object} location
 * @param   {String} [location.location_type]  "", "@", "= ", "~ ", "~* " or "^~ "
 * @param   {String} location.path
 * @returns {{location_type: String, path: String}}
 */
const quoteLocation = ({ location_type: type, path }) =>
	type === "@"
		? { location_type: "", path: quoteNginxString(`@${unquote(path)}`) }
		: { location_type: type ?? "", path: quoteNginxString(unquote(path)) };

export { quoteLocation, quoteNginxString, serverNames, unquote };
