// @ts-expect-error Creating a typing for a subfolder is not easily possible
import Flags from "country-flag-icons/react/3x2";
import { GlobeIcon } from "lucide-react";
import { cn } from "src/lib/utils";

function Flag({ className, countryCode }) {
	if (countryCode === "EN") {
		return <GlobeIcon className={cn("size-5", className)} aria-hidden="true" />;
	}

	const FlagElement = Flags[countryCode];
	// codes without a flag (unknown or reserved ones such as XK) render nothing instead of throwing
	if (!FlagElement) {
		return null;
	}
	// a thin themable edge (the theme border colour), so a white flag (Japan) does not melt into a light background
	return <FlagElement title={countryCode} className={cn("rounded-sm border", className)} width={20} />;
}

export { Flag };
