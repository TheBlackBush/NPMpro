import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { overridesAcmeChallenge } from "../lib/acme-challenge.js";

const ENVS_SH = new URL("../../rootfs/usr/local/bin/envs.sh", import.meta.url);
const TEMPLATE_VERSION = /^TV="(?<version>\d+)"$/mu;
const PATH = "/.well-known/acme-challenge/";

describe("overridesAcmeChallenge", () => {
	const yes = [
		["a plain prefix", { path: PATH, location_type: "" }],
		["^~", { path: PATH, location_type: "^~ " }],
		["no type", { path: PATH }],
		["a double quoted path", { path: `"${PATH}"` }],
		["a single quoted path", { path: `'${PATH}'` }],
		["an enabled location", { path: PATH, npmpro_enabled: true }],
	];
	for (const [label, location] of yes) {
		it(`is true for ${label}`, () => assert.equal(overridesAcmeChallenge(location), true));
	}

	const no = [
		["a disabled location", { path: PATH, npmpro_enabled: false }],
		["a padded path", { path: `  ${PATH} ` }],
		["=", { path: PATH, location_type: "= " }],
		["~", { path: PATH, location_type: "~ " }],
		["~*", { path: PATH, location_type: "~* " }],
		["@", { path: PATH, location_type: "@" }],
		["the path without the slash", { path: "/.well-known/acme-challenge" }],
		["a deeper path", { path: `${PATH}x` }],
		["another case", { path: "/.WELL-KNOWN/acme-challenge/" }],
		["undefined", undefined],
	];
	for (const [label, location] of no) {
		it(`is false for ${label}`, () => assert.equal(overridesAcmeChallenge(location), false));
	}
});

it("bumps the template version for the ACME location changes", () => {
	const version = Number(TEMPLATE_VERSION.exec(readFileSync(ENVS_SH, "utf8")).groups.version);
	assert.ok(version >= 28, `TV is ${version}`);
});
