// @ts-expect-error Creating a typing for a subfolder is not easily possible
import Flags from "country-flag-icons/react/3x2";
import { GlobeIcon } from "lucide-react";
import { TapTooltip } from "src/components/TapTooltip";
import { cn } from "src/lib/utils";

function Flag({ className, countryCode, tooltip = true }) {
	if (countryCode === "EN") {
		return <GlobeIcon className={cn("size-5", className)} aria-hidden="true" />;
	}

	const FlagElement = Flags[countryCode];
	// codes without a flag (unknown or reserved ones such as XK) render nothing instead of throwing
	if (!FlagElement) {
		return null;
	}
	// a thin themable edge (the theme border colour), so a white flag (Japan) does not melt into a light background
	// the code in the themed tooltip (hover or focus; a tap on a flag does nothing else), the wrapper names the image
	const image = (
		<span role="img" aria-label={countryCode} className={cn("inline-flex", className)}>
			<FlagElement aria-hidden="true" className="rounded-sm border" width={20} />
		</span>
	);
	// tooltip={false}: inside something that has its own tooltip (CountryName), so a label has just one
	return tooltip ? (
		<TapTooltip content={countryCode} tap={false}>
			{image}
		</TapTooltip>
	) : (
		image
	);
}

export { Flag };
