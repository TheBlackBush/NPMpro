import { Minus, Plus } from "lucide-react";
import { useImperativeHandle, useMemo, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { Button } from "src/components/ui/button";
import { currentLocale, intl } from "src/locale";
import { alpha2Of, alpha2OfName } from "src/modules/CountryCodes";
import { fitMercator, tipPosition } from "src/modules/MapLayout";
import { shadeIndex, shadeRanges } from "src/modules/MapShades";
import { countryName, formatCount, isCountryCode, mapScale } from "src/modules/Monitoring";
import world from "world-atlas/countries-110m.json" with { type: "json" };

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

// Shade 0 (no data) and 1 to 5 per tone, mixed with the card colour instead of made transparent, so every shade is
// opaque and the borders drawn over them look the same everywhere. Whole class strings so Tailwind finds them.
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

// a thin stroke that keeps its screen width at any zoom
// a faint border on every country (user decision): a thin line in the card colour mixed with a little foreground, so
// it is light on the light theme and soft on the dark one, and keeps its screen width at any zoom
const SHAPE =
	"stroke-[color:color-mix(in_oklab,var(--foreground)_18%,var(--card))] stroke-[0.5] outline-none [vector-effect:non-scaling-stroke]";

// the hovered or focused country drawn again on top, outline only, so no neighbour covers part of its border
const OUTLINE =
	"pointer-events-none fill-none stroke-foreground stroke-1 outline-none [vector-effect:non-scaling-stroke]";

// Antarctica (id 010) is left out, as in most traffic maps: it has no visitors and takes a fifth of the height
const ANTARCTICA = "010";

// a flat map (user decision): Mercator fitted to the world without Antarctica, 800 px wide with an 8 px margin
const FIT = fitMercator(800);
const CENTER = FIT.center;
const PROJECTION = { scale: FIT.scale, center: CENTER };

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
 * The hover tooltip. Its position is its own state, so moving the pointer does not render the countries again; the
 * position goes through React's style prop (the CSSOM), which the page CSP allows.
 */
function MapTooltip({ ref, info, countMessage }) {
	const [position, setPosition] = useState(null);
	useImperativeHandle(ref, () => ({ move: setPosition }), []);
	if (!(info && position)) return null;
	return (
		<div
			data-map-tooltip
			aria-hidden="true"
			className={`pointer-events-none absolute z-10 flex -translate-x-1/2 items-baseline gap-2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md ${position.below ? "translate-y-4" : "-translate-y-[calc(100%+0.75rem)]"}`}
			style={{ left: position.left, top: position.top }}
		>
			<span className="font-medium">{info.name}</span>
			<span className="text-muted-foreground tabular-nums">
				{intl.formatMessage({ id: countMessage }, { count: info.count ?? 0 })}
			</span>
		</div>
	);
}

/**
 * The map itself (react-simple-maps on the world-atlas shapes), loaded on first use by WorldMap. Colours are Tailwind
 * classes on the theme tokens, so light and dark follow by CSS.
 */
function WorldMapCanvas({ countries, label, tone, formatValue = formatCount, countMessage = "monitoring.requests" }) {
	const counts = useMemo(() => rawCounts(countries), [countries]);
	const scale = useMemo(() => mapScale(countries), [countries]);
	const max = Math.max(0, ...Object.values(counts));
	const ranges = useMemo(() => shadeRanges(max), [max]);
	const fills = FILLS[tone] ?? FILLS.primary;
	const swatches = SWATCHES[tone] ?? SWATCHES.primary;
	const [view, setView] = useState({ coordinates: CENTER, zoom: 1 });
	const [active, setActive] = useState(null);
	const box = useRef(null);
	const tooltip = useRef(null);

	// pointer (or the focused shape's centre) to a tooltip position inside the map box
	const place = (clientX, clientY) => {
		const rect = box.current?.getBoundingClientRect();
		if (rect) tooltip.current?.move(tipPosition(clientX - rect.left, clientY - rect.top, rect.width));
	};
	const show = (geo, info, event) => {
		setActive({ geo, info });
		place(event.clientX, event.clientY);
	};
	const showFocused = (geo, info, event) => {
		setActive({ geo, info });
		const shape = event.currentTarget.getBoundingClientRect();
		place(shape.left + shape.width / 2, shape.top + shape.height / 2);
	};
	const hide = () => setActive(null);

	const shapeInfo = (geo) => {
		const code = alpha2Of(geo.id) ?? alpha2OfName(geo.properties?.name);
		const name = code ? countryName(code, currentLocale) : (geo.properties?.name ?? "");
		const count = code ? counts[code] : undefined;
		return { code, name, count, text: count === undefined ? name : `${name}: ${formatValue(count)}` };
	};

	return (
		<div className="flex flex-col gap-2">
			<div ref={box} className="relative">
				<ComposableMap
					width={800}
					height={FIT.height}
					projection="geoMercator"
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
										const info = { name, count };
										const shade = shadeIndex(code ? scale[code] : 0);
										const focusable = count !== undefined;
										return (
											<Geography
												key={geo.rsmKey}
												geography={geo}
												className={`${SHAPE} ${fills[shade]}`}
												tabIndex={focusable ? 0 : -1}
												role={focusable ? "img" : undefined}
												aria-label={focusable ? text : undefined}
												data-country={code ?? undefined}
												onMouseEnter={(event) => show(geo, info, event)}
												onMouseMove={(event) => place(event.clientX, event.clientY)}
												onMouseLeave={hide}
												onClick={(event) => show(geo, info, event)}
												onFocus={(event) => showFocused(geo, info, event)}
												onBlur={hide}
											/>
										);
									})
							}
						</Geographies>
						{active ? (
							<Geography geography={active.geo} className={OUTLINE} tabIndex={-1} aria-hidden="true" />
						) : null}
					</ZoomableGroup>
				</ComposableMap>
				<MapTooltip ref={tooltip} info={active?.info} countMessage={countMessage} />
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
