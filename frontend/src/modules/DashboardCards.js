// The lists of the dashboard's monitoring cards, shaped from the summary. Pure functions, no React.
import { isCountryCode } from "./Monitoring.js";

const TOP = 3;
// "crowdsecurity/http-probing": an author, a slash, the name; a manual decision ("manual 'ban' from 'x'") or a
// blocklist name has no such prefix and stays whole
const SCENARIO_AUTHOR = /^[\w.-]+\/(?<name>.+)$/u;

// the three reasons from the destructive to the warning colour, "other" in muted grey; whole class strings so Tailwind
// finds them (fill for the bar, bg for the legend dot)
const BAN_TONES = [
	{ fill: "fill-destructive", dot: "bg-destructive" },
	{
		fill: "fill-[color-mix(in_oklab,var(--destructive)_50%,var(--warning))]",
		dot: "bg-[color-mix(in_oklab,var(--destructive)_50%,var(--warning))]",
	},
	{ fill: "fill-warning", dot: "bg-warning" },
];
const OTHER_TONE = { fill: "fill-muted-foreground/40", dot: "bg-muted-foreground/40" };

// the bar is 100 units wide; every segment gets at least MIN_WIDTH (one ban among thousands stays visible) and a GAP
// separates two segments; the rest is shared by count
const BAR_WIDTH = 100;
const GAP = 1;
const MIN_WIDTH = 2;

/**
 * The rows of the "Top countries today" card.
 *
 * @param {Array<{country: string, requests: number}> | null | undefined} list  topCountriesToday of the summary
 * @returns {Array<{code: string, requests: number}>}  at most three, codes in upper case
 */
const topCountryRows = (list) =>
	(Array.isArray(list) ? list : [])
		.filter((row) => isCountryCode(row?.country))
		.slice(0, TOP)
		.map((row) => ({ code: row.country.toUpperCase(), requests: Number(row.requests) || 0 }));

/**
 * A ban reason without its author prefix: "crowdsecurity/http-probing" gives "http-probing".
 *
 * @param {string | null | undefined} scenario
 * @returns {string}
 */
const shortScenario = (scenario) => {
	const text = typeof scenario === "string" ? scenario : "";
	return SCENARIO_AUTHOR.exec(text)?.groups.name ?? text;
};

/**
 * The segments of the "Active bans" split bar and its legend: the top reasons in order, then "other" (the active bans
 * the reasons do not cover, left out at 0). Empty without a reason (the bar and the legend are hidden then).
 *
 * @param {number | null | undefined} activeBans
 * @param {Array<{scenario: string, count: number}> | null | undefined} reasons  topBanReasons of the summary
 * @returns {Array<{key: string, scenario: string|null, short: string|null, count: number,
 *   tone: {fill: string, dot: string}, x: number, width: number}>}
 */
const banSegments = (activeBans, reasons) => {
	const top = (Array.isArray(reasons) ? reasons : [])
		.filter((r) => typeof r?.scenario === "string" && r.scenario !== "" && Number(r.count) > 0)
		.slice(0, TOP)
		.map((r, index) => ({
			key: r.scenario,
			scenario: r.scenario,
			short: shortScenario(r.scenario),
			count: Number(r.count),
			tone: BAN_TONES[index],
		}));
	if (top.length === 0) return [];
	const listed = top.reduce((sum, r) => sum + r.count, 0);
	const other = Math.max(0, (Number(activeBans) || 0) - listed);
	const entries =
		other > 0 ? [...top, { key: "other", scenario: null, short: null, count: other, tone: OTHER_TONE }] : top;
	const total = listed + other;
	const free = BAR_WIDTH - GAP * (entries.length - 1) - MIN_WIDTH * entries.length;
	let x = 0;
	return entries.map((entry) => {
		const width = MIN_WIDTH + (free * entry.count) / total;
		const segment = { ...entry, x, width };
		x += width + GAP;
		return segment;
	});
};

export { BAN_TONES, banSegments, OTHER_TONE, shortScenario, topCountryRows };
