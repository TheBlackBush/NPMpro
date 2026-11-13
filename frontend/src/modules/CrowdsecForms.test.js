import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	appsecDenyWarning,
	bouncerOffWarning,
	checkRows,
	crowdsecRequest,
	crowdsecValidate,
	crowdsecValues,
	failedChecks,
	forceBlocked,
} from "./CrowdsecForms.js";
import { lockedIn } from "./SettingsForms.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));
const REQUIRED = en["error.required"];
const URL_ERROR = en["settings.crowdsec.error.url"];
const PATH_ERROR = en["settings.crowdsec.error.path"];

// the GET answer of a fresh install, camelized by base.js
const DATA = {
	enabled: false,
	apiUrl: "http://127.0.0.1:8080",
	apiKeySet: false,
	useTlsAuth: false,
	tlsClientCert: "",
	tlsClientKey: "",
	sslVerify: true,
	mode: "live",
	cacheExpiration: 1,
	updateFrequency: 10,
	requestTimeout: 3000,
	bouncingOnType: "all",
	fallbackRemediation: "ban",
	banResponse: "page",
	banTemplatePath: "/data/crowdsec/ban.html",
	redirectLocation: "",
	retCode: null,
	captchaProvider: "",
	captchaSecretSet: false,
	captchaSiteKey: "",
	captchaTemplatePath: "/data/crowdsec/captcha.html",
	captchaExpiration: 3600,
	appsecUrl: "",
	appsecFailureAction: "deny",
	appsecConnectTimeout: null,
	appsecSendTimeout: null,
	appsecProcessTimeout: null,
	alwaysSendToAppsec: false,
	appsecDropUnreadableBody: true,
	enableInternal: false,
	scenariosContaining: "",
	scenariosNotContaining: "",
	excludeLocation: "",
	adminUiExcluded: false,
	locked: [],
	lockedBy: {},
	secretError: false,
	status: { loaded: false, reachable: false, lastContact: null, error: null },
};
const base = crowdsecValues(DATA);
const validate = (values, data = DATA, locked = []) => crowdsecValidate(rules, lockedIn(locked), data)(values);

it("starts from the saved settings: numbers as text, no secret, the form's own choices", () => {
	assert.equal(base.cacheExpiration, "1");
	assert.equal(base.retCode, "default");
	assert.equal(base.captchaProvider, "none");
	assert.equal(base.auth, "key");
	assert.equal(base.apiKey, "");
	assert.equal(base.clearApiKey, false);
	assert.equal(base.captchaSecretKey, "");
	assert.equal(base.appsecConnectTimeout, "");
	assert.equal(base.appsecDropUnreadableBody, true);
	const other = crowdsecValues({
		...DATA,
		retCode: 444,
		useTlsAuth: true,
		captchaProvider: "turnstile",
		appsecSendTimeout: 50,
	});
	assert.equal(other.retCode, "444");
	assert.equal(other.auth, "tls");
	assert.equal(other.captchaProvider, "turnstile");
	assert.equal(other.appsecSendTimeout, "50");
});

it("builds the request: numbers, nulls, secrets only when typed, locked fields left out", () => {
	const values = {
		...base,
		cacheExpiration: " 5 ",
		apiKey: " k ",
		appsecSendTimeout: "",
		apiUrl: " http://lapi:8080 ",
	};
	const body = crowdsecRequest(values, DATA);
	assert.equal(body.cacheExpiration, 5);
	assert.equal(body.apiKey, "k");
	assert.equal(body.apiUrl, "http://lapi:8080");
	assert.equal(Object.hasOwn(body, "captchaSecretKey"), false);
	assert.equal(body.appsecSendTimeout, null);
	assert.equal(body.retCode, null);
	assert.equal(body.captchaProvider, "");
	assert.equal(body.useTlsAuth, false);
	for (const key of ["force", "auth", "clearApiKey"]) assert.equal(Object.hasOwn(body, key), false, key);
	assert.equal(crowdsecRequest({ ...values, clearApiKey: true }, DATA).apiKey, null);
	assert.equal(crowdsecRequest(values, DATA, { force: true }).force, true);
	assert.equal(crowdsecRequest({ ...values, retCode: "403", auth: "tls" }, DATA).retCode, 403);
	assert.equal(crowdsecRequest({ ...values, auth: "tls" }, DATA).useTlsAuth, true);
	assert.equal(crowdsecRequest({ ...values, captchaSecretKey: " s " }, DATA).captchaSecretKey, "s");
	const locked = crowdsecRequest(values, { ...DATA, locked: ["api_key", "enabled", "api_url"] });
	for (const key of ["apiKey", "enabled", "apiUrl"]) assert.equal(Object.hasOwn(locked, key), false, key);
});

it("accepts the defaults and asks for a key only while the bouncer is on", () => {
	assert.deepEqual(validate(base), {});
	assert.deepEqual(validate({ ...base, enabled: true }), { apiKey: REQUIRED });
	assert.deepEqual(validate({ ...base, enabled: true }, { ...DATA, apiKeySet: true }), {});
	assert.deepEqual(validate({ ...base, enabled: true, clearApiKey: true }, { ...DATA, apiKeySet: true }), {
		apiKey: REQUIRED,
	});
	assert.deepEqual(validate({ ...base, enabled: true }, DATA, ["api_key"]), {});
	assert.deepEqual(validate({ ...base, enabled: true, apiUrl: "", apiKey: "k" }), { apiUrl: REQUIRED });
});

it("checks URLs, paths, lists and numbers like the backend", () => {
	assert.deepEqual(validate({ ...base, apiUrl: "http://user:pw@lapi:8080" }), { apiUrl: URL_ERROR });
	assert.deepEqual(validate({ ...base, apiUrl: "ftp://lapi" }), { apiUrl: URL_ERROR });
	assert.deepEqual(validate({ ...base, apiUrl: "ftp://lapi" }, DATA, ["api_url"]), {});
	assert.deepEqual(validate({ ...base, appsecUrl: "lapi:7422" }), { appsecUrl: URL_ERROR });
	assert.deepEqual(validate({ ...base, scenariosContaining: "http-#" }), {
		scenariosContaining: en["settings.crowdsec.error.characters"],
	});
	assert.deepEqual(
		validate({ ...base, captchaSiteKey: "a\nb", captchaProvider: "hcaptcha", captchaSecretKey: "s" }),
		{
			captchaSiteKey: en["settings.crowdsec.error.characters"],
		},
	);
	assert.deepEqual(validate({ ...base, excludeLocation: "/health,metrics" }), {
		excludeLocation: en["settings.crowdsec.error.exclude"],
	});
	assert.deepEqual(validate({ ...base, excludeLocation: "/health,/.well-known/" }), {});
	assert.deepEqual(validate({ ...base, banTemplatePath: "/etc/ban.html" }), { banTemplatePath: PATH_ERROR });
	assert.deepEqual(validate({ ...base, captchaTemplatePath: "/data/crowdsec/../npmpro/x" }), {
		captchaTemplatePath: PATH_ERROR,
	});
	assert.deepEqual(validate({ ...base, cacheExpiration: "0" }), {
		cacheExpiration: "Enter a whole number from 1 to 86400",
	});
	assert.deepEqual(validate({ ...base, captchaExpiration: "" }), { captchaExpiration: REQUIRED });
	assert.deepEqual(validate({ ...base, appsecProcessTimeout: "0" }), {
		appsecProcessTimeout: "Enter a whole number from 1 to 60000",
	});
});

it("checks TLS authentication", () => {
	const tls = { ...base, enabled: true, auth: "tls" };
	assert.deepEqual(validate(tls), {
		apiUrl: en["settings.crowdsec.error.tls-https"],
		tlsClientCert: REQUIRED,
		tlsClientKey: REQUIRED,
	});
	assert.deepEqual(
		validate({
			...tls,
			apiUrl: "https://lapi:8080",
			tlsClientCert: "/data/crowdsec/c.crt",
			tlsClientKey: "/root/c.key",
		}),
		{ tlsClientKey: PATH_ERROR },
	);
	assert.deepEqual(validate({ ...base, auth: "tls" }), {});
});

it("requires the API key with TLS authentication once an AppSec URL is set", () => {
	const tls = {
		...base,
		enabled: true,
		auth: "tls",
		apiUrl: "https://lapi:8080",
		tlsClientCert: "/data/crowdsec/c.crt",
		tlsClientKey: "/data/crowdsec/c.key",
	};
	assert.deepEqual(validate(tls), {});
	const appsec = { ...tls, appsecUrl: "http://appsec:7422" };
	assert.deepEqual(validate(appsec), { apiKey: REQUIRED });
	assert.deepEqual(validate({ ...appsec, apiKey: "k" }), {});
	assert.deepEqual(validate(appsec, { ...DATA, apiKeySet: true }), {});
	assert.deepEqual(validate({ ...appsec, clearApiKey: true }, { ...DATA, apiKeySet: true }), { apiKey: REQUIRED });
	assert.deepEqual(validate(appsec, DATA, ["api_key"]), {});
	assert.deepEqual(validate({ ...appsec, enabled: false }), {});
});

it("checks the ban response and the captcha keys", () => {
	assert.deepEqual(validate({ ...base, banResponse: "redirect" }), { redirectLocation: REQUIRED });
	assert.deepEqual(validate({ ...base, banResponse: "redirect", redirectLocation: "/" }), {
		redirectLocation: en["settings.crowdsec.error.redirect"],
	});
	assert.deepEqual(
		validate({ ...base, banResponse: "redirect", redirectLocation: "https://example.com/banned" }),
		{},
	);
	assert.deepEqual(validate({ ...base, banResponse: "status" }), { retCode: REQUIRED });
	assert.deepEqual(validate({ ...base, banResponse: "status", retCode: "444" }), {});
	assert.deepEqual(validate({ ...base, captchaProvider: "turnstile" }), {
		captchaSiteKey: REQUIRED,
		captchaSecretKey: REQUIRED,
	});
	assert.deepEqual(
		validate({ ...base, captchaProvider: "turnstile", captchaSiteKey: "s" }, { ...DATA, captchaSecretSet: true }),
		{},
	);
});

it("lists the check lines with labels that exist", () => {
	assert.deepEqual(
		checkRows([
			{ name: "lapi", result: "key_refused", message: "HTTP 403" },
			{ name: "appsec", result: "something new", message: "" },
		]),
		[
			{ name: "lapi", ok: false, labelId: "settings.crowdsec.check.lapi.key_refused", detail: "HTTP 403" },
			{ name: "appsec", ok: false, labelId: "settings.crowdsec.check.appsec.status", detail: "" },
		],
	);
	assert.deepEqual(checkRows(undefined), []);
	const all = ["ok", "no_key", "key_refused", "refused", "unreachable", "tls_error", "status"].flatMap((result) =>
		checkRows([
			{ name: "lapi", result },
			{ name: "appsec", result },
		]),
	);
	for (const row of all) assert.ok(Object.hasOwn(en, row.labelId), row.labelId);
	assert.equal(all.filter((row) => row.ok).length, 2);
});

it("tells a save the test refused from other errors", () => {
	const checks = [{ name: "lapi", result: "unreachable", message: "x" }];
	assert.deepEqual(
		failedChecks({ payload: { error: { message_i18n: "error.crowdsec-test-failed", checks } } }),
		checks,
	);
	assert.equal(failedChecks({ payload: { error: { message_i18n: "error.crowdsec-test-failed" } } }), null);
	assert.equal(failedChecks({ payload: { error: { message_i18n: "error.other", checks } } }), null);
	assert.equal(failedChecks(new Error("x")), null);
	assert.equal(failedChecks(undefined), null);
});

it("reads the flag that forbids Save anyway", () => {
	const error = { message_i18n: "error.crowdsec-test-failed", checks: [], force_blocked: "appsec_deny_admin" };
	assert.equal(forceBlocked({ payload: { error } }), true);
	assert.equal(forceBlocked({ payload: { error: { ...error, force_blocked: undefined } } }), false);
	assert.equal(forceBlocked({ payload: { error: { ...error, message_i18n: "error.other" } } }), false);
	assert.equal(forceBlocked(new Error("x")), false);
	assert.equal(forceBlocked(undefined), false);
});

it("warns about AppSec deny while the admin UI is checked", () => {
	const deny = { appsecUrl: "http://a:7422", appsecFailureAction: "deny", adminUiExcluded: false };
	assert.equal(appsecDenyWarning(deny), true);
	assert.equal(appsecDenyWarning({ ...deny, adminUiExcluded: true }), false);
	assert.equal(appsecDenyWarning({ ...deny, appsecFailureAction: "passthrough" }), false);
	assert.equal(appsecDenyWarning({ ...deny, appsecUrl: " " }), false);
});

it("requires the ban and captcha page files while they are used", () => {
	assert.deepEqual(validate({ ...base, banTemplatePath: "" }), { banTemplatePath: REQUIRED });
	assert.deepEqual(validate({ ...base, banResponse: "status", retCode: "403", banTemplatePath: "" }), {});
	assert.deepEqual(
		validate({
			...base,
			captchaProvider: "turnstile",
			captchaSiteKey: "s",
			captchaSecretKey: "k",
			captchaTemplatePath: "",
		}),
		{ captchaTemplatePath: REQUIRED },
	);
});

it("names the files when the enabled bouncer is not loaded", () => {
	const on = { ...DATA, enabled: true };
	assert.equal(bouncerOffWarning(DATA), null);
	assert.equal(bouncerOffWarning({ ...on, status: { ...DATA.status, loaded: true } }), null);
	assert.equal(bouncerOffWarning({ ...on, status: undefined }), null);
	assert.deepEqual(bouncerOffWarning(on), { kind: "off", files: [] });
	// an AppSec URL without a key keeps the bouncer off, also with TLS authentication; a key or no URL does not
	const appsec = { ...on, appsecUrl: " http://127.0.0.1:7422 ", apiKeySet: false };
	assert.deepEqual(bouncerOffWarning(appsec), { kind: "appsec-key", files: [] });
	assert.deepEqual(bouncerOffWarning({ ...appsec, useTlsAuth: true }), { kind: "appsec-key", files: [] });
	assert.deepEqual(bouncerOffWarning({ ...appsec, apiKeySet: true }), { kind: "off", files: [] });
	assert.deepEqual(bouncerOffWarning({ ...appsec, appsecUrl: "  " }), { kind: "off", files: [] });
	assert.equal(bouncerOffWarning({ ...appsec, status: { ...DATA.status, loaded: true } }), null);
	assert.deepEqual(
		bouncerOffWarning({ ...on, useTlsAuth: true, tlsClientCert: "/data/crowdsec/c.crt", tlsClientKey: "" }),
		{
			kind: "tls",
			files: ["/data/crowdsec/c.crt"],
		},
	);
});

it("falls back to the defaults for an answer without fields", () => {
	const empty = crowdsecValues({});
	assert.equal(empty.enabled, false);
	assert.equal(empty.sslVerify, true);
	assert.equal(empty.appsecDropUnreadableBody, true);
	assert.equal(empty.mode, "live");
	assert.equal(empty.bouncingOnType, "all");
	assert.equal(empty.fallbackRemediation, "ban");
	assert.equal(empty.banResponse, "page");
	assert.equal(empty.appsecFailureAction, "deny");
	assert.equal(empty.retCode, "default");
	assert.equal(empty.captchaProvider, "none");
	for (const key of [
		"apiUrl",
		"tlsClientCert",
		"banTemplatePath",
		"captchaSiteKey",
		"excludeLocation",
		"cacheExpiration",
	]) {
		assert.equal(empty[key], "", key);
	}
	assert.equal(crowdsecValues({ sslVerify: false, appsecDropUnreadableBody: false }).sslVerify, false);
});

it("sends the values as they are, treats unknown results as unexpected and ignores secrets in odd places", () => {
	assert.equal(crowdsecRequest({ ...base, apiKey: "" }, DATA).apiKey, undefined);
	assert.equal(crowdsecRequest(base, { locked: undefined }).enabled, false);
	assert.equal(crowdsecRequest({ ...base, retCode: "444" }, DATA).retCode, 444);
	assert.deepEqual(checkRows([{ name: "lapi", result: "ok" }]), [
		{ name: "lapi", ok: true, labelId: "settings.crowdsec.check.lapi.ok", detail: "" },
	]);
	assert.equal(failedChecks({ payload: {} }), null);
	assert.equal(
		appsecDenyWarning({ appsecUrl: undefined, appsecFailureAction: "deny", adminUiExcluded: false }),
		false,
	);
	assert.deepEqual(validate({ ...base, enabled: true, apiKey: "k", apiUrl: undefined }), { apiUrl: REQUIRED });
});
