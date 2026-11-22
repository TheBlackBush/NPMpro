// What a refused certbot run tells the user: the CA's sentence and certbot's own one-line reason, without certbot's
// log path, its Python warning blocks and its "ask for help" footer.

const MAX_CLEAN = 500;
const GENERIC = "certbot failed without a message";
const MARKERS = ["Error returned by the ACME server:", "An unexpected error occurred:"];
const NOISE_LINES = ["Saving debug log to", "Ask for help or search for solutions", "Please see the logfile"];
const LINE_BREAK = /\r?\n/u;
const INDENTED = /^\s/u;
const SPACES = /\s+/gu;
const LEAD_IN = /^Unable to register an account with ACME server\.\s+(?=\S)/u;
// a Python warning: "<file>.py:<line>: <Category>Warning: <text>" (InsecureRequestWarning, a DeprecationWarning after a
// dependency update, ...), followed by indented lines
const PYTHON_WARNING = /^\S+\.py:\d+: \w*Warning:/u;
// certbot's first line of a renewal ("Renewing an existing certificate for a.example.com and 2 more"), no reason
const RENEWING_LEAD = /^Renewing an existing certificate for\b/u;
const WARNING_MARKS = ["InsecureRequestWarning", "warnings.warn"];

const isWarning = (line) => PYTHON_WARNING.test(line) || WARNING_MARKS.some((mark) => line.includes(mark));

const isNoise = (line) =>
	NOISE_LINES.some((start) => line.startsWith(start)) ||
	line.includes("See the logfile") ||
	line.includes("See the logfiles") ||
	isWarning(line);

const dropMarkers = (line) => {
	let text = line;
	for (const marker of MARKERS) {
		const at = text.indexOf(marker);
		if (at !== -1) text = text.slice(at + marker.length);
	}
	return text.trim();
};

/**
 * The readable part of certbot's output: the text after "Error returned by the ACME server:" or "An unexpected error
 * occurred:" and certbot's own reasons, without the debug-log line, the warning blocks (a warning line and its
 * indented lines), the "Ask for help" and "See the logfile" text and empty lines, joined by one space and cut at 500
 * characters. Without anything left: a short generic text. With keepLines the lines stay on their own lines and max
 * is the cut (a certificate request needs the domain and hint lines of a failed authentication).
 *
 * @param   {*}       output  certbot's combined stdout and stderr (or an error message)
 * @param   {Object}  [options]
 * @param   {boolean} [options.keepLines]
 * @param   {number}  [options.max]
 * @returns {string}
 */
const cleanCertbotMessage = (output, { keepLines = false, max = MAX_CLEAN } = {}) => {
	const kept = [];
	let inWarning = false;
	for (const raw of String(output ?? "").split(LINE_BREAK)) {
		if (isNoise(raw)) {
			inWarning = isWarning(raw);
			continue;
		}
		if (RENEWING_LEAD.test(raw)) continue;
		if (inWarning && INDENTED.test(raw)) continue;
		inWarning = false;
		const line = dropMarkers(raw);
		if (line) kept.push(line);
	}
	const joined = keepLines ? kept.map((line) => line.replace(SPACES, " ")).join("\n") : kept.join(" ");
	const text = (keepLines ? joined : joined.replace(SPACES, " ")).trim().replace(LEAD_IN, "");
	return (text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text) || GENERIC;
};

const REQUEST_MAX = 4000;

export { cleanCertbotMessage, GENERIC, MAX_CLEAN, REQUEST_MAX };
