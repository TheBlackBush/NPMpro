// The server-side include (SSI) commands a landing page may hold (built-in or custom), and how they are filled. nginx
// fills them where it serves a page (ssi on); the CrowdSec bouncer's ban and captcha pages are filled with the same
// rules by rootfs/usr/local/share/lua/5.1/npmpro_pages.lua, and the preview by fillPlaceholders. Allowed: echo of the
// five variables below (HTML-escaped, nginx's default encoding) and config timefmt. Anything else (include, set, if,
// other variables) would give the author of a custom page server-side reach, so a save refuses it.

export const ECHO_VARS = ["remote_addr", "date_gmt", "date_local", "status", "host"];
// nginx's default timefmt
export const DEFAULT_TIMEFMT = "%A, %d-%b-%Y %H:%M:%S %Z";

const COMMAND = /<!--#\s*([a-z]+)((?:\s+[a-z]+="[^"]*")*)\s*-->/gu;
const ATTRIBUTE = /([a-z]+)="([^"]*)"/gu;
const OPENER = /<!--#/gu;
const SPECIFIER = /%(.)/gsu;
const TIME_LETTERS = new Set(["Y", "m", "d", "H", "M", "S", "Z", "A", "b", "%"]);
const ECHO_ATTRIBUTES = new Set(["var", "default", "encoding"]);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const SPECIAL = /[&<>"']/gu;

const attributesOf = (text) =>
	Object.fromEntries([...text.matchAll(ATTRIBUTE)].map(([, name, value]) => [name, value]));

/**
 * @param   {string} text
 * @returns {string}  text with & < > " ' as entities
 */
export const escapeHtml = (text) => String(text).replace(SPECIAL, (char) => ESCAPES[char]);

/**
 * What is wrong with the SSI commands of a page, as English sentences for the API error
 *
 * @param   {string} html
 * @returns {string[]}  empty when every command is allowed
 */
export const ssiProblems = (html) => {
	const problems = [];
	const commands = [...html.matchAll(COMMAND)];
	if (commands.length !== [...html.matchAll(OPENER)].length) {
		problems.push('An SSI command is not written as <!--# command name="value" -->.');
	}
	for (const [, command, rawAttributes] of commands) {
		const attributes = attributesOf(rawAttributes);
		const names = Object.keys(attributes);
		if (command === "echo") {
			if (!ECHO_VARS.includes(attributes.var)) {
				problems.push(`echo var="${attributes.var ?? ""}" is not allowed, only ${ECHO_VARS.join(", ")}.`);
			}
			if (names.some((name) => !ECHO_ATTRIBUTES.has(name)))
				problems.push("echo takes only var, default and encoding.");
			if (attributes.encoding !== undefined && attributes.encoding !== "entity") {
				problems.push('echo encoding can only be "entity".');
			}
		} else if (command === "config") {
			if (names.length !== 1 || names[0] !== "timefmt") problems.push("config takes only timefmt.");
			else if ([...attributes.timefmt.matchAll(SPECIFIER)].some(([, letter]) => !TIME_LETTERS.has(letter))) {
				problems.push("timefmt can use %Y %m %d %H %M %S %Z %A %b and %%.");
			}
		} else {
			problems.push(`The SSI command ${command} is not allowed.`);
		}
	}
	return [...new Set(problems)];
};

const pad = (number) => String(number).padStart(2, "0");

// strftime for the specifiers ssiProblems allows, in UTC (the preview shows date_local in UTC too)
const formatTime = (format, date) =>
	format.replace(SPECIFIER, (whole, letter) => {
		switch (letter) {
			case "Y":
				return String(date.getUTCFullYear());
			case "m":
				return pad(date.getUTCMonth() + 1);
			case "d":
				return pad(date.getUTCDate());
			case "H":
				return pad(date.getUTCHours());
			case "M":
				return pad(date.getUTCMinutes());
			case "S":
				return pad(date.getUTCSeconds());
			case "Z":
				return "UTC";
			case "A":
				return DAYS[date.getUTCDay()];
			case "b":
				return MONTHS[date.getUTCMonth()];
			case "%":
				return "%";
			default:
				return whole;
		}
	});

/**
 * The page with its SSI commands filled as nginx would (for the preview): echo values HTML-escaped, default for an
 * empty value, config timefmt for the echoes after it; commands that are not allowed are dropped
 *
 * @param   {string} html
 * @param   {{ remote_addr?: string, status?: number|string, host?: string, now?: Date }} values
 * @returns {string}
 */
export const fillPlaceholders = (html, values) => {
	let timefmt = DEFAULT_TIMEFMT;
	const now = values.now ?? new Date();
	return html.replace(COMMAND, (_, command, rawAttributes) => {
		const attributes = attributesOf(rawAttributes);
		if (command === "config") {
			if (attributes.timefmt !== undefined) timefmt = attributes.timefmt;
			return "";
		}
		if (command !== "echo" || !ECHO_VARS.includes(attributes.var)) return "";
		const isTime = attributes.var === "date_gmt" || attributes.var === "date_local";
		const value = isTime ? formatTime(timefmt, now) : String(values[attributes.var] ?? "");
		return escapeHtml(value === "" ? (attributes.default ?? "") : value);
	});
};
