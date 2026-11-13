/**
 * The CrowdSec section of Settings (pages/Settings/Crowdsec.jsx) on React Hook Form: its starting values, the validate
 * function (the rules of the backend's lib/crowdsec/settings.js), the request, the lines of a connection test and the
 * checks of a save the test refused. Pure, so node --test checks them without a DOM.
 */
import { lockedIn } from "./SettingsForms.js";

export const CROWDSEC_RET_CODES = [
	"200",
	"202",
	"204",
	"301",
	"302",
	"400",
	"401",
	"403",
	"404",
	"405",
	"406",
	"444",
	"500",
];
export const CAPTCHA_PROVIDERS = ["none", "recaptcha", "hcaptcha", "turnstile"];

const SAFE = /^[^\r\n#]*$/u;
const HTTP_URL = /^https?:\/\/[^\s/?#@]+(?:\/[^\s#]*)?$/u;
const REDIRECT = /^(?:https?:\/\/[^\s/?#@]+(?:\/[^\s#]*)?|\/[^\s#]+)$/u;
const EXCLUDE = /^\/[^\s,#]*(?:,\/[^\s,#]*)*$/u;
const CROWDSEC_PATH = /^\/data\/crowdsec\/[^\s#]+$/u;
// "." or ".." as a path segment, or an empty one: the backend refuses paths that are not normalised
const ODD_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)|\/\//u;

const SWITCHES = [
	"enabled",
	"sslVerify",
	"enableInternal",
	"alwaysSendToAppsec",
	"appsecDropUnreadableBody",
	"adminUiExcluded",
];
const TEXTS = [
	"apiUrl",
	"tlsClientCert",
	"tlsClientKey",
	"scenariosContaining",
	"scenariosNotContaining",
	"excludeLocation",
	"redirectLocation",
	"captchaSiteKey",
	"appsecUrl",
];
const CHOICES = ["mode", "bouncingOnType", "fallbackRemediation", "banResponse", "appsecFailureAction"];
const INTEGERS = {
	cacheExpiration: { min: 1, max: 86400 },
	updateFrequency: { min: 1, max: 86400 },
	requestTimeout: { min: 100, max: 60000 },
	captchaExpiration: { min: 60, max: 2592000 },
};
const OPTIONAL_INTEGERS = {
	appsecConnectTimeout: { min: 1, max: 60000 },
	appsecSendTimeout: { min: 1, max: 60000 },
	appsecProcessTimeout: { min: 1, max: 60000 },
};
const CHECK_RESULTS = {
	lapi: ["ok", "no_key", "key_refused", "unreachable", "tls_error", "status"],
	appsec: ["ok", "no_key", "refused", "unreachable", "tls_error", "status"],
};

// the fields of the collapsed Advanced part: a refused save opens it when one of them has an error
export const ADVANCED_FIELDS = [
	"requestTimeout",
	"scenariosContaining",
	"scenariosNotContaining",
	"excludeLocation",
	"enableInternal",
	"appsecConnectTimeout",
	"appsecSendTimeout",
	"appsecProcessTimeout",
	"alwaysSendToAppsec",
	"appsecDropUnreadableBody",
];

// field name -> label translation id, for the note next to Save (the inputs' ids differ from the field names)
export const CROWDSEC_FIELD_LABELS = {
	apiUrl: "settings.crowdsec.api-url",
	apiKey: "settings.crowdsec.api-key",
	tlsClientCert: "settings.crowdsec.tls-cert",
	tlsClientKey: "settings.crowdsec.tls-key",
	cacheExpiration: "settings.crowdsec.cache-expiration",
	updateFrequency: "settings.crowdsec.update-frequency",
	redirectLocation: "settings.crowdsec.redirect-location",
	retCode: "settings.crowdsec.ret-code",
	captchaSiteKey: "settings.crowdsec.site-key",
	captchaSecretKey: "settings.crowdsec.secret-key",
	captchaExpiration: "settings.crowdsec.captcha-expiration",
	appsecUrl: "settings.crowdsec.appsec-url",
	requestTimeout: "settings.crowdsec.request-timeout",
	scenariosContaining: "settings.crowdsec.scenarios-containing",
	scenariosNotContaining: "settings.crowdsec.scenarios-not-containing",
	excludeLocation: "settings.crowdsec.exclude-location",
	appsecConnectTimeout: "settings.crowdsec.appsec-connect-timeout",
	appsecSendTimeout: "settings.crowdsec.appsec-send-timeout",
	appsecProcessTimeout: "settings.crowdsec.appsec-process-timeout",
};

const numberText = (value) => (value === null || value === undefined ? "" : String(value));
const trimmed = (value) => String(value ?? "").trim();
const isCrowdsecPath = (value) => CROWDSEC_PATH.test(value) && !ODD_SEGMENT.test(value) && !value.endsWith("/");

/**
 * The form values of the loaded settings (camelized GET answer); secrets start empty
 *
 * @param   {Object} data
 * @returns {Object}
 */
export const crowdsecValues = (data) => ({
	enabled: Boolean(data.enabled),
	apiUrl: data.apiUrl ?? "",
	apiKey: "",
	clearApiKey: false,
	auth: data.useTlsAuth ? "tls" : "key",
	tlsClientCert: data.tlsClientCert ?? "",
	tlsClientKey: data.tlsClientKey ?? "",
	sslVerify: data.sslVerify !== false,
	mode: data.mode ?? "live",
	cacheExpiration: numberText(data.cacheExpiration),
	updateFrequency: numberText(data.updateFrequency),
	requestTimeout: numberText(data.requestTimeout),
	bouncingOnType: data.bouncingOnType ?? "all",
	fallbackRemediation: data.fallbackRemediation ?? "ban",
	banResponse: data.banResponse ?? "page",
	redirectLocation: data.redirectLocation ?? "",
	retCode: data.retCode === null || data.retCode === undefined ? "default" : String(data.retCode),
	captchaProvider: data.captchaProvider || "none",
	captchaSiteKey: data.captchaSiteKey ?? "",
	captchaSecretKey: "",
	captchaExpiration: numberText(data.captchaExpiration),
	appsecUrl: data.appsecUrl ?? "",
	appsecFailureAction: data.appsecFailureAction ?? "deny",
	appsecConnectTimeout: numberText(data.appsecConnectTimeout),
	appsecSendTimeout: numberText(data.appsecSendTimeout),
	appsecProcessTimeout: numberText(data.appsecProcessTimeout),
	alwaysSendToAppsec: Boolean(data.alwaysSendToAppsec),
	appsecDropUnreadableBody: data.appsecDropUnreadableBody !== false,
	enableInternal: Boolean(data.enableInternal),
	scenariosContaining: data.scenariosContaining ?? "",
	scenariosNotContaining: data.scenariosNotContaining ?? "",
	excludeLocation: data.excludeLocation ?? "",
	adminUiExcluded: Boolean(data.adminUiExcluded),
});

/**
 * @param   {Object}   rules     createValidations' result
 * @param   {Function} isLocked  (camelCase key) => boolean; a value set by env never blocks the save
 * @param   {Object}   data      the loaded settings (apiKeySet, captchaSecretSet)
 * @returns {Function} (values) => errors
 */
export const crowdsecValidate = (rules, isLocked, data) => (values) => {
	const errors = {};
	const put = (key, message) => {
		if (message && !errors[key] && !isLocked(key)) errors[key] = message;
	};
	const fail = (key, id) => put(key, rules.message(id));
	for (const key of [...TEXTS, "apiKey", "captchaSecretKey"]) {
		if (!SAFE.test(trimmed(values[key]))) fail(key, "settings.crowdsec.error.characters");
	}
	const apiUrl = trimmed(values.apiUrl);
	if (values.enabled && apiUrl === "") fail("apiUrl", "error.required");
	else if (apiUrl !== "" && !HTTP_URL.test(apiUrl)) fail("apiUrl", "settings.crowdsec.error.url");
	const appsecUrl = trimmed(values.appsecUrl);
	if (appsecUrl !== "" && !HTTP_URL.test(appsecUrl)) fail("appsecUrl", "settings.crowdsec.error.url");
	if (values.auth === "tls") {
		if (values.enabled && apiUrl.startsWith("http://")) fail("apiUrl", "settings.crowdsec.error.tls-https");
		for (const key of ["tlsClientCert", "tlsClientKey"]) {
			if (trimmed(values[key]) === "") {
				if (values.enabled) fail(key, "error.required");
			} else if (!isCrowdsecPath(trimmed(values[key]))) {
				fail(key, "settings.crowdsec.error.path");
			}
		}
	}
	// AppSec authenticates with the API key, also with a TLS client certificate
	const needsKey = values.auth !== "tls" || appsecUrl !== "";
	if (values.enabled && needsKey && trimmed(values.apiKey) === "" && !(data.apiKeySet && !values.clearApiKey)) {
		fail("apiKey", "error.required");
	}
	if (values.banResponse === "redirect") {
		const target = trimmed(values.redirectLocation);
		if (target === "") fail("redirectLocation", "error.required");
		else if (!REDIRECT.test(target)) fail("redirectLocation", "settings.crowdsec.error.redirect");
	}
	if (values.banResponse === "status" && values.retCode === "default") fail("retCode", "error.required");
	if (values.captchaProvider !== "none") {
		if (trimmed(values.captchaSiteKey) === "") fail("captchaSiteKey", "error.required");
		if (trimmed(values.captchaSecretKey) === "" && !data.captchaSecretSet)
			fail("captchaSecretKey", "error.required");
	}
	const exclude = trimmed(values.excludeLocation);
	if (exclude !== "" && !EXCLUDE.test(exclude)) fail("excludeLocation", "settings.crowdsec.error.exclude");
	for (const [key, range] of Object.entries(INTEGERS)) {
		put(key, rules.validateInteger({ required: true, ...range })(values[key]));
	}
	for (const [key, range] of Object.entries(OPTIONAL_INTEGERS)) put(key, rules.validateInteger(range)(values[key]));
	return errors;
};

/**
 * The PUT (or test) body in camelCase (base.js sends it in snake_case): locked fields left out, numbers as numbers,
 * empty optional numbers as null, a secret only when typed (null when the saved key is removed)
 *
 * @param   {Object}  values
 * @param   {Object}  data   the loaded settings (locked)
 * @param   {Object}  [options]
 * @param   {boolean} [options.force]  Save anyway
 * @returns {Object}
 */
export const crowdsecRequest = (values, data, { force = false } = {}) => {
	const isLocked = lockedIn(data.locked);
	const body = {};
	const put = (key, value) => {
		if (!isLocked(key)) body[key] = value;
	};
	for (const key of SWITCHES) put(key, Boolean(values[key]));
	for (const key of TEXTS) put(key, trimmed(values[key]));
	for (const key of CHOICES) put(key, values[key]);
	for (const key of Object.keys(INTEGERS)) put(key, Number(trimmed(values[key])));
	for (const key of Object.keys(OPTIONAL_INTEGERS))
		put(key, trimmed(values[key]) === "" ? null : Number(trimmed(values[key])));
	put("useTlsAuth", values.auth === "tls");
	put("captchaProvider", values.captchaProvider === "none" ? "" : values.captchaProvider);
	put("retCode", values.retCode === "default" ? null : Number(values.retCode));
	if (values.clearApiKey) put("apiKey", null);
	else if (trimmed(values.apiKey) !== "") put("apiKey", trimmed(values.apiKey));
	if (trimmed(values.captchaSecretKey) !== "") put("captchaSecretKey", trimmed(values.captchaSecretKey));
	if (force) body.force = true;
	return body;
};

/**
 * The lines of a connection test: an unknown result reads as an unexpected answer
 *
 * @param   {{ name: string, result: string, message?: string }[]} [checks]
 * @returns {{ name: string, ok: boolean, labelId: string, detail: string }[]}
 */
export const checkRows = (checks) =>
	(checks ?? []).map(({ name, result, message }) => {
		const kind = name === "appsec" ? "appsec" : "lapi";
		return {
			name,
			ok: result === "ok",
			labelId: `settings.crowdsec.check.${kind}.${CHECK_RESULTS[kind].includes(result) ? result : "status"}`,
			detail: message ?? "",
		};
	});

/**
 * The checks of a save the connection test refused (409 error.crowdsec-test-failed), else null
 *
 * @param   {unknown} err  an error of src/api/backend/base.js
 * @returns {Object[]|null}
 */
export const failedChecks = (err) => {
	const error = err?.payload?.error;
	return error?.message_i18n === "error.crowdsec-test-failed" && Array.isArray(error.checks) ? error.checks : null;
};

/**
 * Whether the backend refused the save for good ("Save anyway" would lock the admin UI out too): error.force_blocked
 *
 * @param   {unknown} err  an error of src/api/backend/base.js
 * @returns {boolean}
 */
export const forceBlocked = (err) => {
	const error = err?.payload?.error;
	return error?.message_i18n === "error.crowdsec-test-failed" && error.force_blocked === "appsec_deny_admin";
};

/**
 * AppSec deny while the admin UI is checked: a CrowdSec outage blocks the admin UI too
 *
 * @param   {{ appsecUrl: string, appsecFailureAction: string, adminUiExcluded: boolean }} values
 * @returns {boolean}
 */
export const appsecDenyWarning = (values) =>
	trimmed(values.appsecUrl) !== "" && values.appsecFailureAction === "deny" && !values.adminUiExcluded;

/**
 * What to tell the admin when the bouncer is switched on in the settings but nginx does not load it. An AppSec URL
 * without an API key (a restore without secrets, an import) keeps it off on purpose, since AppSec would refuse every
 * request: the way out is to enter the key or clear the AppSec URL. Otherwise the GET answer only says that it is not
 * loaded (status.loaded), so the file is named from the TLS settings: with TLS authentication the client certificate
 * and key are the files the bouncer cannot start without. The way out is to put the files back, or switch TLS
 * authentication or the bouncer off.
 *
 * @param   {Object} data  the loaded settings (camelized GET answer)
 * @returns {{ kind: "appsec-key" | "tls" | "off", files: string[] } | null}  null while nothing is wrong
 */
export const bouncerOffWarning = (data) => {
	if (!data?.enabled || data.status?.loaded !== false) return null;
	if (trimmed(data.appsecUrl) !== "" && !data.apiKeySet) return { kind: "appsec-key", files: [] };
	if (data.useTlsAuth) return { kind: "tls", files: [data.tlsClientCert, data.tlsClientKey].filter(Boolean) };
	return { kind: "off", files: [] };
};
