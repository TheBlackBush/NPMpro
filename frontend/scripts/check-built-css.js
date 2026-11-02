// The built stylesheet may not reach the old Tabler pages in new ways (src/modules/CssLayers.js): every rule outside
// a cascade layer and every rule of the new UI's layers (outside @scope) without a tw: class must be in
// scripts/built-css-allowlist.txt. A shadcn, tw-animate-css or Tailwind update that adds one fails here; so does an
// allowlisted line the build no longer has (remove it). Run after `vite build`: node scripts/check-built-css.js [dir]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { compareWithAllowlist, cssFindings } from "../src/modules/CssLayers.js";

const FRONTEND = fileURLToPath(new URL("..", import.meta.url));
const dir = process.argv[2] ?? join(FRONTEND, "dist/assets");
const sheets = readdirSync(dir).filter((name) => name.endsWith(".css"));
if (sheets.length === 0) {
	console.log(`no stylesheet in ${dir}: run vite build first`);
	process.exit(1);
}
const findings = [...new Set(sheets.flatMap((name) => cssFindings(readFileSync(join(dir, name), "utf8"))))];
const { added, gone } = compareWithAllowlist(
	findings,
	readFileSync(join(FRONTEND, "scripts/built-css-allowlist.txt"), "utf8"),
);
for (const line of added) console.log(`new: ${line}`);
for (const line of gone) console.log(`no longer built (remove it from the allowlist): ${line}`);
if (added.length > 0 || gone.length > 0) {
	console.log("the built CSS differs from scripts/built-css-allowlist.txt: see the comments there");
	process.exitCode = 1;
} else {
	console.log(`${sheets.length} stylesheet(s): ${findings.length} findings, all in the allowlist`);
}
