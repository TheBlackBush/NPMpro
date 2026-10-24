/** Default location of the bouncer config inside the container (copied from crowdsec.conf.example by start.sh). */
export const CROWDSEC_CONF_PATH = "/data/crowdsec/crowdsec.conf";

const INLINE_COMMENT = /\s+#.*$/u;
const LINE_BREAK = /\r?\n/u;
const EXPORT_PREFIX = /^export\s+/u;

const parseValue = (raw) => {
	if (raw[0] === '"' || raw[0] === "'") {
		const end = raw.indexOf(raw[0], 1);
		return end > 0 ? raw.slice(1, end) : raw;
	}
	return raw.replace(INLINE_COMMENT, "").trim();
};

/**
 * Parses the nginx lua bouncer config (KEY=value lines, # comments).
 * @param {string} text
 * @returns {{ enabled: boolean, apiUrl: string, apiKey: string, useTls: boolean, certFile: string, keyFile: string }}
 */
export const parseCrowdsecConf = (text) => {
	const values = {};
	for (const raw of String(text ?? "").split(LINE_BREAK)) {
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
	const isTrue = (key) => (values[key] ?? "").toLowerCase() === "true";
	return {
		enabled: isTrue("ENABLED"),
		apiUrl: values.API_URL ?? "",
		apiKey: values.API_KEY ?? "",
		useTls: isTrue("USE_TLS_AUTH"),
		certFile: values.TLS_CLIENT_CERT ?? "",
		keyFile: values.TLS_CLIENT_KEY ?? "",
	};
};

/**
 * True when the bouncer is enabled and has credentials to reach the LAPI (API key, or TLS auth with cert and key).
 * @param {ReturnType<typeof parseCrowdsecConf>} conf
 */
export const isCrowdsecConfigured = (conf) =>
	Boolean(conf.enabled && conf.apiUrl && (conf.useTls ? conf.certFile && conf.keyFile : conf.apiKey));
