// Every key of ui/en.json must be used by the frontend or the backend (UX-35): a key no code holds as a string and no
// template literal can build fails the check, so a removed feature takes its texts with it. Tests do not count as a
// use. A key built another way (string concatenation, a key from data) must be written out whole in the code.
// Run from any folder: node translations/check-unused.js (paths are resolved from this file)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { unusedKeys } from "../src/modules/TranslationUsage.js";

const FRONTEND = new URL("..", import.meta.url).pathname;
const ROOTS = [join(FRONTEND, "src"), join(FRONTEND, "..", "backend")];
const SOURCE = /\.(?:js|jsx|mjs)$/u;
const TEST = /\.test\.js$/u;
// dependencies, tests and tool folders (dot folders) are not the app's code
const SKIPPED = new Set(["node_modules", "test", "dist"]);

function sourcesIn(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name.startsWith(".") || SKIPPED.has(entry.name) ? [] : sourcesIn(path);
		}
		return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
	});
}

const keys = Object.keys(JSON.parse(readFileSync(join(FRONTEND, "translations/ui/en.json"), "utf8")));
const sources = ROOTS.flatMap(sourcesIn).map((path) => readFileSync(path, "utf8"));
const unused = unusedKeys(keys, sources);
for (const key of unused) console.log(`ui/en.json: unused key: ${key}`);
if (unused.length > 0) process.exitCode = 1;
