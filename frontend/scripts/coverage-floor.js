// Checks the "all files" row of node --test's coverage table against floors with decimals: node's own
// --test-coverage-* flags read 98.5 as 98, so a fall from 98.6 to 98.1 would pass them.
// Usage: node --test --experimental-test-coverage ... | node scripts/coverage-floor.js <lines> <branches> <functions>
import { readFileSync } from "node:fs";
import process from "node:process";

const floors = process.argv.slice(2).map(Number);
if (floors.length !== 3 || floors.some((n) => !Number.isFinite(n))) {
	console.error("usage: coverage-floor.js <lines> <branches> <functions>");
	process.exit(2);
}
const report = readFileSync(0, "utf8");
const row = /all files\s*\|\s*(?<lines>[\d.]+)\s*\|\s*(?<branches>[\d.]+)\s*\|\s*(?<functions>[\d.]+)\s*\|/u.exec(
	report,
);
if (!row) {
	console.error('coverage-floor: no "all files" row in the coverage report');
	process.exit(1);
}
const names = ["lines", "branches", "functions"];
let failed = false;
for (const [i, name] of names.entries()) {
	const value = Number(row.groups[name]);
	const ok = value >= floors[i];
	if (!ok) failed = true;
	console.log(`${ok ? "ok" : "BELOW"} ${name}: ${value} (floor ${floors[i]})`);
}
process.exit(failed ? 1 : 0);
