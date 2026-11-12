import { readFile } from "node:fs/promises";
import { rooted } from "../paths.js";

/** Location of the bouncer config in the container (written from Settings, CrowdSec). */
export const CROWDSEC_CONF_PATH = rooted("/data/crowdsec/crowdsec.conf");

/** The bouncer config text, "" when the file does not exist. */
export const readCrowdsecConf = async () => {
	try {
		return await readFile(CROWDSEC_CONF_PATH, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return "";
		throw err;
	}
};

const INLINE_COMMENT = /\s+#.*$/u;
const LINE_BREAK = /\r?\n/u;
const EXPORT_PREFIX = /^export\s+/u;
const BOM = /^\uFEFF/u;

const parseValue = (raw) => {
	if (raw[0] === '"' || raw[0] === "'") {
		const end = raw.indexOf(raw[0], 1);
		return end > 0 ? raw.slice(1, end) : raw;
	}
	return raw.replace(INLINE_COMMENT, "").trim();
};

/**
 * The KEY=value lines of a bouncer config: keys upper-cased, the last one wins, a leading BOM, CRLF line ends,
 * `export ` prefixes, quotes and inline comments (a # after a space, outside quotes) removed; comment and broken lines
 * skipped.
 *
 * @param   {string} text
 * @returns {Record<string, string>}
 */
export const parseConfLines = (text) => {
	const values = {};
	for (const raw of String(text ?? "")
		.replace(BOM, "")
		.split(LINE_BREAK)) {
		const line = raw.trim().replace(EXPORT_PREFIX, "");
		if (line === "" || line.startsWith("#")) {
			continue;
		}
		const eq = line.indexOf("=");
		if (eq < 1) {
			continue;
		}
		values[line.slice(0, eq).trim().toUpperCase()] = parseValue(line.slice(eq + 1).trim());
	}
	return values;
};

/**
 * Parses the nginx lua bouncer config (KEY=value lines, # comments). SSL_VERIFY defaults to true like the bouncer; only
 * an explicit "false" turns certificate checks off.
 *
 * @param {string} text
 * @returns {{ enabled: boolean, apiUrl: string, apiKey: string, useTls: boolean, certFile: string, keyFile: string, sslVerify: boolean }}
 */
export const parseCrowdsecConf = (text) => {
	const values = parseConfLines(text);
	const isTrue = (key) => (values[key] ?? "").toLowerCase() === "true";
	return {
		enabled: isTrue("ENABLED"),
		apiUrl: values.API_URL ?? "",
		apiKey: values.API_KEY ?? "",
		useTls: isTrue("USE_TLS_AUTH"),
		certFile: values.TLS_CLIENT_CERT ?? "",
		keyFile: values.TLS_CLIENT_KEY ?? "",
		sslVerify: (values.SSL_VERIFY ?? "").toLowerCase() !== "false",
	};
};

/**
 * True when the bouncer is enabled and has credentials for the LAPI (API key, or TLS auth with cert and key).
 * @param {ReturnType<typeof parseCrowdsecConf>} conf
 */
export const isCrowdsecConfigured = (conf) =>
	Boolean(conf.enabled && conf.apiUrl && (conf.useTls ? conf.certFile && conf.keyFile : conf.apiKey));
