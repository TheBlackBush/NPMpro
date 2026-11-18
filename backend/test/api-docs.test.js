import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// The API reference page (/docs): its NPMpro theme files, the fonts and the redirect of /docs.

const HTML = /^text\/html/u;
const CSS = /^text\/css/u;
const JAVASCRIPT = /javascript/u;
const DOCS_SLASH = /\/docs\/$/u;

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api.stop());

it("serves the page with the NPMpro theme and header", async () => {
	const done = await admin.get("/docs/");
	assert.equal(done.status, 200);
	assert.match(done.headers.get("content-type"), HTML);
	for (const part of ["./npmpro/docs.css", "./npmpro/theme.js", "npmpro-docs-header"])
		assert.ok(done.text.includes(part), part);
});

it("serves the theme files and the fonts, and refuses anything else", async () => {
	const css = await admin.get("/docs/npmpro/docs.css");
	assert.equal(css.status, 200);
	assert.match(css.headers.get("content-type"), CSS);
	const script = await admin.get("/docs/npmpro/theme.js");
	assert.equal(script.status, 200);
	assert.match(script.headers.get("content-type"), JAVASCRIPT);
	const font = await admin.get("/docs/npmpro/fonts/geist-latin.woff2");
	assert.equal(font.status, 200);
	assert.equal(font.headers.get("content-type"), "font/woff2");
	assert.equal((await admin.get("/docs/npmpro/fonts/nope.woff2")).status, 404);
	assert.notEqual((await admin.get("/docs/npmpro/../package.json")).status, 200);
	assert.notEqual((await admin.get("/docs/npmpro/%2e%2e/package.json")).status, 200);
});

it("needs a session for every part of it", async () => {
	for (const url of [
		"/docs/",
		"/docs/npmpro/docs.css",
		"/docs/npmpro/theme.js",
		"/docs/npmpro/fonts/geist-latin.woff2",
	]) {
		assert.equal((await api.client().get(url)).status, 401, url);
	}
});

it("redirects /docs to /docs/", async () => {
	const done = await admin.get("/docs", { redirect: "manual" });
	assert.ok(done.status >= 300 && done.status < 400, done.status);
	assert.match(done.headers.get("location"), DOCS_SLASH);
});

it("does not write into the cached schema", async () => {
	const { getCompiledSchema } = await import("../schema/index.js");
	const original = (await getCompiledSchema()).servers[0].url;
	await admin.get("/docs/");
	await admin.get("/docs/");
	assert.equal((await getCompiledSchema()).servers[0].url, original);
});
