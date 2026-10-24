import { useEffect, useMemo, useRef, useState } from "react";
import { currentLocale, intl } from "src/locale";
import { chartSeries, formatCount } from "src/modules/Monitoring";

// Tabler colour per status class (spec: 2xx green, 3xx blue, 4xx orange, 5xx red)
const CLASS_COLORS = { "2xx": "green", "3xx": "blue", "4xx": "orange", "5xx": "red", other: "secondary" };

let loader = null;
const loadApexCharts = () => {
	loader ??= import("apexcharts").then((module) => module.default);
	return loader;
};

const readTheme = () => (document.documentElement.getAttribute("data-bs-theme") === "dark" ? "dark" : "light");

/** The theme of <html>, updated when the theme switcher changes it. */
const useDocumentTheme = () => {
	const [theme, setTheme] = useState(readTheme);
	useEffect(() => {
		const observer = new MutationObserver(() => setTheme(readTheme()));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-bs-theme"] });
		return () => observer.disconnect();
	}, []);
	return theme;
};

const cssVar = (style, name) => style.getPropertyValue(`--tblr-${name}`).trim();

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

const buildOptions = (series, range, theme) => {
	// colours are read from the Tabler variables of the current theme, ApexCharts needs real colour values
	const style = getComputedStyle(document.documentElement);
	const axis = axisFormat(range);
	return {
		chart: {
			type: "area",
			stacked: true,
			height: 260,
			fontFamily: "inherit",
			background: "transparent",
			animations: { enabled: false },
			toolbar: { show: false },
			zoom: { enabled: false },
		},
		theme: { mode: theme },
		series: series.map((s) => ({
			name: s.key === "other" ? intl.formatMessage({ id: "monitoring.traffic.class-other" }) : s.key,
			data: s.data,
		})),
		colors: series.map((s) => cssVar(style, CLASS_COLORS[s.key])),
		dataLabels: { enabled: false },
		stroke: { width: 2, curve: "straight" },
		fill: { type: "solid", opacity: 0.25 },
		grid: {
			borderColor: cssVar(style, "border-color"),
			strokeDashArray: 4,
			padding: { left: 0, right: 0 },
		},
		legend: {
			show: true,
			position: "top",
			horizontalAlign: "left",
			labels: { colors: cssVar(style, "secondary") },
		},
		xaxis: {
			type: "datetime",
			tickAmount: 6,
			axisBorder: { show: false },
			axisTicks: { show: false },
			tooltip: { enabled: false },
			labels: {
				datetimeUTC: false,
				hideOverlappingLabels: true,
				style: { colors: cssVar(style, "secondary") },
				formatter: (_value, timestamp) => (timestamp === undefined ? "" : axis.format(new Date(timestamp))),
			},
		},
		yaxis: {
			min: 0,
			forceNiceScale: true,
			labels: {
				style: { colors: cssVar(style, "secondary") },
				formatter: (value) => formatCount(value),
			},
		},
		tooltip: {
			theme,
			shared: true,
			intersect: false,
			x: { formatter: (value) => tooltipFormat.format(new Date(value)) },
			y: { formatter: (value) => intl.formatNumber(value) },
		},
	};
};

/**
 * Stacked area chart of requests per status class over the range (https://docs.tabler.io/ui/plugins/chart.md).
 * ApexCharts is loaded on first use. Follows the light and dark theme.
 *
 * @param {object} props
 * @param {{ bucket: number, byClass: Record<string, number> }[]} props.series  the API series
 * @param {"1h"|"24h"|"7d"|"30d"} props.range
 */
function TrafficChart({ series, range }) {
	const element = useRef(null);
	const chart = useRef(null);
	const [failed, setFailed] = useState(false);
	const theme = useDocumentTheme();
	const data = useMemo(() => chartSeries(series, range), [series, range]);
	const latest = useRef(null);
	latest.current = { data, range, theme };

	useEffect(() => {
		let disposed = false;
		loadApexCharts()
			.then((ApexCharts) => {
				if (disposed || !element.current) return;
				const { data: current, range: currentRange, theme: currentTheme } = latest.current;
				chart.current = new ApexCharts(element.current, buildOptions(current, currentRange, currentTheme));
				return chart.current.render();
			})
			.catch(() => setFailed(true));
		return () => {
			disposed = true;
			chart.current?.destroy();
			chart.current = null;
		};
	}, []);

	useEffect(() => {
		chart.current?.updateOptions(buildOptions(data, range, theme), true, false);
	}, [data, range, theme]);

	if (failed) {
		return <div className="text-secondary">{intl.formatMessage({ id: "monitoring.load-error" })}</div>;
	}

	return (
		<div
			ref={element}
			className="chart-lg"
			role="img"
			aria-label={intl.formatMessage({ id: "monitoring.traffic.chart-label" })}
		/>
	);
}

export { TrafficChart };
