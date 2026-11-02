// Every Tailwind class in the new UI's source files must carry the tw: prefix (src/modules/TailwindPrefix.js).
// Run from any folder: node scripts/check-tw-prefix.js [dir or file]... (default: NEW_UI_PATHS of TailwindPrefix.js; a
// path that does not exist is skipped; *.test.js and *.test.jsx files are not scanned). Prints `N file(s) checked` on a pass and file:line: class for each
// unprefixed class and exits 1 when it finds any (also when a file does not parse).
// A string that only looks like a utility (position = "fixed") is left out with a comment on the line above it:
//   // tw-prefix-ignore            or, inside JSX:   {/* tw-prefix-ignore */}
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { NEW_UI_PATHS, unprefixedClasses } from "../src/modules/TailwindPrefix.js";

const FRONTEND = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = /\.(?:js|jsx|mjs)$/u;
const TEST = /\.test\.jsx?$/u;

function sourcesIn(path) {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).flatMap((name) => {
		const child = join(path, name);
		return statSync(child).isDirectory() || (SOURCE.test(name) && !TEST.test(name)) ? sourcesIn(child) : [];
	});
}

const args = process.argv.slice(2);
const roots = (args.length > 0 ? args : NEW_UI_PATHS.map((path) => join(FRONTEND, path))).filter(existsSync);
let found = 0;
const files = roots.flatMap(sourcesIn);
for (const file of files) {
	const name = relative(process.cwd(), file);
	try {
		for (const { line, token } of unprefixedClasses(readFileSync(file, "utf8"))) {
			console.log(`${name}:${line}: ${token}`);
			found++;
		}
	} catch (error) {
		console.log(`${name}: cannot parse: ${error.message}`);
		found++;
	}
}
if (found > 0) {
	console.log(`${found} findings: Tailwind classes without the tw: prefix (Tailwind generates only tw: classes)`);
	process.exitCode = 1;
} else {
	console.log(`${files.length} file(s) checked`);
}
