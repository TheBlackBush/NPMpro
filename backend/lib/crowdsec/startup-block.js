// The CrowdSec block of the startup log (spec section 4), in the style of the launch.sh banner. Pure: the caller runs
// the connection test and the file checks. It never holds the API key or the captcha secret.

const LINE = "-------------------------------------";
const firstLine = (text) => String(text ?? "").split("\n")[0];

const lapiText = (check) => {
	switch (check.result) {
		case "ok":
			return "reachable, key accepted";
		case "no_key":
			return "no API key set";
		case "key_refused":
			return "reachable, key refused";
		case "tls_error":
			return `TLS error (${check.message})`;
		case "status":
			return `answered ${check.message}`;
		default:
			return `not reachable (${check.message})`;
	}
};

const appsecText = (values, check) => {
	if (!values.appsec_url) return "off";
	if (check?.result === "refused") return `${values.appsec_url}, key refused`;
	if (check?.result === "no_key") return `${values.appsec_url}, no API key set`;
	if (check && check.result !== "ok") return `${values.appsec_url}, not reachable (${check.message})`;
	return `${values.appsec_url}, ${values.appsec_failure_action === "deny" ? "deny" : "passthrough"} when unreachable`;
};

/**
 * The warning lines that apply
 *
 * @param   {Object}   input
 * @param   {Object}   input.values
 * @param   {Object[]} [input.checks]        testConnection checks
 * @param   {string}   [input.nginxError]    the nginx -t output when the files were not applied
 * @param   {string[]} [input.missingFiles]  files the bouncer reads that are missing or unreadable
 * @param   {boolean}  [input.localOverride] crowdsec.conf.local exists
 * @returns {string[]}
 */
const startupWarnings = ({ values, checks = [], nginxError = null, missingFiles = [], localOverride = false }) => {
	const warnings = [];
	if (nginxError)
		warnings.push(`the bouncer config did not pass nginx -t, the bouncer is off: ${firstLine(nginxError)}`);
	const override = localOverride ? ["/data/crowdsec/crowdsec.conf.local overrides these settings, remove it"] : [];
	if (!values.enabled) return [...warnings, ...override];
	const lapi = checks.find((check) => check.name === "lapi");
	const appsec = checks.find((check) => check.name === "appsec");
	if (lapi && lapi.result !== "ok") warnings.push("the LAPI check failed, decisions are not applied until it passes");
	if (appsec && appsec.result !== "ok") {
		warnings.push(
			values.appsec_failure_action === "deny"
				? "AppSec cannot be reached: requests are blocked while AppSec is down"
				: "AppSec cannot be reached: requests pass unchecked while AppSec is down",
		);
	}
	if (values.appsec_url && values.appsec_failure_action === "deny" && !values.admin_ui_excluded) {
		warnings.push(
			"AppSec deny also blocks the admin UI while AppSec is down (Settings, CrowdSec: Leave the admin UI out of CrowdSec)",
		);
	}
	for (const file of missingFiles) warnings.push(`${file} does not exist or cannot be read`);
	return [...warnings, ...override];
};

/**
 * @param   {Object}   input
 * @param   {Object}   input.values
 * @param   {Object}   [input.lockedBy]  key -> variable name
 * @param   {Object[]} [input.checks]
 * @param   {string[]} [input.warnings]
 * @param   {boolean}  [input.bouncerOff]  enabled in the settings, switched off because a file is missing
 * @returns {string}
 */
const renderStartupBlock = ({ values, lockedBy = {}, checks = [], warnings = [], bouncerOff = false }) => {
	const warningLines = warnings.map((warning) => `Warning:  ${warning}`);
	if (bouncerOff) return ["CrowdSec: off (a file is missing, see the warning)", ...warningLines].join("\n");
	if (!values.enabled) return ["CrowdSec: off (Settings, CrowdSec)", ...warningLines].join("\n");
	const lapi = checks.find((check) => check.name === "lapi");
	const appsec = checks.find((check) => check.name === "appsec");
	const locked = Object.values(lockedBy);
	return [
		LINE,
		`CrowdSec: on, ${values.mode} mode`,
		`LAPI:     ${values.api_url}${lapi ? `, ${lapiText(lapi)}` : ""}`,
		`AppSec:   ${appsecText(values, appsec)}`,
		`Captcha:  ${values.captcha_provider || "none"}`,
		`Admin UI: ${values.admin_ui_excluded ? "left out of CrowdSec" : "checked by CrowdSec"}`,
		...(locked.length > 0 ? [`Locked:   ${locked.join(", ")}`] : []),
		...warningLines,
		LINE,
	].join("\n");
};

export { renderStartupBlock, startupWarnings };
