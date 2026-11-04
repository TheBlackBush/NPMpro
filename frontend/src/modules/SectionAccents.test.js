import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { contrastRatio, parseHex } from "./ColorContrast.js";
import { NAV_ITEMS } from "./Navigation.js";
import { kindSection, navAccent, PRIMARY_ACCENT, SECTION_ACCENTS, SECTIONS, sectionAccent } from "./SectionAccents.js";

const CSS = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

it("gives every section but settings an accent and everything else the primary look", () => {
	assert.deepEqual(Object.keys(SECTION_ACCENTS).toSorted(), SECTIONS.filter((key) => key !== "settings").toSorted());
	assert.equal(sectionAccent("proxyHosts").text, "text-section-proxy");
	assert.equal(sectionAccent("proxyHosts").bg, "bg-section-proxy/15");
	assert.equal(sectionAccent("dnsCredentials"), sectionAccent("certificates"));
	assert.equal(sectionAccent("auditLog"), sectionAccent("users"));
	assert.equal(sectionAccent("settings"), PRIMARY_ACCENT);
	assert.equal(sectionAccent(undefined), PRIMARY_ACCENT);
	assert.equal(sectionAccent("nope"), PRIMARY_ACCENT);
});

it("gives each section its own colour", () => {
	const names = ["proxyHosts", "redirectionHosts", "deadHosts", "streams", "certificates", "accessLists", "users"];
	assert.equal(new Set(names.map((name) => sectionAccent(name).text)).size, names.length);
});

it("maps the nav ids to the accents and leaves dashboard, monitoring and settings on the brand gradient", () => {
	assert.equal(navAccent("proxy-hosts"), sectionAccent("proxyHosts"));
	assert.equal(navAccent("redirection-hosts"), sectionAccent("redirectionHosts"));
	assert.equal(navAccent("dead-hosts"), sectionAccent("deadHosts"));
	assert.equal(navAccent("streams"), sectionAccent("streams"));
	assert.equal(navAccent("certificates"), sectionAccent("certificates"));
	assert.equal(navAccent("access-lists"), sectionAccent("accessLists"));
	for (const id of ["dashboard", "monitoring", "settings", "nope", undefined]) {
		assert.equal(navAccent(id), PRIMARY_ACCENT, String(id));
	}
	assert.match(PRIMARY_ACCENT.underline, /brand-gradient/u);
	assert.ok(NAV_ITEMS.every((item) => navAccent(item.id)));
});

// the accent classes only work when globals.css defines the token behind them
it("has a token pair in globals.css for every accent class, 3:1 against page and card in both themes", () => {
	const tokens = new Set(
		Object.values(SECTION_ACCENTS).map((accent) => /text-section-([a-z]+)$/u.exec(accent.text)[1]),
	);
	assert.equal(tokens.size, 7);
	const light = /:root\s*\{([^}]*)\}/u.exec(CSS)[1];
	const dark = /\.dark\s*\{([^}]*)\}/u.exec(CSS)[1];
	const surfaces = {
		light: [{ l: 1, c: 0, h: 0 }],
		dark: [
			{ l: 0.145, c: 0, h: 0 },
			{ l: 0.205, c: 0, h: 0 },
		],
	};
	for (const token of tokens) {
		assert.match(CSS, new RegExp(`--color-section-${token}:\\s*var\\(--accent-${token}\\)`, "u"));
		for (const [theme, block] of [
			["light", light],
			["dark", dark],
		]) {
			const hex = new RegExp(`--accent-${token}:\\s*(#[0-9a-f]{6})`, "u").exec(block)?.[1];
			assert.ok(hex, `--accent-${token} missing in ${theme}`);
			for (const surface of surfaces[theme]) {
				const ratio = contrastRatio(parseHex(hex), surface);
				assert.ok(ratio >= 3, `${token} ${theme} ${hex}: ${ratio.toFixed(2)}:1`);
			}
		}
	}
});

it("maps every export kind to its section", () => {
	assert.equal(kindSection("proxy_hosts"), "proxyHosts");
	assert.equal(kindSection("redirection_hosts"), "redirectionHosts");
	assert.equal(kindSection("dead_hosts"), "deadHosts");
	assert.equal(kindSection("streams"), "streams");
	assert.equal(kindSection("access_lists"), "accessLists");
	assert.equal(kindSection("certificates"), "certificates");
	assert.equal(kindSection("dns_credentials"), "dnsCredentials");
});

it("gives no section for an unknown kind", () => {
	assert.equal(kindSection("users"), undefined);
});
