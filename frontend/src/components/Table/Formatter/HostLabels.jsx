import { TruncatedText } from "src/components/TruncatedText";

/**
 * The muted line under a host's name in the lists and the phone cards: its description, cut to one line with the
 * whole text in a tooltip. Nothing for a host without one.
 *
 * The outer box has no width of its own (w-0) and fills its cell (min-w-full): in a table cell sized by its content,
 * the whole one-line text would otherwise set the cell's minimum width and push the other columns off screen instead
 * of being cut.
 */
export function HostLabels({ description }) {
	const text = description?.trim() ?? "";
	if (text === "") return null;
	return (
		<div className="mt-1 w-0 min-w-full">
			<div className="flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground">
				<TruncatedText className="max-w-full">{text}</TruncatedText>
			</div>
		</div>
	);
}
