import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseConfLines } from "../lib/crowdsec/config.js";
import {
	applyCrowdsecUpdate,
	CROWDSEC_DEFAULTS,
	CROWDSEC_FIELDS,
	changedCrowdsecKeys,
	HEADER,
	mergeCrowdsecConfig,
	renderCrowdsecConf,
	requiredFiles,
	validateCrowdsec,
	valuesFromFile,
} from "../lib/crowdsec/settings.js";

const EXAMPLE = readFileSync(new URL("../../rootfs/etc/crowdsec.conf.example", import.meta.url), "utf8");
const exists = () => true;
const on = (extra = {}) => ({ ...CROWDSEC_DEFAULTS, enabled: true, api_key: "k", ...extra });

it("covers every key of crowdsec.conf.example, in its order, with its defaults", () => {
	const example = parseConfLines(EXAMPLE);
	assert.deepEqual(
		CROWDSEC_FIELDS.map((field) => field.file),
		Object.keys(example),
	);
	// the example's TLS paths are placeholders, so the defaults are empty; the AppSec URL is the one difference: new
	// installs start with AppSec off (user decision 2026-11-12), an imported file keeps its URL
	const { values, dropped, unknown } = valuesFromFile(example);
	assert.deepEqual(dropped, []);
	assert.deepEqual(unknown, []);
	assert.deepEqual(values, { ...CROWDSEC_DEFAULTS, appsec_url: "http://127.0.0.1:7422" });
	assert.equal(CROWDSEC_DEFAULTS.appsec_url, "");
});

it("writes the file from the values: header, every key in order, booleans, empty nulls", () => {
	const text = renderCrowdsecConf(CROWDSEC_DEFAULTS);
	const lines = text.split("\n");
	assert.equal(lines[0], HEADER);
	assert.equal(lines.at(-1), "");
	assert.deepEqual(
		lines.slice(1, -1).map((line) => line.split("=")[0]),
		CROWDSEC_FIELDS.map((field) => field.file),
	);
	assert.match(text, /^ENABLED=false$/mu);
	assert.match(text, /^RET_CODE=$/mu);
	assert.match(text, /^APPSEC_CONNECT_TIMEOUT=$/mu);
	assert.match(text, /^BAN_TEMPLATE_PATH=\/data\/crowdsec\/ban\.html$/mu);
	// the written file reads back to the same values
	assert.deepEqual(valuesFromFile(parseConfLines(text)).values, CROWDSEC_DEFAULTS);
});

it("writes the ban response as the bouncer reads it", () => {
	const page = renderCrowdsecConf(on({ ret_code: 404, redirect_location: "/left-over" }));
	assert.match(page, /^REDIRECT_LOCATION=$/mu);
	assert.match(page, /^RET_CODE=404$/mu);
	const redirect = renderCrowdsecConf(
		on({ ban_response: "redirect", redirect_location: "https://example.com/b", ret_code: 403 }),
	);
	assert.match(redirect, /^REDIRECT_LOCATION=https:\/\/example\.com\/b$/mu);
	assert.match(redirect, /^RET_CODE=$/mu);
	const status = renderCrowdsecConf(on({ ban_response: "status", ret_code: 444 }));
	assert.match(status, /^BAN_TEMPLATE_PATH=$/mu);
	assert.match(status, /^RET_CODE=444$/mu);
});

it("refuses to write a value with a line break", () => {
	assert.throws(() => renderCrowdsecConf(on({ api_key: "a\nENABLED=false" })), /API_KEY/u);
});

it("imports a hand-edited file: invalid values default, unknown keys listed, the ban response derived", () => {
	const { values, unknown, dropped } = valuesFromFile({
		ENABLED: "TRUE",
		MODE: "Stream",
		CACHE_EXPIRATION: "abc",
		RET_CODE: "418",
		BAN_TEMPLATE_PATH: "/var/lib/crowdsec/lua/templates/ban.html",
		REDIRECT_LOCATION: "https://example.com/banned",
		TLS_CLIENT_CERT: "/path/to/client.crt",
		APPSEC_PROCESS_TIMEOUT: "",
		CACHE_SIZE: "1000",
		STREAM_REQUEST_TIMEOUT: "15000",
	});
	assert.equal(values.enabled, true);
	assert.equal(values.mode, "stream");
	assert.equal(values.cache_expiration, 1);
	assert.equal(values.ret_code, null);
	assert.equal(values.ban_template_path, "/data/crowdsec/ban.html");
	assert.equal(values.ban_response, "redirect");
	assert.equal(values.tls_client_cert, "");
	assert.equal(values.appsec_process_timeout, null);
	assert.deepEqual(dropped.sort(), ["BAN_TEMPLATE_PATH", "CACHE_EXPIRATION", "RET_CODE"]);
	assert.deepEqual(unknown.sort(), ["CACHE_SIZE", "STREAM_REQUEST_TIMEOUT"]);
	assert.equal(valuesFromFile({ BAN_TEMPLATE_PATH: "", RET_CODE: "403" }).values.ban_response, "status");
	assert.equal(
		valuesFromFile({ BAN_TEMPLATE_PATH: "", RET_CODE: "403" }).values.ban_template_path,
		"/data/crowdsec/ban.html",
	);
	assert.equal(valuesFromFile({}).values.ban_response, "page");
});

it("lets a set env var win and lock its field, ignores invalid ones", () => {
	const merged = mergeCrowdsecConfig(
		{ enabled: false, api_url: "http://stored:8080", api_key: "stored", appsec_url: "", mode: "bogus" },
		{
			CROWDSEC_ENABLED: " TRUE ",
			CROWDSEC_LAPI_URL: "http://env:8080",
			CROWDSEC_API_KEY: "has#hash",
			CROWDSEC_APPSEC_URL: "",
		},
	);
	assert.equal(merged.values.enabled, true);
	assert.equal(merged.values.api_url, "http://env:8080");
	assert.equal(merged.values.api_key, "stored");
	assert.equal(merged.values.appsec_url, "");
	assert.equal(merged.values.mode, "live");
	assert.deepEqual(merged.locked, ["enabled", "api_url"]);
	assert.deepEqual(merged.invalid, ["CROWDSEC_API_KEY"]);
	assert.deepEqual(mergeCrowdsecConfig(undefined, {}).values, CROWDSEC_DEFAULTS);
});

it("validates the cross-field rules", () => {
	assert.deepEqual(validateCrowdsec(CROWDSEC_DEFAULTS, { exists }), []);
	assert.deepEqual(validateCrowdsec(on(), { exists }), []);
	assert.equal(validateCrowdsec(on({ api_url: "" }), { exists }).length, 1);
	assert.equal(validateCrowdsec(on({ api_key: "" }), { exists }).length, 1);
	assert.equal(
		validateCrowdsec(
			on({
				api_key: "",
				use_tls_auth: true,
				tls_client_cert: "/data/crowdsec/c.crt",
				tls_client_key: "/data/crowdsec/c.key",
			}),
			{ exists },
		).length,
		1, // http LAPI URL with TLS auth
	);
	assert.deepEqual(
		validateCrowdsec(
			on({
				api_url: "https://lapi:8080",
				use_tls_auth: true,
				tls_client_cert: "/data/crowdsec/c.crt",
				tls_client_key: "/data/crowdsec/c.key",
			}),
			{ exists: (file) => !file.endsWith(".key") },
		),
		["The TLS client key file /data/crowdsec/c.key does not exist."],
	);
	assert.equal(validateCrowdsec(on({ ban_response: "redirect" }), { exists }).length, 1);
	assert.equal(validateCrowdsec(on({ ban_response: "status" }), { exists }).length, 1);
	assert.equal(validateCrowdsec({ ...CROWDSEC_DEFAULTS, captcha_provider: "turnstile" }, { exists }).length, 2);
	// files are only checked while the bouncer is on
	assert.deepEqual(validateCrowdsec(CROWDSEC_DEFAULTS, { exists: () => false }), []);
	assert.equal(validateCrowdsec(on(), { exists: () => false }).length, 1);
});

it("lists the files the bouncer reads", () => {
	assert.deepEqual(requiredFiles(on()), ["/data/crowdsec/ban.html"]);
	assert.deepEqual(
		requiredFiles(
			on({
				ban_response: "status",
				ret_code: 403,
				captcha_provider: "hcaptcha",
				use_tls_auth: true,
				tls_client_cert: "/data/crowdsec/a",
				tls_client_key: "/data/crowdsec/b",
			}),
		),
		["/data/crowdsec/a", "/data/crowdsec/b", "/data/crowdsec/captcha.html"],
	);
});

it("applies a PUT body: locked fields and empty secrets kept, null clears, the ban response clears the others", () => {
	const encrypt = (value) => `sealed:${value}`;
	const stored = {
		api_key: "sealed:old",
		captcha_secret_key: "sealed:cs",
		redirect_location: "https://x.example/",
		ret_code: 403,
		import_pending: true,
	};
	const next = applyCrowdsecUpdate(
		stored,
		{
			api_url: "http://new:8080",
			enabled: true,
			api_key: "",
			captcha_secret_key: null,
			ban_response: "page",
			mode: "stream",
		},
		["enabled"],
		encrypt,
	);
	assert.equal(next.api_url, "http://new:8080");
	assert.equal(Object.hasOwn(next, "enabled"), false);
	assert.equal(next.api_key, "sealed:old");
	assert.equal(Object.hasOwn(next, "captcha_secret_key"), false);
	assert.equal(next.redirect_location, "");
	assert.equal(next.ret_code, 403);
	assert.equal(next.mode, "stream");
	assert.equal(next.import_pending, false);
	assert.equal(applyCrowdsecUpdate(stored, { api_key: " new " }, [], encrypt).api_key, "sealed:new");
	assert.equal(applyCrowdsecUpdate(stored, { api_key: "new" }, ["api_key"], encrypt).api_key, "sealed:old");
	assert.equal(applyCrowdsecUpdate(stored, { ban_response: "redirect" }, [], encrypt).ret_code, null);
});

it("names the changed settings, secrets by name only", () => {
	const before = { ...CROWDSEC_DEFAULTS, api_key: "old" };
	const after = { ...before, mode: "stream", api_key: "new" };
	assert.deepEqual(changedCrowdsecKeys(before, after, { mode: "stream", api_key: "new" }), ["mode", "api_key"]);
	assert.deepEqual(changedCrowdsecKeys(before, before, { api_key: "" }), []);
	assert.deepEqual(changedCrowdsecKeys(before, { ...before, api_key: "" }, { api_key: null }), ["api_key"]);
});
