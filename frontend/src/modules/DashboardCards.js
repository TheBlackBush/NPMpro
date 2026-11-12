// The lists of the dashboard's monitoring cards, shaped from the summary. Pure functions, no React.
import { isCountryCode } from "./Monitoring.js";

const TOP_COUNTRIES = 7;
const TOP_REASONS = 5;
const HOUR = 3_600_000;
// "crowdsecurity/http-probing": an author, a slash, the name; a manual decision ("manual 'ban' from 'x'") or a
// blocklist name has no such prefix and stays whole
const SCENARIO_AUTHOR = /^[\w.-]+\/(?<name>.+)$/u;

// the reasons' colours from the destructive colour to the amber yellow #f3b01d (the same in light and dark), "other" in
// muted grey; whole class strings so Tailwind finds them (fill for the bar, bg for the legend dot)
const BAN_TONES = [
	{ fill: "fill-destructive", dot: "bg-destructive" },
	{
		fill: "fill-[color-mix(in_oklab,var(--destructive)_75%,#f3b01d)]",
		dot: "bg-[color-mix(in_oklab,var(--destructive)_75%,#f3b01d)]",
	},
	{
		fill: "fill-[color-mix(in_oklab,var(--destructive)_50%,#f3b01d)]",
		dot: "bg-[color-mix(in_oklab,var(--destructive)_50%,#f3b01d)]",
	},
	{
		fill: "fill-[color-mix(in_oklab,var(--destructive)_25%,#f3b01d)]",
		dot: "bg-[color-mix(in_oklab,var(--destructive)_25%,#f3b01d)]",
	},
	{ fill: "fill-[#f3b01d]", dot: "bg-[#f3b01d]" },
];
// which of BAN_TONES the reasons get, by their number: the first is always red and, from two reasons on, the last is
// always the yellow
const TONES_BY_COUNT = { 1: [0], 2: [0, 4], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] };
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
 * @returns {Array<{code: string, requests: number}>}  at most seven, codes in upper case
 */
const topCountryRows = (list) =>
	(Array.isArray(list) ? list : [])
		.filter((row) => isCountryCode(row?.country))
		.slice(0, TOP_COUNTRIES)
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
 * Lays entries out on the bar, in order: each gets at least MIN_WIDTH, a GAP between two, the rest shared by count.
 *
 * @template {{count: number}} E
 * @param {E[]} entries  at least one, with a count above 0 in total
 * @returns {Array<E & {x: number, width: number}>}
 */
const layoutBar = (entries) => {
	const total = entries.reduce((sum, entry) => sum + entry.count, 0);
	const free = BAR_WIDTH - GAP * (entries.length - 1) - MIN_WIDTH * entries.length;
	let x = 0;
	return entries.map((entry) => {
		const width = MIN_WIDTH + (free * entry.count) / total;
		const segment = { ...entry, x, width };
		x += width + GAP;
		return segment;
	});
};

/**
 * The segments of the "Active bans" split bar and its legend: the top reasons (five at most) in order, then "other"
 * (the active bans the reasons do not cover, left out at 0). Empty without a reason (the bar and the legend are hidden then).
 *
 * @param {number | null | undefined} activeBans
 * @param {Array<{scenario: string, count: number}> | null | undefined} reasons  topBanReasons of the summary
 * @returns {Array<{key: string, scenario: string|null, short: string|null, count: number,
 *   tone: {fill: string, dot: string}, x: number, width: number}>}
 */
const banSegments = (activeBans, reasons) => {
	const top = (Array.isArray(reasons) ? reasons : [])
		.filter((r) => typeof r?.scenario === "string" && r.scenario !== "" && Number(r.count) > 0)
		.slice(0, TOP_REASONS)
		.map((r) => ({
			key: r.scenario,
			scenario: r.scenario,
			short: shortScenario(r.scenario),
			count: Number(r.count),
		}));
	if (top.length === 0) return [];
	const bans = Number(activeBans) || 0;
	const tones = TONES_BY_COUNT[top.length];
	for (const [index, reason] of top.entries()) reason.tone = BAN_TONES[tones[index]];
	const listed = top.reduce((sum, r) => sum + r.count, 0);
	const other = Math.max(0, bans - listed);
	const entries =
		other > 0 ? [...top, { key: "other", scenario: null, short: null, count: other, tone: OTHER_TONE }] : top;
	return layoutBar(entries);
};

/**
 * The segments of the "Error rate" split bar and its legend: the 4xx answers in the yellow, the 5xx in red. Both
 * entries are always there (the legend shows the two counts); at 0 errors the bar has no segment.
 *
 * @param {number | null | undefined} clientErrors  clientErrorsToday of the summary
 * @param {number | null | undefined} serverErrors  serverErrorsToday of the summary
 * @returns {Array<{key: string, label: string, count: number, tone: {fill: string, dot: string}, x: number,
 *   width: number}>}  width 0 for both at 0 errors
 */
const errorSegments = (clientErrors, serverErrors) => {
	const entries = [
		{ key: "4xx", label: "4xx", count: Math.max(0, Number(clientErrors) || 0), tone: BAN_TONES[4] },
		{ key: "5xx", label: "5xx", count: Math.max(0, Number(serverErrors) || 0), tone: BAN_TONES[0] },
	];
	if (entries.every((entry) => entry.count === 0)) return entries.map((entry) => ({ ...entry, x: 0, width: 0 }));
	// a class with no answers takes no room in the bar, but stays in the legend
	const shown = layoutBar(entries.filter((entry) => entry.count > 0));
	return entries.map((entry) => shown.find((s) => s.key === entry.key) ?? { ...entry, x: 0, width: 0 });
};

/**
 * The start of the requests graph: the first hour of the summary's 24 h series, for the time axis under the graph.
 *
 * @param {Array<{bucket: number}> | null | undefined} series  series24h of the summary (buckets are hours since 1970)
 * @returns {number | null}  milliseconds since 1970, null without a series
 */
const seriesStart = (series) => {
	const bucket = Array.isArray(series) ? Number(series[0]?.bucket) : Number.NaN;
	return Number.isFinite(bucket) ? bucket * HOUR : null;
};

export { BAN_TONES, banSegments, errorSegments, OTHER_TONE, seriesStart, shortScenario, topCountryRows };
