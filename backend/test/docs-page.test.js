import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import vm from "node:vm";
import { docsPage, FONT_FILES } from "../lib/docs-page.js";

const STYLE_BLOCK = /<style>(?<css>[\s\S]*?)<\/style>/gu;
const STYLE_ATTR = /style="(?<attr>[^"]*)"/gu;
const TOKEN = /--(?<name>[\w-]+):\s*(?<value>[^;]+);/gu;
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>/u;
const UNSAFE_INLINE = /unsafe-inline/u;
const FONT_SRC = /font-src 'self';/u;
const CSS_LINK = /<link rel="stylesheet" href="\.\/npmpro\/docs\.css">/u;
const THEME_SCRIPT = /<script src="\.\/npmpro\/theme\.js"><\/script>/u;
const HEADER = /<header class="npmpro-docs-header">[\s\S]*logo-horizontal-light\.svg[\s\S]*logo-horizontal-dark\.svg/u;
const TITLE = /<title>NPMpro API<\/title>/u;
const FAVICON = /href="\/images\/favicon\/favicon\.svg"/u;

const THEME = new URL("../docs-theme/theme.js", import.meta.url);
const CSS = readFileSync(new URL("../docs-theme/docs.css", import.meta.url), "utf8");
const CONF = readFileSync(new URL("../../rootfs/usr/local/nginx/conf/conf.d/npmpro.conf", import.meta.url), "utf8");
const GLOBALS = readFileSync(new URL("../../frontend/src/styles/globals.css", import.meta.url), "utf8");
const page = docsPage({ openapi: "3.1.0", info: { title: "NPMpro API", version: "1.0.0" }, paths: {} });
const docsCsp = CONF.split("\n")
	.slice(CONF.split("\n").findIndex((line) => line.includes("location ~ ^/api/docs(/|$)")))
	.find((line) => line.includes("Content-Security-Policy"));
const hash = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

it("every inline style of the page is allowed by the CSP of npmpro.conf, and there is no inline script", () => {
	for (const { groups } of page.matchAll(STYLE_BLOCK)) assert.ok(docsCsp.includes(hash(groups.css)), groups.css);
	for (const { groups } of page.matchAll(STYLE_ATTR)) assert.ok(docsCsp.includes(hash(groups.attr)), groups.attr);
	assert.doesNotMatch(page, INLINE_SCRIPT);
	assert.doesNotMatch(docsCsp, UNSAFE_INLINE);
	assert.match(docsCsp, FONT_SRC);
});

it("loads the theme in the head, before the Swagger UI scripts, and shows the NPMpro header", () => {
	const head = page.slice(0, page.indexOf("</head>"));
	assert.match(head, CSS_LINK);
	assert.match(head, THEME_SCRIPT);
	assert.match(page, HEADER);
	assert.match(page, TITLE);
	assert.match(page, FAVICON);
});

it("serves only the four Latin font files, from the fontsource packages", () => {
	assert.deepEqual(
		[...FONT_FILES.keys()].sort((a, b) => a.localeCompare(b)),
		["geist-latin-ext.woff2", "geist-latin.woff2", "geist-mono-latin-ext.woff2", "geist-mono-latin.woff2"],
	);
	for (const file of FONT_FILES.values()) assert.ok(readFileSync(file).length > 1000, file);
});

const block = (css, selector) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
const tokens = (text) =>
	Object.fromEntries([...text.matchAll(TOKEN)].map(({ groups }) => [groups.name, groups.value.trim()]));
const SHARED = [
	"background",
	"foreground",
	"card",
	"muted",
	"muted-foreground",
	"border",
	"primary",
	"primary-foreground",
	"ring",
	"destructive",
];

it("uses the app's colour tokens of globals.css in light and dark", () => {
	const pick = (all, names) => Object.fromEntries(names.map((name) => [name, all[name]]));
	const light = [...SHARED, "radius", "brand-gradient"];
	assert.deepEqual(pick(tokens(block(CSS, ":root")), light), pick(tokens(block(GLOBALS, ":root")), light));
	assert.deepEqual(pick(tokens(block(CSS, "html.dark-mode")), SHARED), pick(tokens(block(GLOBALS, ".dark")), SHARED));
});

const runTheme = ({ stored = {}, systemDark = false, storageThrows = false }) => {
	const classes = new Set();
	const listeners = {};
	const context = {
		localStorage: {
			getItem: (key) => {
				if (storageThrows) throw new Error("blocked");
				return stored[key] ?? null;
			},
		},
		document: {
			documentElement: { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } },
		},
		matchMedia: () => ({
			matches: systemDark,
			addEventListener: (_, fn) => {
				listeners.media = fn;
			},
		}),
		addEventListener: (type, fn) => {
			listeners[type] = fn;
		},
	};
	vm.runInNewContext(readFileSync(THEME, "utf8"), context);
	return { dark: () => classes.has("dark-mode"), listeners, stored };
};

it("theme.js: follows the app's stored choice once the one-time reset ran, the system theme otherwise", () => {
	const done = { "npmpro-theme-system": "1" };
	assert.equal(runTheme({ systemDark: true }).dark(), true);
	assert.equal(
		runTheme({ stored: { "tabler-theme": "dark" } }).dark(),
		false,
		"a choice before the reset is ignored",
	);
	assert.equal(runTheme({ stored: { ...done, "tabler-theme": "dark" } }).dark(), true);
	assert.equal(runTheme({ stored: { ...done, "tabler-theme": "light" }, systemDark: true }).dark(), false);
	assert.equal(runTheme({ stored: { ...done, "tabler-theme": "odd" }, systemDark: true }).dark(), true);
	assert.equal(runTheme({ storageThrows: true, systemDark: true }).dark(), true, "blocked storage");
});

it("theme.js: follows a change made in another tab", () => {
	const run = runTheme({ stored: { "npmpro-theme-system": "1", "tabler-theme": "light" } });
	assert.equal(run.dark(), false);
	run.stored["tabler-theme"] = "dark";
	run.listeners.storage({ key: "tabler-theme" });
	assert.equal(run.dark(), true);
});
