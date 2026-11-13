import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import vm from "node:vm";
import { buildAll, LANGUAGES, loadTexts, OUT_DIR, scriptHash } from "../landing-pages/build.js";
import { PAGES } from "../landing-pages/pages.js";
import { fillPlaceholders, ssiProblems } from "../lib/landing-pages/placeholders.js";

const built = buildAll();
const texts = loadTexts();
const pageOf = (id) => built[PAGES.findIndex((page) => page.id === id)].html;
const SCRIPT = /<script>([\s\S]*?)<\/script>/u;
const TEXTS = /<script type="application\/json" id="npmpro-texts">([^<]*)<\/script>/u;
const OUTSIDE = /(?:src|href)="(?!data:)[^"]*"/gu;
const CAPTCHA_JS = 'src="{{captcha_frontend_js}}"';

// runs the page's inline script against a minimal document: the data-t elements, the time chip, the root
const runScript = (html, languages) => {
	const elements = [...html.matchAll(/data-t="([a-z]+)"/gu)].map(([, key]) => ({
		dataset: { t: key },
		textContent: "",
	}));
	const time = { textContent: "" };
	const root = { lang: "en" };
	const document = {
		documentElement: root,
		getElementById: (id) => (id === "npmpro-texts" ? { textContent: html.match(TEXTS)[1] } : null),
		querySelectorAll: (selector) => (selector === "[data-t]" ? elements : []),
		querySelector: (selector) =>
			selector === "[data-npmpro-time]" && html.includes("data-npmpro-time") ? time : null,
	};
	// the context is the script's global object, so window.x and globalThis.x land in the same place
	const context = { document, navigator: { languages, language: languages[0] }, setTimeout };
	context.window = context;
	vm.runInNewContext(html.match(SCRIPT)[1], context);
	return { root, elements, time, window: context };
};

it("the committed pages are the build's output", () => {
	for (const { file, html } of built) {
		assert.equal(
			readFileSync(path.join(OUT_DIR, file), "utf8"),
			html,
			`${file} is stale: run node landing-pages/build.js`,
		);
	}
});

it("every language has every text of every page, and no em dash", () => {
	for (const code of LANGUAGES) {
		for (const page of PAGES) {
			for (const key of ["title", "text", "witty"]) {
				const text = texts[code][`${page.id}.${key}`];
				assert.ok(typeof text === "string" && text.trim() !== "", `${code}: ${page.id}.${key}`);
				assert.ok(!text.includes("—"), `${code}: ${page.id}.${key} has an em dash`);
			}
		}
		for (const key of ["footer.npmpro", "footer.crowdsec"]) assert.ok(texts[code][key], `${code}: ${key}`);
		assert.deepEqual(
			Object.keys(texts[code]).sort(),
			Object.keys(texts.en).sort(),
			`${code} has other keys than en`,
		);
	}
});

it("renders every page in every language, English for an unknown one", () => {
	for (const page of PAGES) {
		const html = pageOf(page.id);
		for (const code of LANGUAGES) {
			const { root, elements } = runScript(html, [code === "zh" ? "zh-CN" : code]);
			assert.equal(root.lang, code);
			for (const element of elements) {
				const key =
					element.dataset.t === "footer" ? `footer.${page.footer}` : `${page.id}.${element.dataset.t}`;
				assert.equal(element.textContent, texts[code][key], `${page.file} ${code} ${element.dataset.t}`);
			}
		}
		assert.equal(runScript(html, ["xx-YY", "fr"]).root.lang, "fr");
		assert.equal(runScript(html, ["xx"]).root.lang, "en");
	}
});

it("one inline script in all eight pages, its hash, and the captcha callback", () => {
	const scripts = new Set(built.map(({ html }) => html.match(SCRIPT)[1]));
	assert.equal(scripts.size, 1);
	const [script] = scripts;
	assert.equal(scriptHash(), `sha256-${createHash("sha256").update(script).digest("base64")}`);
	assert.equal(typeof runScript(pageOf("captcha"), ["en"]).window.captchaCallback, "function");
});

it("no outside requests, except the captcha provider's script", () => {
	for (const { file, html } of built) {
		const links = [...html.matchAll(OUTSIDE)].map(([link]) => link);
		assert.deepEqual(links, file === "captcha.html" ? [CAPTCHA_JS] : [], file);
	}
});

it("SSI values: allowed commands only, filled by the preview fill, chips on four pages", () => {
	for (const page of PAGES) {
		const html = pageOf(page.id);
		assert.deepEqual(ssiProblems(html), [], page.file);
		const filled = fillPlaceholders(html, { remote_addr: "203.0.113.7", status: 418, host: "example.com" });
		assert.ok(!filled.includes("<!--#"), page.file);
		assert.equal(filled.includes("IP 203.0.113.7"), page.chips, page.file);
		assert.equal(filled.includes('<div class="code">418</div>'), page.status !== null, page.file);
		if (page.chips) assert.equal(runScript(html, ["en"]).time.textContent.endsWith(" UTC"), true);
	}
});

it("the captcha page keeps the bouncer's placeholders, form and callback", () => {
	const html = pageOf("captcha");
	for (const part of [
		'class="{{captcha_frontend_key}}"',
		'data-sitekey="{{captcha_site_key}}"',
		'id="captcha-form"',
		'data-callback="captchaCallback"',
		CAPTCHA_JS,
	]) {
		assert.ok(html.includes(part), part);
	}
});

it("moves only without prefers-reduced-motion, and the logo in both schemes", () => {
	for (const { file, html } of built) {
		const outside = html.replace(
			/@media \(prefers-reduced-motion:no-preference\)\{[^}]*\{[^}]*\}[^}]*\{[^}]*\}\}/u,
			"",
		);
		assert.ok(!/animation:/u.test(outside), `${file} animates outside the reduced-motion query`);
		assert.ok(html.includes('class="logo logo-light" src="data:image/svg+xml;base64,'), file);
		assert.ok(html.includes('class="logo logo-dark" src="data:image/svg+xml;base64,'), file);
		assert.ok(html.includes("Served by NPMpro") || html.includes("Protected by CrowdSec"), file);
	}
});
