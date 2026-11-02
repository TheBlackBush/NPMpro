import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const css = (name) => readFileSync(new URL(`../styles/${name}`, import.meta.url), "utf8");

it("the font stack is Geist, then Inter (Greek), then the system font", () => {
	assert.match(css("globals.css"), /--font-sans:\s*"Geist Variable",\s*"Inter Variable",\s*ui-sans-serif/u);
});

it("only Inter's Greek faces are loaded", () => {
	const fonts = css("fonts.css");
	assert.doesNotMatch(fonts, /@fontsource-variable\/inter\/wght\.css/u);
	assert.match(fonts, /inter-greek-wght-normal\.woff2/u);
});

it("the page CSP allows self-hosted fonts", () => {
	const conf = readFileSync(
		new URL("../../../rootfs/usr/local/nginx/conf/conf.d/npmpro.conf", import.meta.url),
		"utf8",
	);
	const page = conf.split("location = /index.html")[1].split("}")[0];
	assert.match(page, /font-src 'self';/u);
});
