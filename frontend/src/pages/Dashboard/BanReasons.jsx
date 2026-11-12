import { TapTooltip } from "src/components/TapTooltip";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { formatCount } from "src/modules/Monitoring";

const HEIGHT = 8;

/**
 * A split bar 8 px high: one rect per segment (x and width out of 100, as banSegments and errorSegments give them),
 * filled with the segment's tone; without a segment wider than 0 an empty muted track. An SVG with attributes (the page
 * CSP blocks style attributes); the legend next to it says the same, so it is hidden from assistive technology.
 *
 * @param {object} props
 * @param {Array<{key: string, x: number, width: number, tone: {fill: string}}>} props.segments
 */
function SplitBar({ segments }) {
	const empty = segments.every((segment) => segment.width === 0);
	return (
		<div className="h-2 overflow-hidden rounded-full">
			<svg
				className="block size-full"
				aria-hidden="true"
				viewBox={`0 0 100 ${HEIGHT}`}
				preserveAspectRatio="none"
			>
				{empty ? <rect width="100" height={HEIGHT} className="fill-muted" /> : null}
				{segments.map((segment) =>
					segment.width > 0 ? (
						<rect
							key={segment.key}
							x={segment.x}
							y="0"
							width={segment.width}
							height={HEIGHT}
							className={segment.tone.fill}
						/>
					) : null,
				)}
			</svg>
		</div>
	);
}

/**
 * The split bar of the most common ban reasons and "other", with a legend of two columns under it: a colour dot, the
 * short reason name and its count. Each reason's full scenario name is its tooltip (hover and focus: the card is a
 * link), which closes as soon as the pointer leaves the entry, so the entry above it gets its own.
 *
 * @param {object} props
 * @param {ReturnType<typeof import("src/modules/DashboardCards").banSegments>} props.segments
 */
function BanReasons({ segments }) {
	return (
		<div className="flex flex-col gap-2">
			<SplitBar segments={segments} />
			<ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0 text-xs text-muted-foreground">
				{segments.map((segment) => {
					const entry = (
						<span className="flex min-w-0 flex-1 items-center gap-1.5">
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
						<li key={segment.key} className="flex min-w-0 items-center gap-1.5">
							{segment.scenario === null ? (
								entry
							) : (
								<TapTooltip content={segment.scenario} tap={false} hoverable={false}>
									{entry}
								</TapTooltip>
							)}
							<strong className="shrink-0 font-semibold text-foreground tabular-nums">
								{formatCount(segment.count)}
							</strong>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export { BanReasons, SplitBar };
