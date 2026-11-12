import { Agent, fetch as undiciFetch } from "undici";
import { rooted } from "../paths.js";
import { fetchDecisions } from "./decisions.js";

// The connection test of Settings, CrowdSec (the Test connection button, a save while the bouncer is on, the startup
// block): one decisions request to the LAPI with the bouncer's credentials, and with an AppSec URL one harmless
// request to AppSec with the bouncer's headers. A result never holds the key.

const TEST_IP = "127.0.0.1";
const TLS_CODE =
	/^(?:ERR_TLS_|ERR_SSL_|ERR_OSSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|HOSTNAME_MISMATCH|ERR_CROWDSEC_TLS_SETUP)/u;
const agents = new Map();

const codeOf = (err) => err?.code ?? err?.cause?.code ?? "";
const check = (name, result, message = "") => ({ name, result, message });

// AppSec over undici with its own dispatcher: SSL_VERIFY=false must reach a self-signed AppSec like the bouncer does
const agentFor = (verify) => {
	if (!agents.has(verify)) agents.set(verify, new Agent({ connect: { rejectUnauthorized: verify } }));
	return agents.get(verify);
};

const checkLapi = async (values, { fetch, timeoutMs }) => {
	if (values.api_url === "") return check("lapi", "unreachable", "No LAPI URL is set");
	// no key and no client certificate: nothing to send (an empty key header would only be refused)
	if (!values.use_tls_auth && values.api_key === "") return check("lapi", "no_key", "No API key is set");
	try {
		await fetchDecisions(
			{
				apiUrl: values.api_url,
				apiKey: values.api_key,
				useTls: values.use_tls_auth,
				certFile: values.tls_client_cert ? rooted(values.tls_client_cert) : "",
				keyFile: values.tls_client_key ? rooted(values.tls_client_key) : "",
				sslVerify: values.ssl_verify,
				query: `?ip=${TEST_IP}`,
			},
			{ fetch, timeoutMs },
		);
		return check("lapi", "ok");
	} catch (err) {
		if (err?.status === 401 || err?.status === 403) return check("lapi", "key_refused", `HTTP ${err.status}`);
		if (err?.status) return check("lapi", "status", `HTTP ${err.status}`);
		return check("lapi", TLS_CODE.test(codeOf(err)) ? "tls_error" : "unreachable", err?.message ?? "error");
	}
};

const checkAppsec = async (values, { timeoutMs }) => {
	if (values.api_key === "") return check("appsec", "no_key", "No API key is set");
	try {
		const res = await undiciFetch(values.appsec_url, {
			method: "GET",
			headers: {
				"x-crowdsec-appsec-api-key": values.api_key,
				"x-crowdsec-appsec-ip": TEST_IP,
				"x-crowdsec-appsec-host": "npmpro.invalid",
				"x-crowdsec-appsec-verb": "GET",
				"x-crowdsec-appsec-uri": "/",
				"x-crowdsec-appsec-user-agent": "NPMpro connection test",
			},
			dispatcher: agentFor(values.ssl_verify !== false),
			signal: AbortSignal.timeout(timeoutMs),
		});
		await res.body?.cancel().catch(() => undefined);
		if (res.ok) return check("appsec", "ok");
		// AppSec answered and blocked the test request: it runs and took the key
		if (res.status === 403) return check("appsec", "ok", "HTTP 403: AppSec blocked the test request");
		if (res.status === 401) return check("appsec", "refused", "HTTP 401");
		return check("appsec", "status", `HTTP ${res.status}`);
	} catch (err) {
		const code = codeOf(err);
		if (TLS_CODE.test(code)) return check("appsec", "tls_error", code);
		return check("appsec", "unreachable", code || err?.name || "error");
	}
};

/**
 * @param   {Object}   values  settings in the API shape, secrets in plain text
 * @param   {Object}   [options]
 * @param   {Function} [options.fetch]      for the LAPI's verified API key path (tests)
 * @param   {number}   [options.timeoutMs]  per check
 * @returns {Promise<{ ok: boolean, checks: { name: string, result: string, message: string }[] }>}
 */
const testConnection = async (values, { fetch = globalThis.fetch, timeoutMs = 5000 } = {}) => {
	const checks = await Promise.all([
		checkLapi(values, { fetch, timeoutMs }),
		...(values.appsec_url === "" ? [] : [checkAppsec(values, { timeoutMs })]),
	]);
	return { ok: checks.every((item) => item.result === "ok"), checks };
};

export { testConnection };
