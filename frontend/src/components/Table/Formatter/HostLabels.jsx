import { TruncatedText } from "src/components/TruncatedText";

/**
 * The muted line under a host's name in the lists and the phone cards: its description, cut to one line with the
 * whole text in a tooltip. Nothing for a host without one.
 */
export function HostLabels({ description }) {
	const text = description?.trim() ?? "";
	if (text === "") return null;
	return (
		<div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground">
			<TruncatedText className="max-w-full">{text}</TruncatedText>
		</div>
	);
}
