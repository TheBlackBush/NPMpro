import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { it } from "node:test";

// the app's font: Geist, Inter for Greek only, then the system font (styles/fonts.css, styles/brand.css)
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const FACE = /@font-face\s*\{(?<body>[^}]*)\}/gu;
const IMPORT = /@import\s+"(?<path>[^"]+)"/gu;
const URL_OF = /url\("(?<url>[^"]+)"\)/u;
const STACK = /--tblr-font-sans-serif:\s*(?<stack>[^;]+);/u;
const TAILWIND_SANS = /--font-sans:\s*var\(--tblr-font-sans-serif\);/u;
const STYLE_IMPORT = /^import "src\/styles\/(?<name>[^"]+)";$/gmu;
const PAGE_CSP = /location = \/index\.html \{[^}]*Content-Security-Policy: (?<csp>[^"]+)"/u;
const FONT_SRC = /(?:^|; )font-src 'self';/u;
const property = (body, name) => new RegExp(`${name}:\\s*(?<value>[^;]+);`, "u").exec(body)?.groups.value.trim();
const packageFile = (url) => new URL(`../../node_modules/${url}`, import.meta.url);

it("loads Geist whole and only the Greek faces of Inter, with Inter's own unicode ranges", () => {
	const css = read("../styles/fonts.css");
	const imports = [...css.matchAll(IMPORT)].map((match) => match.groups.path);
	assert.deepEqual(imports, ["@fontsource-variable/geist/wght.css"]);
	const ranges = JSON.parse(readFileSync(packageFile("@fontsource-variable/inter/unicode.json"), "utf8"));
	const faces = [...css.matchAll(FACE)].map((match) => match.groups.body);
	assert.deepEqual(
		faces.map((body) => property(body, "font-family")),
		['"Inter Variable"', '"Inter Variable"'],
	);
	for (const [index, subset] of ["greek-ext", "greek"].entries()) {
		const body = faces[index];
		const url = URL_OF.exec(body).groups.url;
		assert.equal(url, `@fontsource-variable/inter/files/inter-${subset}-wght-normal.woff2`);
		assert.ok(existsSync(packageFile(url)), `${url} exists`);
		assert.equal(property(body, "unicode-range").replaceAll(" ", ""), ranges[subset]);
		assert.equal(property(body, "font-weight"), "100 900");
	}
});

it("gives the stack to Tabler's variable and Tailwind's font-sans, and imports fonts.css first", () => {
	const stack = STACK.exec(read("../styles/brand.css"))?.groups.stack;
	assert.ok(stack, "brand.css sets --tblr-font-sans-serif");
	const families = stack.split(",").map((family) => family.trim());
	assert.deepEqual(families.slice(0, 3), ['"Geist Variable"', '"Inter Variable"', "system-ui"]);
	assert.equal(families.at(-1), "sans-serif");
	assert.match(read("../styles/tailwind.css"), TAILWIND_SANS);
	const styles = [...read("../main.jsx").matchAll(STYLE_IMPORT)];
	assert.deepEqual(
		styles.map((match) => match.groups.name),
		["fonts.css", "tabler.css", "tailwind.css"],
	);
});

it("lets the app's page load fonts from NPMpro itself (font-src 'self')", () => {
	const conf = read("../../../rootfs/usr/local/nginx/conf/conf.d/npmpro.conf");
	const page = PAGE_CSP.exec(conf)?.groups.csp;
	assert.ok(page, "the CSP of index.html");
	assert.match(page, FONT_SRC);
});
