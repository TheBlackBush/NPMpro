// Status token per request class, the same colours as the status badges
const CHART_CLASS_TOKENS = {
	"2xx": "--success",
	"3xx": "--info",
	"4xx": "--warning",
	"5xx": "--destructive",
	other: "--muted-foreground",
};

/**
 * CSS colour strings per status class: the solid line and a 25 % fill, both on the class token.
 *
 * @param {string[]} classes  class keys such as "2xx" or "other"
 * @returns {{ cls: string, line: string, fill: string }[]}
 */
const chartTokenColors = (classes) =>
	classes.map((cls) => {
		const token = CHART_CLASS_TOKENS[cls] ?? CHART_CLASS_TOKENS.other;
		return { cls, line: `var(${token})`, fill: `color-mix(in oklab, var(${token}) 25%, transparent)` };
	});

export { CHART_CLASS_TOKENS, chartTokenColors };
