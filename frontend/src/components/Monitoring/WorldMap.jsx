import { useEffect, useMemo, useRef, useState } from "react";
import { currentLocale, intl } from "src/locale";
import { countryName, formatCount, isCountryCode, mapScale } from "src/modules/Monitoring";

// Tabler's own vector map (https://docs.tabler.io/ui/plugins/vector-map.md) and the world shapes, loaded on first use
// so only pages with a map download them. The styles are part of tabler.css.
let loader = null;
const loadVectorMap = () => {
	loader ??= Promise.all([
		import("@tabler/core/dist/js/tabler-vector-map.esm.js"),
		import("@tabler/core/dist/js/maps/world.esm.js"),
	]).then(([{ VectorMap }, { world }]) => {
		VectorMap.addMap("world", world);
		return VectorMap;
	});
	return loader;
};

const rawCounts = (countries) => {
	const counts = {};
	for (const item of countries ?? []) {
		if (isCountryCode(item?.country)) {
			const code = item.country.toUpperCase();
			counts[code] = (counts[code] ?? 0) + Number(item.requests ?? item.count ?? 0);
		}
	}
	return counts;
};

// update() redraws the legend: hide it while no country has a value, a "0 to 0" scale says nothing
const applyScale = (map, element, scale) => {
	map.update(scale);
	element.querySelector(".vector-map-legend")?.classList.toggle("d-none", Object.keys(scale).length === 0);
};

/**
 * World map with countries shaded by a count (log scale, so one big country does not wash out the rest).
 * Unknown country codes ("--") are skipped. Light and dark mode come from the Tabler CSS variables.
 *
 * @param {object} props
 * @param {{ country: string, requests?: number, count?: number }[]} props.countries
 * @param {string} props.label                       accessible name of the map
 * @param {"primary"|"red"} [props.color]            colour of the highest value, default "primary"
 * @param {(n: number) => string} [props.formatValue] tooltip and legend number, default formatCount
 */
function WorldMap({ countries, label, color = "primary", formatValue = formatCount }) {
	const element = useRef(null);
	const instance = useRef(null);
	const [failed, setFailed] = useState(false);
	const counts = useMemo(() => rawCounts(countries), [countries]);
	const scale = useMemo(() => mapScale(countries), [countries]);
	// the tooltip and legend callbacks are set once, they read the latest data from here
	const latest = useRef({ counts, scale, formatValue });
	latest.current = { counts, scale, formatValue };

	useEffect(() => {
		let disposed = false;
		loadVectorMap()
			.then((VectorMap) => {
				if (disposed || !element.current) return;
				instance.current = new VectorMap(element.current, {
					values: {},
					min: 0,
					max: 1,
					legend: (value) => {
						const max = Math.max(0, ...Object.values(latest.current.counts));
						// the shades are log1p(count) / log1p(max): turn the two ends of the scale back into counts
						return latest.current.formatValue(Math.round(Math.expm1(value * Math.log1p(max))));
					},
					tooltip: (item) => {
						if (item.type !== "region") return item.name;
						const name = countryName(item.code, currentLocale);
						const count = latest.current.counts[item.code];
						return count === undefined ? name : `${name}: ${latest.current.formatValue(count)}`;
					},
					label,
					zoom: true,
					zoomOnScroll: false,
					zoomInLabel: intl.formatMessage({ id: "monitoring.map.zoom-in" }),
					zoomOutLabel: intl.formatMessage({ id: "monitoring.map.zoom-out" }),
				});
				applyScale(instance.current, element.current, latest.current.scale);
			})
			.catch(() => setFailed(true));
		return () => {
			disposed = true;
			instance.current?.dispose();
			instance.current = null;
		};
		// drawn once per mount (the label never changes), new data goes through update() below
	}, [label]);

	useEffect(() => {
		if (instance.current && element.current) applyScale(instance.current, element.current, scale);
	}, [scale]);

	if (failed) {
		return <div className="text-secondary">{intl.formatMessage({ id: "monitoring.load-error" })}</div>;
	}

	return (
		<div
			ref={element}
			className="vector-map"
			// a Tabler colour variable, so the shade follows the theme
			style={color === "primary" ? undefined : { "--tblr-vector-map-color": `var(--tblr-${color})` }}
		/>
	);
}

export { WorldMap };
