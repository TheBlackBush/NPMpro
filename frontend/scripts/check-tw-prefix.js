// Every Tailwind class in the new UI's source files must carry the tw: prefix (src/modules/TailwindPrefix.js).
// Run from any folder: node scripts/check-tw-prefix.js [dir or file]... (default: src/ui and src/shell; a folder that
// does not exist yet is skipped). Prints file:line: class for each unprefixed class and exits 1 when it finds any.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { unprefixedClasses } from "../src/modules/TailwindPrefix.js";

const FRONTEND = new URL("..", import.meta.url).pathname;
const SOURCE = /\.(?:js|jsx|mjs)$/u;
const TEST = /\.test\.js$/u;

function sourcesIn(path) {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).flatMap((name) => {
		const child = join(path, name);
		return statSync(child).isDirectory() || (SOURCE.test(name) && !TEST.test(name)) ? sourcesIn(child) : [];
	});
}

const args = process.argv.slice(2);
const roots = (args.length > 0 ? args : [join(FRONTEND, "src/ui"), join(FRONTEND, "src/shell")]).filter(existsSync);
let found = 0;
for (const file of roots.flatMap(sourcesIn)) {
	for (const { line, token } of unprefixedClasses(readFileSync(file, "utf8"))) {
		console.log(`${relative(process.cwd(), file)}:${line}: ${token}`);
		found++;
	}
}
if (found > 0) {
	console.log(`${found} Tailwind classes without the tw: prefix (Tailwind generates only tw: classes)`);
	process.exitCode = 1;
}
