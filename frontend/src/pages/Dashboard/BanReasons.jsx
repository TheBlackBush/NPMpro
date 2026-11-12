import { TapTooltip } from "src/components/TapTooltip";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { formatCount } from "src/modules/Monitoring";

const HEIGHT = 8;

/**
 * The split bar of the most common ban reasons and "other", with a legend under it: a colour dot, the short reason
 * name and its count. Each reason's full scenario name is its tooltip (hover and focus: the card is a link). The bar
 * is an SVG with width attributes (the page CSP blocks style attributes); it repeats the legend, so it is hidden from
 * assistive technology.
 *
 * @param {object} props
 * @param {ReturnType<typeof import("src/modules/DashboardCards").banSegments>} props.segments
 */
function BanReasons({ segments }) {
	return (
		<div className="mt-2 flex flex-col gap-2">
			<div className="h-2 overflow-hidden rounded-full">
				<svg
					className="block size-full"
					aria-hidden="true"
					viewBox={`0 0 100 ${HEIGHT}`}
					preserveAspectRatio="none"
				>
					{segments.map((segment) => (
						<rect
							key={segment.key}
							x={segment.x}
							y="0"
							width={segment.width}
							height={HEIGHT}
							className={segment.tone.fill}
						/>
					))}
				</svg>
			</div>
			<ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
				{segments.map((segment) => {
					const name = (
						<span className="flex min-w-0 flex-1 items-center gap-2">
							<span className={cn("size-2 shrink-0 rounded-full", segment.tone.dot)} aria-hidden="true" />
							<span className="truncate">
								{segment.scenario === null ? (
									<T id="dashboard.monitoring.ban-reasons.other" />
								) : (
									segment.short
								)}
							</span>
						</span>
					);
					return (
						<li key={segment.key} className="flex min-w-0 items-center gap-2">
							{segment.scenario === null ? (
								name
							) : (
								<TapTooltip content={segment.scenario} tap={false}>
									{name}
								</TapTooltip>
							)}
							<strong className="ml-auto shrink-0 tabular-nums">{formatCount(segment.count)}</strong>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export { BanReasons };
