import "uplot/dist/uPlot.min.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useThemeState } from "src/context";
import { currentLocale, intl } from "src/locale";
import { chartSeries, formatCount, stackedChartData } from "src/modules/Monitoring";

// Tabler colour per status class (spec: 2xx green, 3xx blue, 4xx orange, 5xx red)
const CLASS_COLORS = { "2xx": "green", "3xx": "blue", "4xx": "orange", "5xx": "red", other: "secondary" };
const HEIGHT = 260;
// tick steps for the request axis: whole numbers only
const COUNT_STEPS = [1, 2, 5].flatMap((step) => [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8].map((p) => step * p));
COUNT_STEPS.sort((a, b) => a - b);

let loader = null;
const loadUPlot = () => {
	loader ??= import("uplot").then((module) => module.default);
	return loader;
};

const seriesName = (key) => (key === "other" ? intl.formatMessage({ id: "monitoring.traffic.class-other" }) : key);

const axisFormat = (range) =>
	new Intl.DateTimeFormat(
		currentLocale,
		range === "1h" || range === "24h"
			? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
			: { month: "short", day: "numeric" },
	);
const tooltipFormat = new Intl.DateTimeFormat(currentLocale, {
	dateStyle: "medium",
	timeStyle: "short",
	hourCycle: "h23",
});

/**
 * Resolves Tabler CSS variables of the current theme to colours the canvas understands (the variables hold
 * light-dark() and var() values). A probe element inside the chart inherits the theme's colour scheme.
 */
const themeColors = (parent, keys) => {
	const probe = document.createElement("span");
	parent.appendChild(probe);
	const resolve = (value) => {
		probe.style.color = value;
		return getComputedStyle(probe).color;
	};
	const colors = {
		axis: resolve("var(--tblr-secondary)"),
		grid: resolve("var(--tblr-border-color)"),
		cursor: resolve("var(--tblr-secondary)"),
		lines: keys.map((key) => resolve(`var(--tblr-${CLASS_COLORS[key]})`)),
		fills: keys.map((key) => resolve(`rgba(var(--tblr-${CLASS_COLORS[key]}-rgb), 0.25)`)),
	};
	const style = getComputedStyle(parent);
	colors.font = `12px ${style.fontFamily}`;
	probe.remove();
	return colors;
};

const buildOptions = (uPlot, { keys, bands, width, colors, latest, onCursor }) => {
	const axis = {
		stroke: colors.axis,
		font: colors.font,
		grid: { stroke: colors.grid, width: 1, dash: [4, 4] },
		ticks: { show: false },
	};
	return {
		width,
		height: HEIGHT,
		ms: 1,
		legend: { show: false },
		padding: [8, 8, 0, 0],
		cursor: {
			drag: { x: false, y: false, setScale: false },
			points: { size: 6 },
		},
		select: { show: false },
		scales: {
			x: { time: true },
			y: {
				range: (_u, _min, max) => (max > 0 ? [0, uPlot.rangeNum(0, max, 0.1, true)[1]] : [0, 1]),
			},
		},
		axes: [
			{
				...axis,
				space: 80,
				values: (_u, splits) => {
					const format = axisFormat(latest.current.range);
					// day labels on 12 hour ticks would repeat: show each day once
					return splits.map((value, i) => {
						const label = format.format(new Date(value));
						return i > 0 && label === format.format(new Date(splits[i - 1])) ? "" : label;
					});
				},
			},
			{
				...axis,
				incrs: COUNT_STEPS,
				values: (_u, splits) => splits.map((value) => formatCount(value)),
			},
		],
		// highest class first, like the stacked data
		series: [
			{},
			...keys
				.map((key, i) => ({
					label: seriesName(key),
					stroke: colors.lines[i],
					fill: colors.fills[i],
					width: 2,
					points: { show: false },
				}))
				.reverse(),
		],
		bands,
		hooks: { setCursor: [onCursor] },
	};
};

/**
 * Stacked area chart of requests per status class over the range, drawn with uPlot (loaded on first use).
 * Each series is the sum of its class and the classes below it, filled down to the next lower one; the legend and the tooltip
 * show the per-class numbers. Follows the light and dark theme.
 *
 * @param {object} props
 * @param {{ bucket: number, byClass: Record<string, number> }[]} props.series  the API series
 * @param {"1h"|"24h"|"7d"|"30d"} props.range
 */
function TrafficChart({ series, range }) {
	const wrapper = useRef(null);
	const element = useRef(null);
	const chart = useRef(null);
	const [uPlot, setUPlot] = useState(null);
	const [failed, setFailed] = useState(false);
	const [hover, setHover] = useState(null);
	// ThemeContext sets data-bs-theme on <html> while rendering, so the CSS variables match this value
	const { theme } = useThemeState();
	const classes = useMemo(() => chartSeries(series, range), [series, range]);
	const stacked = useMemo(() => stackedChartData(classes), [classes]);
	const keys = classes.map((s) => s.key);
	const keyList = keys.join(",");
	const latest = useRef(null);
	latest.current = { stacked, range };

	useEffect(() => {
		let disposed = false;
		loadUPlot()
			.then((lib) => {
				if (!disposed) setUPlot(() => lib);
			})
			.catch(() => {
				if (!disposed) setFailed(true);
			});
		return () => {
			disposed = true;
		};
	}, []);

	// (re)built when uPlot is loaded, the theme changes or a class appears or goes; data changes use setData below
	// biome-ignore lint/correctness/useExhaustiveDependencies: theme is read through the CSS variables
	useEffect(() => {
		if (!(uPlot && element.current && wrapper.current)) return;
		const seriesKeys = keyList.split(",");
		const current = latest.current.stacked;
		const onCursor = (u) => {
			const { idx, left } = u.cursor;
			if (idx === null || idx === undefined || left === undefined || left < 0) {
				setHover(null);
				return;
			}
			const x = u.over.offsetLeft + u.valToPos(u.data[0][idx], "x");
			setHover((previous) =>
				previous?.idx === idx && previous?.x === x
					? previous
					: { idx, x, flip: x > u.over.offsetLeft + u.over.clientWidth / 2 },
			);
		};
		const instance = new uPlot(
			buildOptions(uPlot, {
				keys: seriesKeys,
				bands: current.bands,
				width: Math.max(wrapper.current.clientWidth, 100),
				colors: themeColors(wrapper.current, seriesKeys),
				latest,
				onCursor,
			}),
			current.data,
			element.current,
		);
		chart.current = instance;
		const observer = new ResizeObserver(() => {
			const width = wrapper.current?.clientWidth;
			if (width && width !== instance.width) instance.setSize({ width, height: HEIGHT });
		});
		observer.observe(wrapper.current);
		return () => {
			observer.disconnect();
			instance.destroy();
			chart.current = null;
			setHover(null);
		};
	}, [uPlot, theme, keyList]);

	useEffect(() => {
		const instance = chart.current;
		if (instance && instance.data !== stacked.data) {
			instance.setData(stacked.data);
			setHover(null);
		}
	}, [stacked]);

	if (failed) {
		return <div className="text-secondary">{intl.formatMessage({ id: "monitoring.load-error" })}</div>;
	}

	const point = hover && hover.idx < stacked.data[0].length ? hover : null;

	return (
		<>
			<div className="d-flex flex-wrap gap-3 mb-2 small" aria-hidden="true">
				{keys.map((key, i) => (
					<span key={key} className="text-nowrap">
						<span className={`legend me-2 bg-${CLASS_COLORS[key]}`} />
						{seriesName(key)} <span className="text-secondary">{intl.formatNumber(stacked.totals[i])}</span>
					</span>
				))}
			</div>
			<div ref={wrapper} className="position-relative">
				<div
					ref={element}
					role="img"
					aria-label={intl.formatMessage({ id: "monitoring.traffic.chart-label" })}
				/>
				{point ? (
					<div
						className="position-absolute top-0 bg-body border rounded shadow-sm p-2 small pe-none text-nowrap"
						style={{
							left: point.x,
							transform: point.flip ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
						}}
						aria-hidden="true"
					>
						<div className="fw-medium mb-1">
							{tooltipFormat.format(new Date(stacked.data[0][point.idx]))}
						</div>
						{keys.map((key, i) => (
							<div key={key}>
								<span className={`legend me-2 bg-${CLASS_COLORS[key]}`} />
								{seriesName(key)}: {intl.formatNumber(stacked.values[i][point.idx])}
							</div>
						))}
					</div>
				) : null}
			</div>
			{/* the numbers behind the chart for screen readers */}
			<ul className="visually-hidden">
				{keys.map((key, i) => (
					<li key={key}>
						{seriesName(key)}:{" "}
						{intl.formatMessage({ id: "monitoring.requests" }, { count: stacked.totals[i] })}
					</li>
				))}
			</ul>
		</>
	);
}

export { TrafficChart };
