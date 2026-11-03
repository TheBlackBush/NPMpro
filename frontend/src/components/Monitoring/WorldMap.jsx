import { lazy, Suspense } from "react";
import { Skeleton } from "src/components/ui/skeleton";
import { formatCount } from "src/modules/Monitoring";

// the map library and the world shapes load on first use, so only pages with a map download them
const WorldMapCanvas = lazy(() => import("./WorldMapCanvas").then((m) => ({ default: m.WorldMapCanvas })));

/**
 * World map with countries shaded by a count (log scale, so one big country does not wash out the rest).
 * Unknown country codes ("--") and codes without a shape are skipped. Light and dark mode come from the theme tokens.
 *
 * @param {object} props
 * @param {{ country: string, requests?: number, count?: number }[]} props.countries
 * @param {string} props.label                       accessible name of the map
 * @param {"primary"|"destructive"} [props.tone]     colour of the shades, default "primary" (CrowdSec uses "destructive")
 * @param {(n: number) => string} [props.formatValue] caption and legend number, default formatCount
 */
function WorldMap({ countries, label, tone = "primary", formatValue = formatCount }) {
	return (
		<Suspense fallback={<Skeleton className="aspect-[800/390] w-full" />}>
			<WorldMapCanvas countries={countries} label={label} tone={tone} formatValue={formatValue} />
		</Suspense>
	);
}

export { WorldMap };
