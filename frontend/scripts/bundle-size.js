// Sizes of the built frontend (pnpm vite build first): the JavaScript and CSS the start page loads, raw and gzip,
// and with --chunks every chunk. Names lose their hash, so two builds compare line by line.
// Usage: node scripts/bundle-size.js [--chunks]
import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";
import { gzipSync } from "node:zlib";

const DIST = new URL("../dist/", import.meta.url);
const STARTUP = /<(?:script|link)[^>]+(?:src|href)="\/(?<file>assets\/[^"]+\.(?:js|css))"/gu;
const HASH = /-[\w-]{8}(?=\.(?:js|css)$)/u;

const sizeOf = (file) => {
	const data = readFileSync(new URL(file, DIST));
	return { raw: data.length, gzip: gzipSync(data, { level: 9 }).length };
};
const kb = (bytes) => Math.round(bytes / 102.4) / 10;
const line = (name, { raw, gzip }) => console.log(`${name.replace(HASH, "")}\t${kb(raw)} KB\t${kb(gzip)} KB gzip`);

const html = readFileSync(new URL("index.html", DIST), "utf8");
const total = { raw: 0, gzip: 0 };
for (const {
	groups: { file },
} of html.matchAll(STARTUP)) {
	const size = sizeOf(file);
	line(file, size);
	total.raw += size.raw;
	total.gzip += size.gzip;
}
line("startup total", total);
if (process.argv.includes("--chunks")) {
	for (const file of readdirSync(new URL("assets/", DIST)).sort())
		line(`chunk assets/${file}`, sizeOf(`assets/${file}`));
}
