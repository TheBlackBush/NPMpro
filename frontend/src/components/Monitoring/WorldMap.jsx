import { Component, lazy, Suspense } from "react";
import { Skeleton } from "src/components/ui/skeleton";
import { intl } from "src/locale";
import { formatCount } from "src/modules/Monitoring";

// the map library and the world shapes load on first use, so only pages with a map download them
const WorldMapCanvas = lazy(() => import("./WorldMapCanvas").then((m) => ({ default: m.WorldMapCanvas })));

// a failed chunk load (for example after a deploy replaced the hashed file) shows a message in the map area only
class MapLoadBoundary extends Component {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	render() {
		if (this.state.failed) {
			return <div className="text-muted-foreground">{intl.formatMessage({ id: "monitoring.load-error" })}</div>;
		}
		return this.props.children;
	}
}

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
		<MapLoadBoundary>
			<Suspense fallback={<Skeleton className="aspect-[800/360] w-full" />}>
				<WorldMapCanvas countries={countries} label={label} tone={tone} formatValue={formatValue} />
			</Suspense>
		</MapLoadBoundary>
	);
}

export { WorldMap };
