import assert from "node:assert/strict";
import { it } from "node:test";
import {
	choiceLabelId,
	landingPayload,
	landingValidate,
	landingValues,
	MAX_PAGE_BYTES,
	PAGE_TYPES,
	pageHtmlError,
	placeDefaults,
	placeErrors,
	previewPath,
	readPageFile,
	ssiAllowed,
} from "./LandingPageForms.js";

const rules = { message: (id, data) => (data ? `${id} ${JSON.stringify(data)}` : id) };
const DATA = {
	defaultSite: { value: "congratulations", meta: {} },
	pages: Object.fromEntries(PAGE_TYPES.map(({ key }) => [key, { choice: "npmpro", html: "" }])),
};

it("knows the seven global types in the order Settings shows them", () => {
	assert.deepEqual(
		PAGE_TYPES.map(({ api }) => api),
		["not_found", "upstream_error", "denied", "maintenance", "certificate", "ban", "captcha"],
	);
});

it("checks a page like the backend: size in bytes, UTF-8, the allowed SSI", () => {
	assert.equal(pageHtmlError("<p>ok</p>"), null);
	assert.equal(pageHtmlError("  "), "error.required");
	assert.equal(pageHtmlError("a".repeat(MAX_PAGE_BYTES + 1)), "landing-pages.error.too-large");
	assert.equal(pageHtmlError("é".repeat(MAX_PAGE_BYTES / 2 + 1)), "landing-pages.error.too-large");
	assert.equal(pageHtmlError("a\ud800"), "landing-pages.error.not-utf8");
	assert.equal(pageHtmlError("a\u0000b"), "landing-pages.error.not-utf8");
	assert.equal(pageHtmlError('<!--# include virtual="/" -->'), "landing-pages.error.ssi");
	assert.ok(
		ssiAllowed('<!--# config timefmt="%Y" --><!--# echo var="date_gmt" --> <!--# echo var="host" default="" -->'),
	);
	assert.ok(!ssiAllowed('<!--# echo var="remote_addr" encoding="none" -->'));
	assert.ok(!ssiAllowed('<!--# echo var="remote_addr" other="x" -->'));
	assert.ok(!ssiAllowed('<!--# echo var="server_name" -->'));
	assert.ok(!ssiAllowed('<!--# config timefmt="%j" -->'));
	assert.ok(!ssiAllowed('<!--# config other="x" -->'));
	assert.ok(!ssiAllowed("<!--#"));
});

it("reads an uploaded file: UTF-8 only, at most 1 MiB", () => {
	assert.deepEqual(readPageFile(new TextEncoder().encode("<p>é</p>")), { html: "<p>é</p>" });
	assert.deepEqual(readPageFile(new Uint8Array([0x3c, 0xff, 0x3e])), { error: "landing-pages.error.not-utf8" });
	assert.deepEqual(readPageFile(new Uint8Array(MAX_PAGE_BYTES + 1)), { error: "landing-pages.error.too-large" });
});

it("place defaults and errors: a custom choice needs a valid page", () => {
	assert.deepEqual(placeDefaults("proxyHost", {}), {
		npmproPageNotFound: "upstream",
		npmproPageNotFoundHtml: "",
		npmproPageUpstream: "global",
		npmproPageUpstreamHtml: "",
		npmproPageMaintenance: "global",
		npmproPageMaintenanceHtml: "",
	});
	assert.deepEqual(placeDefaults("accessList", { npmproDeniedPage: "plain", npmproDeniedPageHtml: "x" }), {
		npmproDeniedPage: "plain",
		npmproDeniedPageHtml: "x",
	});
	assert.deepEqual(placeErrors(rules, "deadHost", { npmproPage: "custom", npmproPageHtml: "" }), {
		npmproPageHtml: "error.required",
	});
	assert.deepEqual(placeErrors(rules, "deadHost", { npmproPage: "global", npmproPageHtml: "" }), {});
	assert.equal(choiceLabelId({ api: "not_found" }, "upstream"), "landing-pages.choice.upstream-site");
	assert.equal(choiceLabelId({ api: "upstream_error" }, "upstream"), "landing-pages.choice.upstream-error");
	assert.equal(choiceLabelId({ api: "denied" }, "npmpro"), "landing-pages.choice.npmpro.denied");
	assert.equal(choiceLabelId({ api: "captcha" }, "custom"), "landing-pages.choice.custom");
	assert.equal(choiceLabelId({ api: "denied" }, "plain"), "landing-pages.choice.plain");
});

it("preview paths", () => {
	assert.equal(previewPath({ source: "global", type: "ban" }), "/api/settings/landing-pages/preview/global/ban");
	assert.equal(
		previewPath({ source: "npmpro", type: "default_site" }),
		"/api/settings/landing-pages/preview/npmpro/default_site",
	);
	assert.equal(
		previewPath({ source: "proxy-host", id: 4, type: "maintenance" }),
		"/api/settings/landing-pages/preview/proxy-host/4/maintenance",
	);
	assert.equal(previewPath({ source: "dead-host", id: 2 }), "/api/settings/landing-pages/preview/dead-host/2");
	assert.equal(previewPath({ source: "access-list", id: 9 }), "/api/settings/landing-pages/preview/access-list/9");
});

it("Settings: values, validation, and a payload of what changed only", () => {
	const values = landingValues(DATA);
	assert.equal(values.defaultSite.value, "congratulations");
	assert.deepEqual(values.pages.ban, { choice: "npmpro", html: "" });
	assert.deepEqual(landingPayload(values, values), {});
	const changed = structuredClone(values);
	changed.pages.ban = { choice: "custom", html: "<p>b</p>" };
	assert.deepEqual(landingPayload(changed, values), { pages: { ban: { choice: "custom", html: "<p>b</p>" } } });
	changed.defaultSite.value = "404";
	assert.deepEqual(landingPayload(changed, values).defaultSite, { value: "404", meta: {} });
	const bad = structuredClone(values);
	bad.pages.captcha = { choice: "custom", html: "" };
	bad.defaultSite = { value: "redirect", redirect: "", html: "", status: "" };
	const errors = landingValidate(rules)(bad);
	assert.equal(errors.pages.captcha.html, "error.required");
	assert.equal(errors.defaultSite.redirect, "error.required");
	assert.deepEqual(landingValidate(rules)(values), {});
	const stray = structuredClone(values);
	stray.pages.ban = { choice: "custom", html: "<!--# include virtual='x' -->" };
	assert.equal(landingValidate(rules)(stray).pages.ban.html, "landing-pages.error.ssi");
	// a failing paste, then back to the NPMpro page: Save goes through and sends no html
	stray.pages.ban = { choice: "npmpro", html: "<!--# include virtual='x' -->" };
	assert.deepEqual(landingValidate(rules)(stray), {});
	assert.deepEqual(landingPayload(stray, values), {});
	const saved = structuredClone(values);
	saved.pages.ban = { choice: "custom", html: "<p>kept</p>" };
	stray.pages.ban = { choice: "npmpro", html: "<p>kept</p>edited" };
	assert.deepEqual(landingPayload(stray, saved), { pages: { ban: { choice: "npmpro" } } });
	// a second save diffs against the first
	const second = structuredClone(saved);
	second.pages.ban.html = "<p>again</p>";
	assert.deepEqual(landingPayload(second, saved), { pages: { ban: { choice: "custom", html: "<p>again</p>" } } });
	assert.deepEqual(landingValues({ defaultSite: DATA.defaultSite }).pages.ban, { choice: "npmpro", html: "" });
});
