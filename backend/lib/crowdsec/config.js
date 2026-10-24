/** Default location of the bouncer config inside the container (copied from crowdsec.conf.example by start.sh). */
export const CROWDSEC_CONF_PATH = "/data/crowdsec/crowdsec.conf";

const unquote = (value) => {
	if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
		return value.slice(1, -1);
	}
	return value;
};

/**
 * Parses the nginx lua bouncer config (KEY=value lines, # comments).
 * @param {string} text
 * @returns {{ enabled: boolean, apiUrl: string, apiKey: string, useTls: boolean, certFile: string, keyFile: string }}
 */
export const parseCrowdsecConf = (text) => {
	const values = {};
	for (const raw of String(text ?? "").split(/\r?\n/u)) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) {
			continue;
		}
		const eq = line.indexOf("=");
		if (eq < 1) {
			continue;
		}
		values[line.slice(0, eq).trim().toUpperCase()] = unquote(line.slice(eq + 1).trim());
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
