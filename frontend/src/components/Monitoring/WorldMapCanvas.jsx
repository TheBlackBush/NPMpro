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

// Shade 0 (no data) and 1 to 5 per tone, mixed with the card colour instead of made transparent, so every shade is
// opaque: each country is stroked in its own fill colour, which hides the seams between shapes without drawing border
// lines (a transparent stroke over a transparent fill would draw a darker edge). Whole class strings so Tailwind finds them.
const FILLS = {
	primary: [
		"fill-[color-mix(in_oklab,var(--foreground)_8%,var(--card))]",
		"fill-[color-mix(in_oklab,var(--primary)_20%,var(--card))]",
		"fill-[color-mix(in_oklab,var(--primary)_35%,var(--card))]",
		"fill-[color-mix(in_oklab,var(--primary)_55%,var(--card))]",
		"fill-[color-mix(in_oklab,var(--primary)_75%,var(--card))]",
		"fill-primary",
	],
	destructive: [
		"fill-[color-mix(in_oklab,var(--foreground)_8%,var(--card))]",
		"fill-[color-mix(in_oklab,var(--destructive)_20%,var(--card))]",
		"fill-[color-mix(in_oklab,var(--destructive)_35%,var(--card))]",
		"fill-[color-mix(in_oklab,var(--destructive)_55%,var(--card))]",
		"fill-[color-mix(in_oklab,var(--destructive)_75%,var(--card))]",
		"fill-destructive",
	],
};

// the same shades as strokes
const STROKES = {
	primary: [
		"stroke-[color:color-mix(in_oklab,var(--foreground)_8%,var(--card))]",
		"stroke-[color:color-mix(in_oklab,var(--primary)_20%,var(--card))]",
		"stroke-[color:color-mix(in_oklab,var(--primary)_35%,var(--card))]",
		"stroke-[color:color-mix(in_oklab,var(--primary)_55%,var(--card))]",
		"stroke-[color:color-mix(in_oklab,var(--primary)_75%,var(--card))]",
		"stroke-primary",
	],
	destructive: [
		"stroke-[color:color-mix(in_oklab,var(--foreground)_8%,var(--card))]",
		"stroke-[color:color-mix(in_oklab,var(--destructive)_20%,var(--card))]",
		"stroke-[color:color-mix(in_oklab,var(--destructive)_35%,var(--card))]",
		"stroke-[color:color-mix(in_oklab,var(--destructive)_55%,var(--card))]",
		"stroke-[color:color-mix(in_oklab,var(--destructive)_75%,var(--card))]",
		"stroke-destructive",
	],
};

// and as background colours, for the legend swatches
const SWATCHES = {
	primary: [
		"bg-[color-mix(in_oklab,var(--foreground)_8%,var(--card))]",
		"bg-[color-mix(in_oklab,var(--primary)_20%,var(--card))]",
		"bg-[color-mix(in_oklab,var(--primary)_35%,var(--card))]",
		"bg-[color-mix(in_oklab,var(--primary)_55%,var(--card))]",
		"bg-[color-mix(in_oklab,var(--primary)_75%,var(--card))]",
		"bg-primary",
	],
	destructive: [
		"bg-[color-mix(in_oklab,var(--foreground)_8%,var(--card))]",
		"bg-[color-mix(in_oklab,var(--destructive)_20%,var(--card))]",
		"bg-[color-mix(in_oklab,var(--destructive)_35%,var(--card))]",
		"bg-[color-mix(in_oklab,var(--destructive)_55%,var(--card))]",
		"bg-[color-mix(in_oklab,var(--destructive)_75%,var(--card))]",
		"bg-destructive",
	],
};

// a thin stroke that keeps its screen width at any zoom; hover and keyboard focus outline the one country
const SHAPE =
	"stroke-[0.75] outline-none [vector-effect:non-scaling-stroke] hover:stroke-foreground hover:stroke-[1.25] focus-visible:stroke-foreground focus-visible:stroke-[1.25]";

// Antarctica (id 010) is left out, as in most traffic maps: it has no visitors and takes a fifth of the height
const ANTARCTICA = "010";

// geoEqualEarth fitted to the world without Antarctica in 800 x 360 with an 8 px margin
const CENTER = [0, 7];
const PROJECTION = { scale: 147.6, center: CENTER };

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
	const strokes = STROKES[tone] ?? STROKES.primary;
	const swatches = SWATCHES[tone] ?? SWATCHES.primary;
	const [view, setView] = useState({ coordinates: CENTER, zoom: 1 });
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
					height={360}
					projection="geoEqualEarth"
					projectionConfig={PROJECTION}
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
								geographies
									.filter((geo) => geo.id !== ANTARCTICA)
									.map((geo) => {
										const { code, name, count, text } = shapeInfo(geo);
										const shade = shadeIndex(code ? scale[code] : 0);
										const focusable = count !== undefined;
										return (
											<Geography
												key={geo.rsmKey}
												geography={geo}
												className={`${SHAPE} ${fills[shade]} ${strokes[shade]}`}
												tabIndex={focusable ? 0 : -1}
												role={focusable ? "img" : undefined}
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
			{/* no live region: a focused country already reads its label */}
			<p className="m-0 min-h-5 text-sm text-muted-foreground">{active}</p>
			{ranges.length ? (
				<ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted-foreground">
					{ranges.map((range) => (
						<li key={range.shade} className="flex items-center gap-1.5">
							<span
								className={`inline-block size-3 rounded-sm ${swatches[range.shade]}`}
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
