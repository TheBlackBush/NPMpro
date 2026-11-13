import assert from "node:assert/strict";
import { it } from "node:test";
import { CROWDSEC_DEFAULTS } from "../lib/crowdsec/settings.js";
import { renderStartupBlock, startupWarnings } from "../lib/crowdsec/startup-block.js";

const LINE = "-------------------------------------";
const on = (extra = {}) => ({
	...CROWDSEC_DEFAULTS,
	enabled: true,
	appsec_url: "http://127.0.0.1:7422",
	api_key: "secret-key-123",
	captcha_secret_key: "captcha-secret-456",
	captcha_provider: "turnstile",
	...extra,
});
const ok = [
	{ name: "lapi", result: "ok", message: "" },
	{ name: "appsec", result: "ok", message: "" },
];

it("prints one line while the bouncer is off", () => {
	assert.equal(renderStartupBlock({ values: CROWDSEC_DEFAULTS }), "CrowdSec: off (Settings, CrowdSec)");
});

it("prints the block of the spec, never a secret", () => {
	const values = on();
	const text = renderStartupBlock({
		values,
		lockedBy: { api_key: "CROWDSEC_API_KEY" },
		checks: ok,
		warnings: startupWarnings({ values, checks: ok }),
	});
	assert.equal(
		text,
		[
			LINE,
			"CrowdSec: on, live mode",
			"LAPI:     http://127.0.0.1:8080, reachable, key accepted",
			"AppSec:   http://127.0.0.1:7422, deny when unreachable",
			"Captcha:  turnstile",
			"Admin UI: checked by CrowdSec",
			"Locked:   CROWDSEC_API_KEY",
			"Warning:  AppSec deny also blocks the admin UI while AppSec is down (Settings, CrowdSec: Leave the admin UI out of CrowdSec)",
			LINE,
		].join("\n"),
	);
	assert.equal(text.includes("secret-key-123"), false);
	assert.equal(text.includes("captcha-secret-456"), false);
});

it("never prints a secret, whatever the checks say", () => {
	const values = on({ appsec_failure_action: "passthrough" });
	const checks = [
		{ name: "lapi", result: "key_refused", message: "HTTP 403" },
		{ name: "appsec", result: "refused", message: "HTTP 401" },
	];
	const warnings = startupWarnings({ values, checks, nginxError: "boom", missingFiles: ["/x"], localOverride: true });
	const text = renderStartupBlock({ values, lockedBy: { api_key: "CROWDSEC_API_KEY" }, checks, warnings });
	assert.equal(text.includes("secret-key-123"), false);
	assert.equal(text.includes("captcha-secret-456"), false);
});

it("shows failed checks and only the warnings that apply", () => {
	const values = on({ admin_ui_excluded: true, mode: "stream", captcha_provider: "" });
	const checks = [
		{ name: "lapi", result: "key_refused", message: "HTTP 403" },
		{ name: "appsec", result: "unreachable", message: "ECONNREFUSED" },
	];
	const warnings = startupWarnings({
		values,
		checks,
		missingFiles: ["/data/crowdsec/client.key"],
		missingPages: ["/data/crowdsec/ban.html"],
		localOverride: true,
	});
	assert.deepEqual(warnings, [
		"the LAPI check failed, decisions are not applied until it passes",
		"AppSec cannot be reached: requests are blocked while AppSec is down",
		"/data/crowdsec/client.key is not set, does not exist, cannot be read or is not valid PEM",
		"/data/crowdsec/ban.html does not exist or cannot be read, the bouncer runs without this page",
		"/data/crowdsec/crowdsec.conf.local overrides these settings, remove it",
	]);
	const text = renderStartupBlock({ values, checks, warnings });
	assert.match(text, /^CrowdSec: on, stream mode$/mu);
	assert.match(text, /^LAPI: {5}http:\/\/127\.0\.0\.1:8080, reachable, key refused$/mu);
	assert.match(text, /^AppSec: {3}http:\/\/127\.0\.0\.1:7422, not reachable \(ECONNREFUSED\)$/mu);
	assert.match(text, /^Captcha: {2}none$/mu);
	assert.match(text, /^Admin UI: left out of CrowdSec$/mu);
	assert.doesNotMatch(text, /^Locked:/mu);
});

it("says AppSec is off and names a config nginx refused", () => {
	const values = on({ appsec_url: "", appsec_failure_action: "passthrough" });
	const warnings = startupWarnings({ values, checks: ok.slice(0, 1), nginxError: "nginx: [emerg] lua error\nmore" });
	assert.deepEqual(warnings, [
		"the bouncer config did not pass nginx -t, the bouncer is off: nginx: [emerg] lua error",
	]);
	assert.match(renderStartupBlock({ values, warnings }), /^AppSec: {3}off$/mu);
	assert.deepEqual(
		startupWarnings({
			values: on({ appsec_failure_action: "passthrough" }),
			checks: [ok[0], { name: "appsec", result: "unreachable", message: "x" }],
		}),
		["AppSec cannot be reached: requests pass unchecked while AppSec is down"],
	);
});

it("shows a missing key as a clear line, not as refused", () => {
	const values = on({ api_key: "" });
	const checks = [
		{ name: "lapi", result: "no_key", message: "No API key is set" },
		{ name: "appsec", result: "no_key", message: "No API key is set" },
	];
	const text = renderStartupBlock({ values, checks });
	assert.match(text, /^LAPI: {5}http:\/\/127\.0\.0\.1:8080, no API key set$/mu);
	assert.match(text, /^AppSec: {3}http:\/\/127\.0\.0\.1:7422, no API key set$/mu);
	assert.doesNotMatch(text, /refused/u);
});

it("keeps the .local warning while the bouncer is off", () => {
	assert.deepEqual(startupWarnings({ values: CROWDSEC_DEFAULTS, localOverride: true }), [
		"/data/crowdsec/crowdsec.conf.local overrides these settings, remove it",
	]);
});
