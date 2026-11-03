import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { Button } from "src/components/ui/button";
import { currentLocale, intl } from "src/locale";
import { alpha2Of, alpha2OfName } from "src/modules/CountryCodes";
import { shadeIndex, shadeRanges } from "src/modules/MapShades";
import { countryName, formatCount, isCountryCode, mapScale } from "src/modules/Monitoring";
import world from "world-atlas/countries-110m.json" with { type: "json" };

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

// shade 0 (no data) and 1 to 5 per tone: whole class strings so Tailwind finds them
const FILLS = {
	primary: ["fill-muted", "fill-primary/20", "fill-primary/35", "fill-primary/55", "fill-primary/75", "fill-primary"],
	destructive: [
		"fill-muted",
		"fill-destructive/20",
		"fill-destructive/35",
		"fill-destructive/55",
		"fill-destructive/75",
		"fill-destructive",
	],
};

// the same steps as background colours, for the legend swatches
const SWATCHES = {
	primary: ["bg-muted", "bg-primary/20", "bg-primary/35", "bg-primary/55", "bg-primary/75", "bg-primary"],
	destructive: [
		"bg-muted",
		"bg-destructive/20",
		"bg-destructive/35",
		"bg-destructive/55",
		"bg-destructive/75",
		"bg-destructive",
	],
};

const OUTLINE =
	"stroke-card stroke-[0.5] outline-none [vector-effect:non-scaling-stroke] hover:stroke-foreground hover:stroke-1 focus-visible:stroke-foreground focus-visible:stroke-1";

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

const clampZoom = (zoom) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/**
 * The map itself (react-simple-maps on the world-atlas shapes), loaded on first use by WorldMap. Colours are Tailwind
 * classes on the theme tokens, so light and dark follow by CSS.
 */
function WorldMapCanvas({ countries, label, tone, formatValue = formatCount }) {
	const counts = useMemo(() => rawCounts(countries), [countries]);
	const scale = useMemo(() => mapScale(countries), [countries]);
	const max = Math.max(0, ...Object.values(counts));
	const ranges = useMemo(() => shadeRanges(max), [max]);
	const fills = FILLS[tone] ?? FILLS.primary;
	const swatches = SWATCHES[tone] ?? SWATCHES.primary;
	const [view, setView] = useState({ coordinates: [0, 0], zoom: 1 });
	const [active, setActive] = useState(null);

	const shapeInfo = (geo) => {
		const code = alpha2Of(geo.id) ?? alpha2OfName(geo.properties?.name);
		const name = code ? countryName(code, currentLocale) : (geo.properties?.name ?? "");
		const count = code ? counts[code] : undefined;
		return { code, name, count, text: count === undefined ? name : `${name}: ${formatValue(count)}` };
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="relative">
				<ComposableMap
					width={800}
					height={390}
					projection="geoEqualEarth"
					role="group"
					aria-label={label}
					className="h-auto w-full"
				>
					<ZoomableGroup
						center={view.coordinates}
						zoom={view.zoom}
						minZoom={MIN_ZOOM}
						maxZoom={MAX_ZOOM}
						// the wheel scrolls the page, zoom goes through the buttons, a pinch or a double click
						filterZoomEvent={(event) => event.type !== "wheel" && !event.ctrlKey && !event.button}
						onMoveEnd={({ coordinates, zoom }) => {
							if (coordinates) setView({ coordinates, zoom });
						}}
					>
						<Geographies geography={world}>
							{({ geographies }) =>
								geographies.map((geo) => {
									const { code, name, count, text } = shapeInfo(geo);
									const shade = shadeIndex(code ? scale[code] : 0);
									const focusable = count !== undefined;
									return (
										<Geography
											key={geo.rsmKey}
											geography={geo}
											className={`${OUTLINE} ${fills[shade]}`}
											tabIndex={focusable ? 0 : -1}
											aria-label={focusable ? text : undefined}
											onMouseEnter={() => setActive(text)}
											onMouseLeave={() => setActive(null)}
											onFocus={() => setActive(text)}
											onBlur={() => setActive(null)}
										>
											<title>{text || name}</title>
										</Geography>
									);
								})
							}
						</Geographies>
					</ZoomableGroup>
				</ComposableMap>
				<div className="absolute top-2 right-2 flex flex-col gap-1">
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						disabled={view.zoom >= MAX_ZOOM}
						aria-label={intl.formatMessage({ id: "monitoring.map.zoom-in" })}
						onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom * 2) }))}
					>
						<Plus aria-hidden="true" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						disabled={view.zoom <= MIN_ZOOM}
						aria-label={intl.formatMessage({ id: "monitoring.map.zoom-out" })}
						onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom / 2) }))}
					>
						<Minus aria-hidden="true" />
					</Button>
				</div>
			</div>
			<p className="m-0 min-h-5 text-sm text-muted-foreground" aria-live="polite">
				{active}
			</p>
			{ranges.length ? (
				<ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted-foreground">
					{ranges.map((range, idx) => (
						<li key={swatches[idx + 1]} className="flex items-center gap-1.5">
							<span
								className={`inline-block size-3 rounded-sm ${swatches[idx + 1]}`}
								aria-hidden="true"
							/>
							<span className="tabular-nums">
								{range.from === range.to
									? formatValue(range.to)
									: `${formatValue(range.from)} - ${formatValue(range.to)}`}
							</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

export { WorldMapCanvas };
