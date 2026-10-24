import { useEffect, useMemo, useRef, useState } from "react";
import { useThemeState } from "src/context";
import { currentLocale, intl } from "src/locale";
import { axisLabels, chartData, chartSeries, formatCount } from "src/modules/Monitoring";

// Tabler colour per status class (spec: 2xx green, 3xx blue, 4xx orange, 5xx red)
const CLASS_COLORS = { "2xx": "green", "3xx": "blue", "4xx": "orange", "5xx": "red", other: "secondary" };
const HEIGHT = 260;
// most time labels per range; fewer when they do not fit
const MAX_TICKS = { "1h": 7, "24h": 8, "7d": 8, "30d": 10 };

let loader = null;
// only the parts the line chart needs, in a chunk of its own
const loadChart = () => {
	loader ??= import("chart.js").then(
		({ CategoryScale, Chart, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip }) => {
			Chart.register(
				CategoryScale,
				Filler,
				Legend,
				LinearScale,
				LineController,
				LineElement,
				PointElement,
				Tooltip,
			);
			return Chart;
		},
	);
	return loader;
};

const seriesName = (key) => (key === "other" ? intl.formatMessage({ id: "monitoring.traffic.class-other" }) : key);

const isDaily = (range) => range === "7d" || range === "30d";

const axisFormat = (range) =>
	new Intl.DateTimeFormat(
		currentLocale,
		isDaily(range) ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
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
		text: resolve("var(--tblr-body-color)"),
		muted: resolve("var(--tblr-secondary)"),
		grid: resolve("var(--tblr-border-color)"),
		surface: resolve("var(--tblr-bg-surface)"),
		lines: keys.map((key) => resolve(`var(--tblr-${CLASS_COLORS[key]})`)),
		fills: keys.map((key) => resolve(`rgba(var(--tblr-${CLASS_COLORS[key]}-rgb), 0.25)`)),
		font: getComputedStyle(parent).fontFamily,
	};
	probe.remove();
	return colors;
};

const buildOptions = ({ range, labels, times, totals, colors }) => ({
	responsive: true,
	maintainAspectRatio: false,
	animation: false,
	interaction: { mode: "index", intersect: false },
	elements: { point: { radius: 0, hoverRadius: 3 }, line: { tension: 0, borderWidth: 2 } },
	layout: { padding: { top: 4, right: 8 } },
	scales: {
		x: {
			type: "category",
			grid: { display: false },
			border: { color: colors.grid },
			ticks: {
				color: colors.muted,
				font: { family: colors.font, size: 12 },
				maxRotation: 0,
				autoSkip: true,
				autoSkipPadding: 16,
				maxTicksLimit: MAX_TICKS[range] ?? MAX_TICKS["24h"],
				callback: (_value, index) => labels[index] ?? null,
			},
		},
		y: {
			type: "linear",
			stacked: true,
			beginAtZero: true,
			suggestedMax: 1,
			grid: { color: colors.grid },
			border: { display: false, dash: [4, 4] },
			ticks: {
				color: colors.muted,
				font: { family: colors.font, size: 12 },
				precision: 0,
				maxTicksLimit: 6,
				callback: (value) => formatCount(value),
			},
		},
	},
	plugins: {
		legend: {
			position: "top",
			align: "start",
			labels: {
				color: colors.text,
				font: { family: colors.font, size: 12 },
				boxWidth: 10,
				boxHeight: 10,
				// class name and its total, with the solid class colour
				generateLabels: (chart) =>
					chart.data.datasets.map((dataset, i) => ({
						text: `${dataset.label}  ${intl.formatNumber(totals[i] ?? 0)}`,
						fillStyle: dataset.borderColor,
						strokeStyle: dataset.borderColor,
						lineWidth: 0,
						fontColor: colors.text,
						hidden: !chart.isDatasetVisible(i),
						datasetIndex: i,
					})),
			},
		},
		tooltip: {
			backgroundColor: colors.surface,
			titleColor: colors.text,
			bodyColor: colors.text,
			borderColor: colors.grid,
			borderWidth: 1,
			titleFont: { family: colors.font, size: 12, weight: "600" },
			bodyFont: { family: colors.font, size: 12 },
			padding: 8,
			boxWidth: 10,
			boxHeight: 10,
			boxPadding: 4,
			callbacks: {
				title: (items) => (items.length > 0 ? tooltipFormat.format(new Date(times[items[0].dataIndex])) : ""),
				label: (item) => `${item.dataset.label}: ${intl.formatNumber(item.raw)}`,
				labelColor: (item) => ({
					borderColor: item.dataset.borderColor,
					backgroundColor: item.dataset.borderColor,
					borderWidth: 0,
				}),
			},
		},
	},
});

/**
 * Stacked area chart of requests per status class over the range, drawn with Chart.js (loaded on first use).
 * Classes stack from 2xx at the bottom; the legend shows each class total, the tooltip the per-class numbers of the
 * hovered bucket. Follows the light and dark theme.
 *
 * @param {object} props
 * @param {{ bucket: number, byClass: Record<string, number> }[]} props.series  the API series
 * @param {"1h"|"24h"|"7d"|"30d"} props.range
 */
function TrafficChart({ series, range }) {
	const wrapper = useRef(null);
	const canvas = useRef(null);
	const chart = useRef(null);
	const [Chart, setChart] = useState(null);
	const [failed, setFailed] = useState(false);
	// ThemeContext sets data-bs-theme on <html> while rendering, so the CSS variables match this value
	const { theme } = useThemeState();
	const classes = useMemo(() => chartSeries(series, range), [series, range]);
	const data = useMemo(() => chartData(classes), [classes]);
	const keys = classes.map((s) => s.key);

	useEffect(() => {
		let disposed = false;
		loadChart()
			.then((lib) => {
				if (!disposed) setChart(() => lib);
			})
			.catch(() => {
				if (!disposed) setFailed(true);
			});
		return () => {
			disposed = true;
		};
	}, []);

	// one instance for the life of the component
	useEffect(() => {
		if (!(Chart && canvas.current)) return;
		chart.current = new Chart(canvas.current, { type: "line", data: { labels: [], datasets: [] } });
		return () => {
			chart.current?.destroy();
			chart.current = null;
		};
	}, [Chart]);

	// data, range and theme changes update the instance in place
	// biome-ignore lint/correctness/useExhaustiveDependencies: theme is read through the CSS variables
	useEffect(() => {
		const instance = chart.current;
		if (!(instance && wrapper.current)) return;
		const seriesKeys = classes.map((s) => s.key);
		const colors = themeColors(wrapper.current, seriesKeys);
		const format = axisFormat(range);
		const labels = axisLabels(data.times, (ms) => format.format(new Date(ms)), isDaily(range));
		instance.data = {
			// the category values only need to be unique; the shown text comes from the tick callback
			labels: data.times,
			datasets: seriesKeys.map((key, i) => ({
				label: seriesName(key),
				data: data.values[i],
				borderColor: colors.lines[i],
				backgroundColor: colors.fills[i],
				fill: i === 0 ? "origin" : "-1",
			})),
		};
		instance.options = buildOptions({ range, labels, times: data.times, totals: data.totals, colors });
		instance.update("none");
	}, [Chart, data, classes, range, theme]);

	if (failed) {
		return <div className="text-secondary">{intl.formatMessage({ id: "monitoring.load-error" })}</div>;
	}

	return (
		<>
			<div ref={wrapper} className="position-relative" style={{ height: HEIGHT }}>
				<canvas
					ref={canvas}
					role="img"
					aria-label={intl.formatMessage({ id: "monitoring.traffic.chart-label" })}
				/>
			</div>
			{/* the numbers behind the chart for screen readers */}
			<ul className="visually-hidden">
				{keys.map((key, i) => (
					<li key={key}>
						{seriesName(key)}:{" "}
						{intl.formatMessage({ id: "monitoring.requests" }, { count: data.totals[i] })}
					</li>
				))}
			</ul>
		</>
	);
}

export { TrafficChart };
