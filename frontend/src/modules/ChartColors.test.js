import assert from "node:assert/strict";
import { it } from "node:test";
import { CHART_CLASS_TOKENS, chartTokenColors } from "./ChartColors.js";

it("maps each status class to its status token, like the badges", () => {
	assert.deepEqual(CHART_CLASS_TOKENS, {
		"2xx": "--success",
		"3xx": "--info",
		"4xx": "--warning",
		"5xx": "--destructive",
		other: "--muted-foreground",
	});
});

it("builds a line colour and a 25 % fill per class", () => {
	assert.deepEqual(chartTokenColors(["2xx", "5xx"]), [
		{ cls: "2xx", line: "var(--success)", fill: "color-mix(in oklab, var(--success) 25%, transparent)" },
		{ cls: "5xx", line: "var(--destructive)", fill: "color-mix(in oklab, var(--destructive) 25%, transparent)" },
	]);
});

it("an unknown class gets the muted colour", () => {
	assert.equal(chartTokenColors(["1xx"])[0].line, "var(--muted-foreground)");
});
