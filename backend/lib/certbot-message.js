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
const WARNING_MARKS = ["InsecureRequestWarning", "warnings.warn"];

const isNoise = (line) =>
	NOISE_LINES.some((start) => line.startsWith(start)) ||
	line.includes("See the logfile") ||
	line.includes("See the logfiles") ||
	WARNING_MARKS.some((mark) => line.includes(mark));

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
 * characters. Without anything left: a short generic text.
 *
 * @param   {*}       output  certbot's combined stdout and stderr (or an error message)
 * @returns {string}
 */
const cleanCertbotMessage = (output) => {
	const kept = [];
	let inWarning = false;
	for (const raw of String(output ?? "").split(LINE_BREAK)) {
		if (isNoise(raw)) {
			inWarning = WARNING_MARKS.some((mark) => raw.includes(mark));
			continue;
		}
		if (inWarning && INDENTED.test(raw)) continue;
		inWarning = false;
		const line = dropMarkers(raw);
		if (line) kept.push(line);
	}
	const text = kept.join(" ").replace(SPACES, " ").trim().replace(LEAD_IN, "");
	return (text.length > MAX_CLEAN ? `${text.slice(0, MAX_CLEAN - 3).trimEnd()}...` : text) || GENERIC;
};

export { cleanCertbotMessage, GENERIC, MAX_CLEAN };
