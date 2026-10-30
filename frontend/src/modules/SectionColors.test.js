import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { contrastRatio, cssColor, parseOklch, srgb } from "./ColorContrast.js";
import {
	buttonLabelStyle,
	DARK_LABEL_COLORS,
	KIND_SECTIONS,
	kindColor,
	SECTION_COLORS,
	sectionColor,
	stripeClass,
} from "./SectionColors.js";

// the installed Tabler CSS: the contrast rule is measured on the colours the app really ships
const TABLER_CSS = readFileSync(
	new URL("../../node_modules/@tabler/core/dist/css/tabler.css", import.meta.url),
	"utf8",
);

// every colour a Button can take
const BUTTON_COLORS = [
	"primary",
	"secondary",
	"success",
	"info",
	"warning",
	"danger",
	"muted",
	"blue",
	"azure",
	"indigo",
	"purple",
	"pink",
	"red",
	"orange",
	"yellow",
	"lime",
	"green",
	"teal",
	"cyan",
];

it("gives each section its colour and primary to a window without one", () => {
	assert.equal(sectionColor("proxyHosts"), "lime");
	assert.equal(sectionColor("redirectionHosts"), "yellow");
	assert.equal(sectionColor("deadHosts"), "red");
	assert.equal(sectionColor("streams"), "blue");
	assert.equal(sectionColor("accessLists"), "cyan");
	assert.equal(sectionColor("certificates"), "pink");
	assert.equal(sectionColor("dnsCredentials"), "pink");
	assert.equal(sectionColor("users"), "orange");
	assert.equal(sectionColor("settings"), "teal");
	assert.equal(sectionColor(undefined), "primary");
	assert.equal(sectionColor("nope"), "primary");
});

it("colours an export or import by the list it was opened from", () => {
	assert.deepEqual(
		Object.keys(KIND_SECTIONS).map((kind) => [kind, kindColor(kind)]),
		[
			["proxy_hosts", "lime"],
			["redirection_hosts", "yellow"],
			["dead_hosts", "red"],
			["streams", "blue"],
			["access_lists", "cyan"],
			["certificates", "pink"],
			["dns_credentials", "pink"],
		],
	);
	assert.equal(kindColor("settings_monitoring"), "primary");
	assert.equal(stripeClass("streams"), "card-status-top bg-blue");
});

it("reads Tabler's oklch colours as its rgb variables say", () => {
	assert.deepEqual(parseOklch("oklch(70.99% 0.1897 131.53deg)"), { l: 0.7099, c: 0.1897, h: 131.53 });
	assert.equal(parseOklch("#fff"), null);
	for (const name of ["lime", "teal", "pink", "blue", "yellow"]) {
		const rgb = new RegExp(`--tblr-${name}-rgb:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)`, "u")
			.exec(TABLER_CSS)
			.slice(1)
			.map(Number);
		srgb(cssColor(TABLER_CSS, name)).forEach((channel, index) => {
			assert.ok(Math.abs(channel - rgb[index]) <= 2, `${name}: ${channel} vs ${rgb[index]}`);
		});
	}
	assert.equal(contrastRatio({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 }).toFixed(1), "21.0");
});

it("gives a dark label exactly where it reads better than white and reaches 4.5:1", () => {
	const white = cssColor(TABLER_CSS, "light");
	const dark = cssColor(TABLER_CSS, "dark");
	const measured = BUTTON_COLORS.filter((name) => {
		const background = cssColor(TABLER_CSS, name);
		const onDark = contrastRatio(background, dark);
		return contrastRatio(background, white) < 4.5 && onDark > contrastRatio(background, white) && onDark >= 4.5;
	});
	assert.deepEqual(
		measured.toSorted((a, b) => a.localeCompare(b)),
		[...DARK_LABEL_COLORS],
	);
	for (const color of new Set(Object.values(SECTION_COLORS))) {
		assert.equal(Boolean(buttonLabelStyle(color)), DARK_LABEL_COLORS.includes(color), color);
	}
	assert.deepEqual(buttonLabelStyle("lime"), { "--tblr-btn-variant-fg": "var(--tblr-dark)" });
	assert.equal(buttonLabelStyle("primary"), undefined);
	assert.equal(buttonLabelStyle(undefined), undefined);
});
